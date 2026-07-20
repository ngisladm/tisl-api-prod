const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET / — todos os centros de custo
router.get("/", auth, canAccess("s44"), async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, centro_custo AS "centroCusto", descricao, created_at, updated_at FROM consumo_ccusto ORDER BY centro_custo`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar centros de custo." }); }
});

// GET /basic — sem canAccess (uso em selects de outras telas)
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, centro_custo AS "centroCusto", descricao, created_at, updated_at FROM consumo_ccusto ORDER BY centro_custo`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar centros de custo." }); }
});

// POST /
router.post("/", auth, canAccess("s44"), async (req, res) => {
  const { centroCusto, descricao } = req.body;
  if (!centroCusto?.trim()) return res.status(400).json({ error: "Centro de custo é obrigatório." });
  try {
    const r = await pool.query(
      "INSERT INTO consumo_ccusto (centro_custo, descricao) VALUES ($1, $2) RETURNING *",
      [centroCusto.trim(), descricao?.trim() || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Centro de custo já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao criar centro de custo." });
  }
});

// PUT /:id
router.put("/:id", auth, canAccess("s44"), async (req, res) => {
  const { centroCusto, descricao } = req.body;
  if (!centroCusto?.trim()) return res.status(400).json({ error: "Centro de custo é obrigatório." });
  try {
    const r = await pool.query(
      "UPDATE consumo_ccusto SET centro_custo=$1, descricao=$2, updated_at=NOW() WHERE id=$3 RETURNING *",
      [centroCusto.trim(), descricao?.trim() || null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Centro de custo já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao atualizar centro de custo." });
  }
});

// DELETE /:id
router.delete("/:id", auth, canAccess("s44"), async (req, res) => {
  try {
    await pool.query("DELETE FROM consumo_ccusto WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir centro de custo." }); }
});

module.exports = router;
