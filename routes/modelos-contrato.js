const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /modelos-contrato
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT mc.id, mc.nome, mc.tipo_ativo_id AS "tipoAtivoId", ta.name AS "tipoAtivoName",
              mc.empresa_id AS "empresaId", c.name AS "empresaName"
         FROM modelos_contrato mc
         LEFT JOIN tipo_ativos ta ON ta.id = mc.tipo_ativo_id
         LEFT JOIN companies   c  ON c.id  = mc.empresa_id
        ORDER BY mc.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar modelos." }); }
});

// POST /modelos-contrato
router.post("/", auth, async (req, res) => {
  const { nome, tipoAtivoId, empresaId } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome do modelo é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO modelos_contrato (nome, tipo_ativo_id, empresa_id)
       VALUES ($1,$2,$3)
       RETURNING id, nome, tipo_ativo_id AS "tipoAtivoId", empresa_id AS "empresaId"`,
      [nome.trim(), tipoAtivoId || null, empresaId || null]
    );
    res.status(201).json({ ...r.rows[0], tipoAtivoName: null, empresaName: null });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar modelo." }); }
});

// PUT /modelos-contrato/:id
router.put("/:id", auth, async (req, res) => {
  const { nome, tipoAtivoId, empresaId } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome do modelo é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE modelos_contrato SET nome=$1, tipo_ativo_id=$2, empresa_id=$3, updated_at=NOW() WHERE id=$4
       RETURNING id, nome, tipo_ativo_id AS "tipoAtivoId", empresa_id AS "empresaId"`,
      [nome.trim(), tipoAtivoId || null, empresaId || null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Modelo não encontrado." });
    const ta = tipoAtivoId ? await pool.query("SELECT name FROM tipo_ativos WHERE id=$1", [tipoAtivoId]) : { rows: [] };
    const co = empresaId   ? await pool.query("SELECT name FROM companies  WHERE id=$1", [empresaId])   : { rows: [] };
    res.json({ ...r.rows[0], tipoAtivoName: ta.rows[0]?.name || null, empresaName: co.rows[0]?.name || null });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar modelo." }); }
});

// DELETE /modelos-contrato/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM modelos_contrato WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir modelo." }); }
});

// GET /modelos-contrato/:id/conteudo
router.get("/:id/conteudo", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT conteudo FROM modelos_contrato WHERE id=$1", [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Modelo não encontrado." });
    res.json({ conteudo: r.rows[0].conteudo || "" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar conteúdo." }); }
});

// PUT /modelos-contrato/:id/conteudo
router.put("/:id/conteudo", auth, async (req, res) => {
  const { conteudo } = req.body;
  try {
    const r = await pool.query(
      "UPDATE modelos_contrato SET conteudo=$1, updated_at=NOW() WHERE id=$2 RETURNING id",
      [conteudo || "", req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Modelo não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar conteúdo." }); }
});

module.exports = router;
