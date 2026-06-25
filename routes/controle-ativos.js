const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// ── Controle de Ativos (cabeçalho) ──────────────────────────

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ca.id, ca.nome_funcionario AS "nomeFuncionario", ca.cpf,
              COUNT(i.id)::int AS "totalItens",
              ca.created_at AS "createdAt"
         FROM controle_ativos ca
         LEFT JOIN itens_controle_ativos i ON i.controle_ativo_id = ca.id
        GROUP BY ca.id
        ORDER BY ca.nome_funcionario`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar controle de ativos." }); }
});

router.post("/", auth, async (req, res) => {
  const { nomeFuncionario, cpf } = req.body;
  if (!nomeFuncionario?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO controle_ativos (nome_funcionario, cpf)
       VALUES ($1,$2)
       RETURNING id, nome_funcionario AS "nomeFuncionario", cpf`,
      [nomeFuncionario.trim(), cpf||null]
    );
    res.status(201).json({ ...r.rows[0], totalItens: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar registro." }); }
});

router.put("/:id", auth, async (req, res) => {
  const { nomeFuncionario, cpf } = req.body;
  if (!nomeFuncionario?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE controle_ativos SET nome_funcionario=$1, cpf=$2, updated_at=NOW() WHERE id=$3
       RETURNING id, nome_funcionario AS "nomeFuncionario", cpf`,
      [nomeFuncionario.trim(), cpf||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar registro." }); }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_controle_ativos WHERE controle_ativo_id=$1", [req.params.id]);
    await pool.query("DELETE FROM controle_ativos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir registro." }); }
});

// ── Itens de Controle de Ativos ───────────────────────────────

router.get("/:id/itens", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.imei, i.numero_serie AS "numeroSerie", i.numero_documento AS "numeroDocumento",
              i.attachments,
              i.company_id    AS "companyId",    c.name  AS "companyName",
              i.tipo_ativo_id AS "tipoAtivoId",  ta.name AS "tipoAtivoName",
              i.operadora_id  AS "operadoraId",  o.name  AS "operadoraName",
              i.linha_id      AS "linhaId",       ld.numero_linha AS "numeroLinha",
              i.ativo_id      AS "ativoId",       a.nome  AS "ativoNome"
         FROM itens_controle_ativos i
         LEFT JOIN companies     c  ON c.id  = i.company_id
         LEFT JOIN tipo_ativos   ta ON ta.id = i.tipo_ativo_id
         LEFT JOIN operadoras    o  ON o.id  = i.operadora_id
         LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
         LEFT JOIN ativos        a  ON a.id  = i.ativo_id
        WHERE i.controle_ativo_id=$1
        ORDER BY i.created_at`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

router.post("/:id/itens", auth, async (req, res) => {
  const { companyId, tipoAtivoId, operadoraId, linhaId, imei, ativoId, numeroSerie, numeroDocumento } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO itens_controle_ativos
         (controle_ativo_id, company_id, tipo_ativo_id, operadora_id, linha_id, imei, ativo_id, numero_serie, numero_documento, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]')
       RETURNING id, company_id AS "companyId", tipo_ativo_id AS "tipoAtivoId",
                 operadora_id AS "operadoraId", linha_id AS "linhaId",
                 imei, ativo_id AS "ativoId", numero_serie AS "numeroSerie",
                 numero_documento AS "numeroDocumento", attachments`,
      [req.params.id, companyId||null, tipoAtivoId||null, operadoraId||null,
       linhaId||null, imei||null, ativoId||null, numeroSerie||null, numeroDocumento||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar item." }); }
});

router.put("/:id/itens/:itemId", auth, async (req, res) => {
  const { companyId, tipoAtivoId, operadoraId, linhaId, imei, ativoId, numeroSerie, numeroDocumento } = req.body;
  try {
    const r = await pool.query(
      `UPDATE itens_controle_ativos
          SET company_id=$1, tipo_ativo_id=$2, operadora_id=$3, linha_id=$4,
              imei=$5, ativo_id=$6, numero_serie=$7, numero_documento=$8, updated_at=NOW()
        WHERE id=$9 AND controle_ativo_id=$10
       RETURNING id`,
      [companyId||null, tipoAtivoId||null, operadoraId||null, linhaId||null,
       imei||null, ativoId||null, numeroSerie||null, numeroDocumento||null,
       req.params.itemId, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Item não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar item." }); }
});

router.delete("/:id/itens/:itemId", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_controle_ativos WHERE id=$1 AND controle_ativo_id=$2",
      [req.params.itemId, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir item." }); }
});

// ── Anexos do item ────────────────────────────────────────────

router.put("/:id/itens/:itemId/anexos", auth, async (req, res) => {
  const { attachments } = req.body;
  try {
    await pool.query(
      "UPDATE itens_controle_ativos SET attachments=$1, updated_at=NOW() WHERE id=$2 AND controle_ativo_id=$3",
      [JSON.stringify(attachments||[]), req.params.itemId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar anexos." }); }
});

module.exports = router;
