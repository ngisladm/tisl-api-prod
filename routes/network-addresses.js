const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// ── Helpers CIDR ────────────────────────────────────────────────

function cidrToRange(cidr) {
  const [ip, prefixStr] = cidr.trim().split("/");
  const prefix = parseInt(prefixStr, 10);
  if (!ip || isNaN(prefix) || prefix < 0 || prefix > 32) return null;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask  = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
  const start = (ipInt & mask) >>> 0;
  const end   = (start | (~mask >>> 0)) >>> 0;
  return { start, end, prefix, ip };
}

function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
}

function rangesOverlap(a, b) {
  return a.start <= b.end && a.end >= b.start;
}

async function checkConflict(ipRange, excludeId = null) {
  const newRange = cidrToRange(ipRange);
  if (!newRange) return { error: "Faixa CIDR inválida." };
  const q = excludeId
    ? "SELECT id, nome, ip_range FROM network_ranges WHERE active=true AND id<>$1"
    : "SELECT id, nome, ip_range FROM network_ranges WHERE active=true";
  const params = excludeId ? [excludeId] : [];
  const rows = (await pool.query(q, params)).rows;
  for (const row of rows) {
    const r = cidrToRange(row.ip_range);
    if (r && rangesOverlap(newRange, r)) {
      return { conflict: true, conflictWith: row.nome, conflictRange: row.ip_range };
    }
  }
  return { conflict: false };
}

// ── Filiais ─────────────────────────────────────────────────────

router.get("/filiais", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT id, nome, cidade, active FROM network_filiais ORDER BY nome");
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar filiais." }); }
});

router.post("/filiais", auth, async (req, res) => {
  const { nome, cidade, active = true } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome da filial é obrigatório." });
  try {
    const r = await pool.query(
      "INSERT INTO network_filiais (nome, cidade, active) VALUES ($1,$2,$3) RETURNING id, nome, cidade, active",
      [nome.trim(), cidade?.trim() || null, active]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar filial." }); }
});

router.put("/filiais/:id", auth, async (req, res) => {
  const { nome, cidade, active } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome da filial é obrigatório." });
  try {
    const r = await pool.query(
      "UPDATE network_filiais SET nome=$1, cidade=$2, active=$3 WHERE id=$4 RETURNING id, nome, cidade, active",
      [nome.trim(), cidade?.trim() || null, active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Filial não encontrada." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar filial." }); }
});

router.delete("/filiais/:id", auth, async (req, res) => {
  try {
    const used = await pool.query("SELECT id FROM network_ranges WHERE filial_id=$1 LIMIT 1", [req.params.id]);
    if (used.rows.length) return res.status(400).json({ error: "Não é possível excluir uma filial com faixas cadastradas." });
    await pool.query("DELETE FROM network_filiais WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir filial." }); }
});

// ── Faixas ──────────────────────────────────────────────────────

router.get("/ranges", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT nr.id, nr.filial_id AS "filialId", nf.nome AS "filialNome",
              nr.nome, nr.ip_range AS "ipRange", nr.vlan,
              COALESCE(nr.vlan_id, null) AS "vlanId",
              COALESCE(nr.tipo, '') AS tipo,
              nr.observacao,
              nr.active, nr.sync_inventory AS "syncInventory",
              nr.inventory_network_id AS "inventoryNetworkId",
              COALESCE(nr.dhcp, false) AS dhcp,
              nr.created_at AS "createdAt"
         FROM network_ranges nr
         JOIN network_filiais nf ON nf.id = nr.filial_id
        ORDER BY nf.nome, nr.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar faixas." }); }
});

