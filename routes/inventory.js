const express  = require("express");
const router   = express.Router();
const pool     = require("../db");
const auth     = require("../middleware/auth");
const { decrypt } = require("../utils/crypto-helper");
const { exec } = require("child_process");
const https    = require("https");
const qs       = require("querystring");

// ── Helpers: nmap ───────────────────────────────────────────────

function parseNmapXml(xml) {
  const hosts = [];
  const seen = new Set();
  // aceita tanto <host> quanto <hosthint>
  const blocks = xml.match(/<host(?:hint)?[\s\S]*?<\/host(?:hint)?>/g) || [];
  for (const b of blocks) {
    const state = (b.match(/<status state="([^"]+)"/) || [])[1];
    if (state && state !== "up") continue;
    const ip = (b.match(/<address addr="([^"]+)" addrtype="ipv4"/) || [])[1];
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    const macM  = b.match(/<address addr="([^"]+)" addrtype="mac"(?:\s+vendor="([^"]*)")?/);
    const hostM = b.match(/<hostname name="([^"]+)"/);
    const osM   = b.match(/<osmatch name="([^"]+)"/);
    hosts.push({
      ip,
      mac:          macM ? macM[1] : null,
      manufacturer: macM && macM[2] ? macM[2] : null,
      hostname:     hostM ? hostM[1] : null,
      os:           osM   ? osM[1]   : null,
    });
  }
  return hosts;
}

function runNmap(ipRange) {
  return new Promise(resolve => {
    // -sn: ping scan (sem port scan, sem root), -R: resolve DNS reverso, --send-ip: evita ARP flood
    const cmd = `nmap -sn -T4 --host-timeout 15s -oX - ${ipRange}`;
    exec(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) { console.error(`nmap [${ipRange}]:`, err.message); return resolve([]); }
      resolve(parseNmapXml(stdout || ""));
    });
  });
}

// ── Helpers: WinRM via Python ──────────────────────────────────

function runWinRM(ip, domain, username, password) {
  return new Promise(resolve => {
    const script = "/app/scripts/winrm_collect.py";
    const args   = [ip, domain || "", username, password].map(a => `'${a.replace(/'/g,"'\\''")}'`).join(" ");
    const cmd    = `python3 ${script} ${args}`;
    exec(cmd, { timeout: 60000 }, (err, stdout) => {
      try {
        const r = JSON.parse((stdout || "").trim());
        if (r.error) { console.error(`WinRM [${ip}]:`, r.error); return resolve(null); }
        resolve(r);
      } catch { resolve(null); }
    });
  });
}

// ── Helpers: WMI (wmic via Linux wmi-client) ───────────────────

function parseWmic(stdout) {
  const lines = (stdout || "").trim().split("\n").filter(l => l.trim() && !l.startsWith("CLASS:"));
  if (lines.length < 2) return [];
  const headers = lines[0].split("|").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split("|").map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || null; });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

function runWmic(ip, domain, username, password, query) {
  return new Promise(resolve => {
    const user = domain ? `${domain}\\${username}` : username;
    const cmd  = `wmic --delimiter="|" -U "${user}%${password}" //${ip} "${query}"`;
    exec(cmd, { timeout: 60000 }, (err, stdout) => {
      resolve(parseWmic(stdout));
    });
  });
}

// ── Helpers: Microsoft Graph ────────────────────────────────────

