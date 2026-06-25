const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM tipo_ativos ORDER BY name");
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar tipos de ativo." }); }
});

router.post("/", auth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      "INSERT INTO tipo_ativos (name) VALUES ($1) RETURNING *", [name.trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Tipo de ativo já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao criar tipo de ativo." });
  }
});

router.put("/:id", auth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      "UPDATE tipo_ativos SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [name.trim(), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Tipo de ativo já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao atualizar tipo de ativo." });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM tipo_ativos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir tipo de ativo." }); }
});

module.exports = router;
