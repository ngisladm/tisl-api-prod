const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /profiles
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, permissions, created_at FROM profiles ORDER BY name"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar perfis." });
  }
});

// POST /profiles
router.post("/", auth, async (req, res) => {
  const { name, permissions = {} } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });

  try {
    const result = await pool.query(
      "INSERT INTO profiles (name, permissions) VALUES ($1, $2) RETURNING *",
      [name.trim(), JSON.stringify(permissions)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar perfil." });
  }
});

// PUT /profiles/:id
router.put("/:id", auth, async (req, res) => {
  const { name, permissions } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });

  try {
    const result = await pool.query(
      "UPDATE profiles SET name=$1, permissions=$2 WHERE id=$3 RETURNING *",
      [name.trim(), JSON.stringify(permissions), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Perfil não encontrado." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar perfil." });
  }
});

// DELETE /profiles/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM profiles WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir perfil." });
  }
});

module.exports = router;