// POST /network-addresses/validate — verifica conflito sem salvar
router.post("/validate", auth, async (req, res) => {
  const { ipRange, excludeId } = req.body;
  if (!ipRange) return res.status(400).json({ error: "Faixa de IP é obrigatória." });
  try {
    const range = cidrToRange(ipRange);
    if (!range) return res.status(400).json({ error: "Faixa CIDR inválida." });
    const result = await checkConflict(ipRange, excludeId || null);
    res.json({
      ...result,
      firstIp: intToIp(range.start + (range.prefix < 32 ? 1 : 0)),
      lastIp:  intToIp(range.end   - (range.prefix < 32 ? 1 : 0)),
      totalHosts: range.prefix >= 31 ? (1 << (32 - range.prefix)) : (1 << (32 - range.prefix)) - 2,
      mask: intToIp((~((1 << (32 - range.prefix)) - 1)) >>> 0),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao validar faixa." }); }
});

router.post("/ranges", auth, async (req, res) => {
  const { filialId, nome, ipRange, vlan, vlanId, tipo, observacao, active = true, syncInventory = true, dhcp = false } = req.body;
  if (!filialId || !nome?.trim() || !ipRange?.trim())
    return res.status(400).json({ error: "Filial, nome e faixa de IP são obrigatórios." });
  try {
    const conflict = await checkConflict(ipRange);
    if (conflict.error) return res.status(400).json({ error: conflict.error });
    if (conflict.conflict)
      return res.status(409).json({ error: `Conflito com a faixa "${conflict.conflictWith}" (${conflict.conflictRange}).` });

    let inventoryNetworkId = null;
    if (syncInventory) {
      const inv = await pool.query(
        "INSERT INTO inventory_networks (name, ip_range, active) VALUES ($1,$2,$3) RETURNING id",
        [nome.trim(), ipRange.trim(), active]
      );
      inventoryNetworkId = inv.rows[0].id;
    }

    const r = await pool.query(
      `INSERT INTO network_ranges (filial_id, nome, ip_range, vlan, vlan_id, tipo, observacao, active, sync_inventory, inventory_network_id, dhcp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, filial_id AS "filialId", nome, ip_range AS "ipRange", vlan,
                 vlan_id AS "vlanId", tipo, observacao,
                 active, sync_inventory AS "syncInventory", inventory_network_id AS "inventoryNetworkId", dhcp`,
      [filialId, nome.trim(), ipRange.trim(), vlan?.trim() || null,
       vlanId ? parseInt(vlanId) : null, tipo?.trim() || null,
       observacao?.trim() || null, active, syncInventory, inventoryNetworkId, dhcp]
    );
    const row = r.rows[0];
    const filial = await pool.query("SELECT nome FROM network_filiais WHERE id=$1", [filialId]);
    res.status(201).json({ ...row, filialNome: filial.rows[0]?.nome });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar faixa." }); }
});

router.put("/ranges/:id", auth, async (req, res) => {
  const { filialId, nome, ipRange, vlan, vlanId, tipo, observacao, active, syncInventory, dhcp } = req.body;
  if (!filialId || !nome?.trim() || !ipRange?.trim())
    return res.status(400).json({ error: "Filial, nome e faixa de IP são obrigatórios." });
  try {
    const existing = await pool.query(
      "SELECT sync_inventory, inventory_network_id FROM network_ranges WHERE id=$1", [req.params.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: "Faixa não encontrada." });
    const prev = existing.rows[0];

    const conflict = await checkConflict(ipRange, req.params.id);
    if (conflict.error) return res.status(400).json({ error: conflict.error });
    if (conflict.conflict)
      return res.status(409).json({ error: `Conflito com a faixa "${conflict.conflictWith}" (${conflict.conflictRange}).` });

    let inventoryNetworkId = prev.inventory_network_id;

    if (syncInventory && !prev.inventory_network_id) {
      const inv = await pool.query(
        "INSERT INTO inventory_networks (name, ip_range, active) VALUES ($1,$2,$3) RETURNING id",
        [nome.trim(), ipRange.trim(), active]
      );
      inventoryNetworkId = inv.rows[0].id;
    } else if (!syncInventory && prev.inventory_network_id) {
      await pool.query("DELETE FROM inventory_networks WHERE id=$1", [prev.inventory_network_id]);
      inventoryNetworkId = null;
    } else if (syncInventory && prev.inventory_network_id) {
      await pool.query(
        "UPDATE inventory_networks SET name=$1, ip_range=$2, active=$3 WHERE id=$4",
        [nome.trim(), ipRange.trim(), active, prev.inventory_network_id]
      );
    }

    const r = await pool.query(
      `UPDATE network_ranges
          SET filial_id=$1, nome=$2, ip_range=$3, vlan=$4, vlan_id=$5, tipo=$6,
              observacao=$7, active=$8, sync_inventory=$9, inventory_network_id=$10,
              dhcp=$11, updated_at=NOW()
        WHERE id=$12
       RETURNING id, filial_id AS "filialId", nome, ip_range AS "ipRange", vlan,
                 vlan_id AS "vlanId", tipo, observacao,
                 active, sync_inventory AS "syncInventory", inventory_network_id AS "inventoryNetworkId", dhcp`,
      [filialId, nome.trim(), ipRange.trim(), vlan?.trim() || null,
       vlanId ? parseInt(vlanId) : null, tipo?.trim() || null,
       observacao?.trim() || null, active, syncInventory, inventoryNetworkId,
       dhcp ?? false, req.params.id]
    );
    const filial = await pool.query("SELECT nome FROM network_filiais WHERE id=$1", [filialId]);
    res.json({ ...r.rows[0], filialNome: filial.rows[0]?.nome });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar faixa." }); }
});

router.delete("/ranges/:id", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT sync_inventory, inventory_network_id FROM network_ranges WHERE id=$1", [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Faixa não encontrada." });
    if (r.rows[0].sync_inventory && r.rows[0].inventory_network_id) {
      await pool.query("DELETE FROM inventory_networks WHERE id=$1", [r.rows[0].inventory_network_id]);
    }
    await pool.query("DELETE FROM network_ranges WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir faixa." }); }
});

