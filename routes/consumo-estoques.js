const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const ESTOQUE_SELECT = `
  SELECT ce.id, ce.estoque, ce.ccusto_estoque_id AS "ccustoEstoqueId",
         cc.centro_custo AS "ccustoEstoque"
    FROM consumo_estoques ce
    LEFT JOIN consumo_ccusto cc ON cc.id = ce.ccusto_estoque_id
   ORDER BY ce.estoque`;

// GET / — todos os estoques
router.get("/", auth, canAccess("s46"), async (req, res) => {
  try {
    const r = await pool.query(ESTOQUE_SELECT);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar estoques." }); }
});

// GET /basic — sem canAccess (uso em selects de outras telas)
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(ESTOQUE_SELECT);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar estoques." }); }
});

// POST /
router.post("/", auth, canAccess("s46"), async (req, res) => {
  const { estoque, ccustoEstoqueId } = req.body;
  if (!estoque?.trim()) return res.status(400).json({ error: "Estoque é obrigatório." });
  try {
    const r = await pool.query(
      "INSERT INTO consumo_estoques (estoque, ccusto_estoque_id) VALUES ($1,$2) RETURNING id",
      [estoque.trim(), ccustoEstoqueId||null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Estoque já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao criar estoque." });
  }
});

// PUT /:id
router.put("/:id", auth, canAccess("s46"), async (req, res) => {
  const { estoque, ccustoEstoqueId } = req.body;
  if (!estoque?.trim()) return res.status(400).json({ error: "Estoque é obrigatório." });
  try {
    const r = await pool.query(
      "UPDATE consumo_estoques SET estoque=$1, ccusto_estoque_id=$2, updated_at=NOW() WHERE id=$3 RETURNING id",
      [estoque.trim(), ccustoEstoqueId||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Estoque já cadastrado." });
    console.error(err); res.status(500).json({ error: "Erro ao atualizar estoque." });
  }
});

// DELETE /:id
router.delete("/:id", auth, canAccess("s46"), async (req, res) => {
  try {
    await pool.query("DELETE FROM consumo_estoques WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir estoque." }); }
});

module.exports = router;
