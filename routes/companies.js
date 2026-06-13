const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /companies
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, cnpj, active, created_at FROM companies ORDER BY name"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar empresas." });
  }
});

// POST /companies
router.post("/", auth, async (req, res) => {
  const { name, cnpj, active = true } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });

  try {
    const result = await pool.query(
      "INSERT INTO companies (name, cnpj, active) VALUES ($1, $2, $3) RETURNING *",
      [name.trim(), cnpj||null, active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar empresa." });
  }
});

// PUT /companies/:id
router.put("/:id", auth, async (req, res) => {
  const { name, cnpj, active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });

  try {
    const result = await pool.query(
      "UPDATE companies SET name=$1, cnpj=$2, active=$3 WHERE id=$4 RETURNING *",
      [name.trim(), cnpj||null, active, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Empresa não encontrada." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar empresa." });
  }
});

// DELETE /companies/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM companies WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir empresa." });
  }
});

module.exports = router;