// ── DHCP ────────────────────────────────────────────────────────

function ipToInt(ip) {
  const parts = ip.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// GET /network-addresses/ranges/:id/dhcp
router.get("/ranges/:id/dhcp", auth, async (req, res) => {
  try {
    const cfg = await pool.query(
      `SELECT dhcp_start AS "dhcpStart", dhcp_end AS "dhcpEnd"
         FROM network_dhcp_config WHERE range_id=$1`,
      [req.params.id]
    );
    const statics = await pool.query(
      `SELECT ip, descricao FROM network_dhcp_statics
        WHERE range_id=$1 ORDER BY inet(ip)`,
      [req.params.id]
    );
    res.json({
      dhcpStart: cfg.rows[0]?.dhcpStart || null,
      dhcpEnd:   cfg.rows[0]?.dhcpEnd   || null,
      statics:   statics.rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar configuração DHCP." }); }
});

// PUT /network-addresses/ranges/:id/dhcp/range — salva faixa DHCP e limpa statics
router.put("/ranges/:id/dhcp/range", auth, async (req, res) => {
  const { dhcpStart, dhcpEnd } = req.body;
  if (!dhcpStart?.trim() || !dhcpEnd?.trim())
    return res.status(400).json({ error: "IP inicial e final são obrigatórios." });

  // Valida que os IPs estão dentro da faixa pai
  const range = await pool.query("SELECT ip_range FROM network_ranges WHERE id=$1", [req.params.id]);
  if (!range.rows[0]) return res.status(404).json({ error: "Faixa não encontrada." });
  const parent = cidrToRange(range.rows[0].ip_range);
  if (!parent) return res.status(400).json({ error: "Faixa pai inválida." });

  const startInt = ipToInt(dhcpStart.trim());
  const endInt   = ipToInt(dhcpEnd.trim());
  if (!startInt || !endInt)
    return res.status(400).json({ error: "IPs informados são inválidos." });
  if (startInt > endInt)
    return res.status(400).json({ error: "IP inicial deve ser menor ou igual ao IP final." });
  const firstHost = parent.start + (parent.prefix < 32 ? 1 : 0);
  const lastHost  = parent.end   - (parent.prefix < 32 ? 1 : 0);
  if (startInt < firstHost || endInt > lastHost)
    return res.status(400).json({ error: "A faixa DHCP deve estar dentro da faixa de rede configurada." });

  try {
    const exists = await pool.query("SELECT id FROM network_dhcp_config WHERE range_id=$1", [req.params.id]);
    if (exists.rows[0]) {
      await pool.query(
        "UPDATE network_dhcp_config SET dhcp_start=$1, dhcp_end=$2, updated_at=NOW() WHERE range_id=$3",
        [dhcpStart.trim(), dhcpEnd.trim(), req.params.id]
      );
    } else {
      await pool.query(
        "INSERT INTO network_dhcp_config (range_id, dhcp_start, dhcp_end) VALUES ($1,$2,$3)",
        [req.params.id, dhcpStart.trim(), dhcpEnd.trim()]
      );
    }
    await pool.query("DELETE FROM network_dhcp_statics WHERE range_id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar faixa DHCP." }); }
});

// DELETE /network-addresses/ranges/:id/dhcp — exclui configuração DHCP e desmarca flag na faixa
router.delete("/ranges/:id/dhcp", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM network_dhcp_statics WHERE range_id=$1", [req.params.id]);
    await pool.query("DELETE FROM network_dhcp_config WHERE range_id=$1", [req.params.id]);
    await pool.query("UPDATE network_ranges SET dhcp=false, updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir configuração DHCP." }); }
});

// PUT /network-addresses/ranges/:id/dhcp/statics — salva descrições dos IPs estáticos
router.put("/ranges/:id/dhcp/statics", auth, async (req, res) => {
  const { statics } = req.body;
  if (!Array.isArray(statics)) return res.status(400).json({ error: "statics deve ser um array." });
  try {
    const toSave = statics.filter(s => s.descricao?.trim());
    await pool.query("DELETE FROM network_dhcp_statics WHERE range_id=$1", [req.params.id]);
    for (const s of toSave) {
      await pool.query(
        `INSERT INTO network_dhcp_statics (range_id, ip, descricao)
         VALUES ($1,$2,$3)
         ON CONFLICT (range_id, ip) DO UPDATE SET descricao=$3, updated_at=NOW()`,
        [req.params.id, s.ip, s.descricao.trim()]
      );
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar alocações." }); }
});

module.exports = router;