function graphToken(tenantId, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = qs.stringify({
      client_id: clientId, client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
    });
    const req = https.request({
      hostname: "login.microsoftonline.com",
      path: `/${tenantId}/oauth2/v2.0/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d).access_token || null); } catch { reject(new Error("Token inválido")); } });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

function graphGet(token, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "graph.microsoft.com", path: `/v1.0${path}`, method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { reject(new Error("JSON inválido")); } });
    });
    req.on("error", reject); req.end();
  });
}

async function collectM365(tenant, collectionId) {
  const secret = decrypt(tenant.client_secret_enc);
  if (!secret) return;
  let token;
  try { token = await graphToken(tenant.tenant_id, tenant.client_id, secret); }
  catch(e) { console.error(`M365 token [${tenant.name}]:`, e.message); return; }
  if (!token) { console.error(`M365 token vazio [${tenant.name}]`); return; }

  // Licenças
  const skusRes = await graphGet(token, "/subscribedSkus");
  if (skusRes.error) console.error(`M365 Graph [${tenant.name}]:`, JSON.stringify(skusRes.error));
  for (const sku of (skusRes.value || [])) {
    await pool.query(
      `INSERT INTO inventory_m365_licenses
         (collection_id,tenant_id,tenant_name,sku_name,total_units,used_units,available_units)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [collectionId, tenant.id, tenant.name, sku.skuPartNumber,
       sku.prepaidUnits?.enabled || 0, sku.consumedUnits || 0,
       (sku.prepaidUnits?.enabled || 0) - (sku.consumedUnits || 0)]
    ).catch(() => {});
  }

  // Usuários com licença (paginado)
  let path = "/users?$select=displayName,mail,assignedLicenses&$top=999";
  while (path) {
    const res = await graphGet(token, path);
    for (const u of (res.value || [])) {
      if (!u.assignedLicenses?.length) continue;
      await pool.query(
        `INSERT INTO inventory_m365_users
           (collection_id,tenant_id,tenant_name,display_name,email,licenses)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [collectionId, tenant.id, tenant.name, u.displayName, u.mail,
         JSON.stringify(u.assignedLicenses.map(l => l.skuId))]
      ).catch(() => {});
    }
    const next = res["@odata.nextLink"];
    path = next ? next.replace("https://graph.microsoft.com/v1.0", "") : null;
  }
}

// ── Scan (async, fire-and-forget) ──────────────────────────────

async function runScan(collectionId, tipo) {
  try {
    await pool.query(
      "UPDATE inventory_collections SET status='Executando', started_at=NOW() WHERE id=$1",
      [collectionId]
    );

    const [netsRes, domRes] = await Promise.all([
      pool.query("SELECT ip_range FROM inventory_networks WHERE active=TRUE"),
      pool.query("SELECT domain, username, password_enc FROM inventory_domain_config LIMIT 1"),
    ]);

    const networks = netsRes.rows;
    const dom      = domRes.rows[0] || null;

    if (networks.length === 0) {
      return await pool.query(
        "UPDATE inventory_collections SET status='Erro', finished_at=NOW(), error_msg=$2 WHERE id=$1",
        [collectionId, "Nenhuma faixa de rede configurada em Configuração de Inventário."]
      );
    }

    // Scan todas as faixas e consolidar por IP
    const seen = new Set();
    const allHosts = [];
    for (const net of networks) {
      const hosts = await runNmap(net.ip_range);
      for (const h of hosts) {
        if (!seen.has(h.ip)) { seen.add(h.ip); allHosts.push(h); }
      }
    }

    for (const host of allHosts) {
      const devRes = await pool.query(
        `INSERT INTO inventory_devices (collection_id,ip,mac,hostname,os,manufacturer)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [collectionId, host.ip, host.mac, host.hostname, host.os, host.manufacturer]
      );
      const deviceId = devRes.rows[0].id;

      if (tipo === "Inventário de Software" && dom?.username) {
        const pwd = decrypt(dom.password_enc);
        const winrm = await runWinRM(host.ip, dom.domain, dom.username, pwd);
        if (winrm) {
          // Atualiza MAC e OS se coletados via WinRM
          if (winrm.mac || winrm.os) {
            await pool.query(
              "UPDATE inventory_devices SET mac=COALESCE($2,mac), os=COALESCE($3,os) WHERE id=$1",
              [deviceId, winrm.mac || null, winrm.os || null]
            ).catch(() => {});
          }
          // Hardware
          await pool.query(
            "INSERT INTO inventory_hardware (device_id,cpu,ram_gb,disk_gb) VALUES ($1,$2,$3,$4)",
            [deviceId, winrm.cpu || null, winrm.ram_gb || null, winrm.disk_gb || null]
          ).catch(() => {});
          // Software
          for (const sw of (winrm.software || [])) {
            await pool.query(
              "INSERT INTO inventory_software (device_id,name,version,manufacturer,install_date) VALUES ($1,$2,$3,$4,$5)",
              [deviceId, sw.name, sw.version, sw.manufacturer, sw.install_date]
            ).catch(() => {});
          }
        }
      }
    }

    // M365 (somente Inventário de Software)
    if (tipo === "Inventário de Software") {
      const tenantsRes = await pool.query(
        "SELECT id, name, tenant_id, client_id, client_secret_enc FROM inventory_tenants WHERE active=TRUE"
      );
      for (const t of tenantsRes.rows) {
        try { await collectM365(t, collectionId); }
        catch (e) { console.error(`M365 [${t.name}]:`, e.message); }
      }
    }

    await pool.query(
      "UPDATE inventory_collections SET status='Concluído', finished_at=NOW() WHERE id=$1",
      [collectionId]
    );
  } catch (err) {
    console.error("runScan error:", err.message);
    await pool.query(
      "UPDATE inventory_collections SET status='Erro', finished_at=NOW(), error_msg=$2 WHERE id=$1",
      [collectionId, err.message]
    ).catch(() => {});
  }
}

// ── Endpoints ───────────────────────────────────────────────────

