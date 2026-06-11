const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /teams
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, active FROM teams ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar equipes." });
  }
});

// GET /teams/:id/users  — usuários da equipe (para o calendário)
router.get("/:id/users", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name FROM users WHERE team_id = $1 AND active = TRUE ORDER BY name",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar usuários da equipe." });
  }
});

// POST /teams
router.post("/", auth, async (req, res) => {
  const { name, active = true } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const result = await pool.query(
      "INSERT INTO teams (name, active) VALUES ($1, $2) RETURNING *",
      [name.trim(), active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar equipe." });
  }
});

// PUT /teams/:id
router.put("/:id", auth, async (req, res) => {
  const { name, active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const result = await pool.query(
      "UPDATE teams SET name=$1, active=$2 WHERE id=$3 RETURNING *",
      [name.trim(), active, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Equipe não encontrada." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar equipe." });
  }
});

// DELETE /teams/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM teams WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir equipe." });
  }
});

module.exports = router;
