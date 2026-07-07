const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { encrypt, decrypt } = require("../utils/crypto-helper");

// ── Faixas de Rede ─────────────────────────────────────────────

router.get("/networks", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, ip_range AS "ipRange", active FROM inventory_networks ORDER BY name`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar redes." }); }
});

router.post("/networks", auth, async (req, res) => {
  const { name, ipRange, active = true } = req.body;
  if (!name?.trim() || !ipRange?.trim())
    return res.status(400).json({ error: "Nome e Faixa de IP são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO inventory_networks (name, ip_range, active) VALUES ($1,$2,$3)
       RETURNING id, name, ip_range AS "ipRange", active`,
      [name.trim(), ipRange.trim(), active]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar rede." }); }
});

router.put("/networks/:id", auth, async (req, res) => {
  const { name, ipRange, active } = req.body;
  if (!name?.trim() || !ipRange?.trim())
    return res.status(400).json({ error: "Nome e Faixa de IP são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE inventory_networks SET name=$1, ip_range=$2, active=$3 WHERE id=$4
       RETURNING id, name, ip_range AS "ipRange", active`,
      [name.trim(), ipRange.trim(), active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar rede." }); }
});

router.delete("/networks/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM inventory_networks WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir rede." }); }
});

// ── Configuração de Domínio (WMI) ──────────────────────────────

router.get("/domain", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, domain, username FROM inventory_domain_config LIMIT 1"
    );
    res.json(r.rows[0] || null);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar configuração de domínio." }); }
});

router.put("/domain", auth, async (req, res) => {
  const { domain, username, password } = req.body;
  try {
    const exists = await pool.query("SELECT id FROM inventory_domain_config LIMIT 1");
    if (exists.rows[0]) {
      const sets = ["domain=$1", "username=$2", "updated_at=NOW()"];
      const params = [domain || null, username || null];
      if (password?.trim()) { sets.push(`password_enc=$${params.length + 1}`); params.push(encrypt(password)); }
      params.push(exists.rows[0].id);
      await pool.query(`UPDATE inventory_domain_config SET ${sets.join(",")} WHERE id=$${params.length}`, params);
    } else {
      await pool.query(
        "INSERT INTO inventory_domain_config (domain, username, password_enc) VALUES ($1,$2,$3)",
        [domain || null, username || null, password ? encrypt(password) : null]
      );
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar configuração de domínio." }); }
});

// ── Tenants M365 ───────────────────────────────────────────────

router.get("/tenants", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, tenant_id AS "tenantId", client_id AS "clientId", active
         FROM inventory_tenants ORDER BY name`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar tenants." }); }
});

router.post("/tenants", auth, async (req, res) => {
  const { name, tenantId, clientId, clientSecret, active = true } = req.body;
  if (!name?.trim() || !tenantId?.trim() || !clientId?.trim() || !clientSecret?.trim())
    return res.status(400).json({ error: "Nome, Tenant ID, Client ID e Client Secret são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO inventory_tenants (name, tenant_id, client_id, client_secret_enc, active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, tenant_id AS "tenantId", client_id AS "clientId", active`,
      [name.trim(), tenantId.trim(), clientId.trim(), encrypt(clientSecret), active]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar tenant." }); }
});

router.put("/tenants/:id", auth, async (req, res) => {
  const { name, tenantId, clientId, clientSecret, active } = req.body;
  if (!name?.trim() || !tenantId?.trim() || !clientId?.trim())
    return res.status(400).json({ error: "Nome, Tenant ID e Client ID são obrigatórios." });
  try {
    const sets = ["name=$1", "tenant_id=$2", "client_id=$3", "active=$4"];
    const params = [name.trim(), tenantId.trim(), clientId.trim(), active];
    if (clientSecret?.trim()) { sets.push(`client_secret_enc=$${params.length + 1}`); params.push(encrypt(clientSecret)); }
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE inventory_tenants SET ${sets.join(",")} WHERE id=$${params.length}
       RETURNING id, name, tenant_id AS "tenantId", client_id AS "clientId", active`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar tenant." }); }
});

router.delete("/tenants/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM inventory_tenants WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir tenant." }); }
});

module.exports = router;