// GET /inventory/collections
router.get("/collections", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, TO_CHAR(c.data,'DD/MM/YYYY') AS data, c.tipo, c.status,
              c.error_msg AS "errorMsg",
              TO_CHAR(c.started_at,'DD/MM/YYYY HH24:MI') AS "startedAt",
              TO_CHAR(c.finished_at,'DD/MM/YYYY HH24:MI') AS "finishedAt",
              COUNT(DISTINCT d.id)::int    AS "totalDevices",
              COUNT(DISTINCT l.id)::int    AS "totalLicenses"
         FROM inventory_collections c
         LEFT JOIN inventory_devices      d ON d.collection_id = c.id
         LEFT JOIN inventory_m365_licenses l ON l.collection_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar coletas." }); }
});

// GET /inventory/collections/:id
router.get("/collections/:id", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, TO_CHAR(data,'DD/MM/YYYY') AS data, tipo, status,
              error_msg AS "errorMsg",
              TO_CHAR(started_at,'DD/MM/YYYY HH24:MI') AS "startedAt",
              TO_CHAR(finished_at,'DD/MM/YYYY HH24:MI') AS "finishedAt"
         FROM inventory_collections WHERE id=$1`, [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar coleta." }); }
});

// POST /inventory/collections
router.post("/collections", auth, async (req, res) => {
  const { data, tipo } = req.body;
  if (!data || !tipo) return res.status(400).json({ error: "Data e Tipo são obrigatórios." });
  try {
    const [d, m, y] = data.split("/");
    const r = await pool.query(
      `INSERT INTO inventory_collections (data, tipo)
       VALUES ($1,$2)
       RETURNING id, TO_CHAR(data,'DD/MM/YYYY') AS data, tipo, status`,
      [`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`, tipo]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar coleta." }); }
});

// DELETE /inventory/collections/:id
router.delete("/collections/:id", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT status FROM inventory_collections WHERE id=$1", [req.params.id]);
    if (r.rows[0]?.status === "Executando")
      return res.status(400).json({ error: "Não é possível excluir uma coleta em andamento." });
    await pool.query("DELETE FROM inventory_collections WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir coleta." }); }
});

// POST /inventory/collections/:id/reset — força reset de coleta travada
router.post("/collections/:id/reset", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT status FROM inventory_collections WHERE id=$1", [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Coleta não encontrada." });
    await pool.query(
      "UPDATE inventory_collections SET status='Erro', finished_at=NOW(), error_msg=$2 WHERE id=$1",
      [req.params.id, "Cancelado manualmente pelo usuário."]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao resetar coleta." }); }
});

// POST /inventory/collections/:id/scan
router.post("/collections/:id/scan", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, tipo, status FROM inventory_collections WHERE id=$1", [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Coleta não encontrada." });
    if (r.rows[0].status === "Executando") return res.status(409).json({ error: "Scan já em andamento." });

    // Limpa resultados anteriores para re-scan
    await Promise.all([
      pool.query("DELETE FROM inventory_devices WHERE collection_id=$1", [req.params.id]),
      pool.query("DELETE FROM inventory_m365_licenses WHERE collection_id=$1", [req.params.id]),
      pool.query("DELETE FROM inventory_m365_users WHERE collection_id=$1", [req.params.id]),
    ]);

    runScan(req.params.id, r.rows[0].tipo).catch(console.error);
    res.json({ success: true, message: "Scan iniciado." });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao iniciar scan." }); }
});

// GET /inventory/collections/:id/devices
router.get("/collections/:id/devices", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.ip, d.mac, d.hostname, d.os, d.manufacturer,
              h.cpu, h.ram_gb AS "ramGb", h.disk_gb AS "diskGb",
              COUNT(s.id)::int AS "softwareCount"
         FROM inventory_devices d
         LEFT JOIN inventory_hardware h ON h.device_id = d.id
         LEFT JOIN inventory_software s ON s.device_id = d.id
        WHERE d.collection_id=$1
        GROUP BY d.id, h.cpu, h.ram_gb, h.disk_gb
        ORDER BY d.ip`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar dispositivos." }); }
});

// GET /inventory/collections/:id/devices/:devId/software
router.get("/collections/:id/devices/:devId/software", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, version, manufacturer, install_date AS "installDate"
         FROM inventory_software WHERE device_id=$1 ORDER BY name`,
      [req.params.devId]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar softwares." }); }
});

// GET /inventory/collections/:id/m365
router.get("/collections/:id/m365", auth, async (req, res) => {
  try {
    const [licRes, usrRes] = await Promise.all([
      pool.query(
        `SELECT id, tenant_name AS "tenantName", sku_name AS "skuName",
                total_units AS "totalUnits", used_units AS "usedUnits", available_units AS "availableUnits"
           FROM inventory_m365_licenses WHERE collection_id=$1 ORDER BY tenant_name, sku_name`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, tenant_name AS "tenantName", display_name AS "displayName", email, licenses
           FROM inventory_m365_users WHERE collection_id=$1 ORDER BY tenant_name, display_name`,
        [req.params.id]
      ),
    ]);
    res.json({ licenses: licRes.rows, users: usrRes.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar dados M365." }); }
});

module.exports = router;
