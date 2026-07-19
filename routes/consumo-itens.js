const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET / — todos os itens
router.get("/", auth, canAccess("s45"), async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM consumo_itens ORDER BY item");
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// GET /basic — sem canAccess (uso em selects de outras telas)
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM consumo_itens ORDER BY item");
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// POST /
router.post("/", auth, canAccess("s45"), async (req, res) => {
  const { item } = req.body;
  if (!item?.trim()) return res.status(400).json({ error: "Item é obrigatório." });
  try {
    const r = await pool.query(
      "INSERT INTO consumo_itens (item) VALUES ($1) RETURNING *",
      [item.trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Item já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao criar item." });
  }
});

// PUT /:id
router.put("/:id", auth, canAccess("s45"), async (req, res) => {
  const { item } = req.body;
  if (!item?.trim()) return res.status(400).json({ error: "Item é obrigatório." });
  try {
    const r = await pool.query(
      "UPDATE consumo_itens SET item=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [item.trim(), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Item já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao atualizar item." });
  }
});

// DELETE /:id
router.delete("/:id", auth, canAccess("s45"), async (req, res) => {
  try {
    await pool.query("DELETE FROM consumo_itens WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir item." }); }
});

module.exports = router;
