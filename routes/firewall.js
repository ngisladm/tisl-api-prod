const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// ── Firewall ─────────────────────────────────────────────────────

router.get("/", auth, canAccess("s41"), async (req, res) => {
  const { equipamento, filialId, modelo, numeroSerie, firmware } = req.query;
  try {
    let where = [];
    let params = [];
    let i = 1;
    if (equipamento?.trim()) { where.push(`fw.equipamento ILIKE $${i++}`); params.push(`%${equipamento.trim()}%`); }
    if (filialId)             { where.push(`fw.filial_id=$${i++}`);         params.push(filialId); }
    if (modelo?.trim())       { where.push(`fw.modelo ILIKE $${i++}`);      params.push(`%${modelo.trim()}%`); }
    if (numeroSerie?.trim())  { where.push(`fw.numero_serie ILIKE $${i++}`);params.push(`%${numeroSerie.trim()}%`); }
    if (firmware?.trim())     { where.push(`fw.firmware ILIKE $${i++}`);    params.push(`%${firmware.trim()}%`); }

    const r = await pool.query(
      `SELECT fw.id, fw.equipamento, fw.filial_id AS "filialId", f.nome AS "filialNome",
              fw.modelo, fw.numero_serie AS "numeroSerie", fw.firmware, fw.rede_nativa AS "redeNativa",
              fw.created_at AS "createdAt"
         FROM firewall fw
         LEFT JOIN network_filiais f ON f.id = fw.filial_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY fw.equipamento`,
      params
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar firewall." }); }
});

router.post("/", auth, canAccess("s41", "insert"), async (req, res) => {
  const { equipamento, filialId, modelo, numeroSerie, firmware, redeNativa } = req.body;
  if (!equipamento?.trim()) return res.status(400).json({ error: "Equipamento é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO firewall (equipamento, filial_id, modelo, numero_serie, firmware, rede_nativa)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [equipamento.trim(), filialId||null, modelo?.trim()||null, numeroSerie?.trim()||null,
       firmware?.trim()||null, redeNativa?.trim()||null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar firewall." }); }
});

router.put("/:id", auth, canAccess("s41", "edit"), async (req, res) => {
  const { equipamento, filialId, modelo, numeroSerie, firmware, redeNativa } = req.body;
  if (!equipamento?.trim()) return res.status(400).json({ error: "Equipamento é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE firewall SET equipamento=$1, filial_id=$2, modelo=$3, numero_serie=$4,
         firmware=$5, rede_nativa=$6, updated_at=NOW()
       WHERE id=$7 RETURNING id`,
      [equipamento.trim(), filialId||null, modelo?.trim()||null, numeroSerie?.trim()||null,
       firmware?.trim()||null, redeNativa?.trim()||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Firewall não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar firewall." }); }
});

router.delete("/:id", auth, canAccess("s41", "delete"), async (req, res) => {
  try {
    await pool.query("DELETE FROM firewall WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir firewall." }); }
});

// ── VLANs do Firewall ─────────────────────────────────────────────

router.get("/:id/vlans", auth, canAccess("s41"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT fv.id, fv.firewall_id AS "firewallId", fv.range_id AS "rangeId",
              nr.nome AS "rangeNome", nr.ip_range AS "ipRange"
         FROM firewall_vlans fv
         JOIN network_ranges nr ON nr.id = fv.range_id
        WHERE fv.firewall_id=$1 ORDER BY nr.nome`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar VLANs." }); }
});

router.post("/:id/vlans", auth, canAccess("s41", "insert"), async (req, res) => {
  const { rangeId } = req.body;
  if (!rangeId) return res.status(400).json({ error: "Selecione uma faixa de rede." });
  try {
    const r = await pool.query(
      "INSERT INTO firewall_vlans (firewall_id, range_id) VALUES ($1,$2) RETURNING id",
      [req.params.id, rangeId]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Esta VLAN já está vinculada a este firewall." });
    console.error(err);
    res.status(500).json({ error: "Erro ao vincular VLAN." });
  }
});

router.delete("/:id/vlans/:vlanId", auth, canAccess("s41", "delete"), async (req, res) => {
  try {
    await pool.query("DELETE FROM firewall_vlans WHERE id=$1 AND firewall_id=$2", [req.params.vlanId, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao remover VLAN." }); }
});

// ── Links Vinculados ao Firewall ──────────────────────────────────

router.get("/:id/links", auth, canAccess("s41"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT fl.id, fl.firewall_id AS "firewallId", fl.link_id AS "linkId",
              fl.portas, fl.ip_fixo AS "ipFixo",
              CONCAT(l.tipo, ' — ', s.name, ' — ', f.nome) AS "provedorLabel"
         FROM firewall_links fl
         LEFT JOIN links l ON l.id = fl.link_id
         LEFT JOIN suppliers s ON s.id = l.fornecedor_id
         LEFT JOIN network_filiais f ON f.id = l.filial_id
        WHERE fl.firewall_id=$1 ORDER BY fl.created_at`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar links vinculados." }); }
});

router.post("/:id/links", auth, canAccess("s41", "insert"), async (req, res) => {
  const { linkId, portas, ipFixo } = req.body;
  try {
    const r = await pool.query(
      "INSERT INTO firewall_links (firewall_id, link_id, portas, ip_fixo) VALUES ($1,$2,$3,$4) RETURNING id",
      [req.params.id, linkId||null, portas?.trim()||null, ipFixo?.trim()||null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao vincular link." }); }
});

router.put("/:id/links/:flId", auth, canAccess("s41", "edit"), async (req, res) => {
  const { linkId, portas, ipFixo } = req.body;
  try {
    const r = await pool.query(
      "UPDATE firewall_links SET link_id=$1, portas=$2, ip_fixo=$3, updated_at=NOW() WHERE id=$4 AND firewall_id=$5 RETURNING id",
      [linkId||null, portas?.trim()||null, ipFixo?.trim()||null, req.params.flId, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar link vinculado." }); }
});

router.delete("/:id/links/:flId", auth, canAccess("s41", "delete"), async (req, res) => {
  try {
    await pool.query("DELETE FROM firewall_links WHERE id=$1 AND firewall_id=$2", [req.params.flId, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao remover link vinculado." }); }
});

module.exports = router;
