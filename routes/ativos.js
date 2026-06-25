const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.nome, a.tipo_ativo_id AS "tipoAtivoId", ta.name AS "tipoAtivoName"
         FROM ativos a
         LEFT JOIN tipo_ativos ta ON ta.id = a.tipo_ativo_id
        ORDER BY a.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar ativos." }); }
});

router.post("/", auth, async (req, res) => {
  const { nome, tipoAtivoId } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome do ativo é obrigatório." });
  try {
    const r = await pool.query(
      "INSERT INTO ativos (nome, tipo_ativo_id) VALUES ($1,$2) RETURNING id, nome, tipo_ativo_id AS \"tipoAtivoId\"",
      [nome.trim(), tipoAtivoId||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar ativo." }); }
});

router.put("/:id", auth, async (req, res) => {
  const { nome, tipoAtivoId } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome do ativo é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE ativos SET nome=$1, tipo_ativo_id=$2, updated_at=NOW() WHERE id=$3
       RETURNING id, nome, tipo_ativo_id AS "tipoAtivoId"`,
      [nome.trim(), tipoAtivoId||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Ativo não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar ativo." }); }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM ativos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir ativo." }); }
});

module.exports = router;
