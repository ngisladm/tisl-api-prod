const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const FIELDS = `id, name, contact_name AS "contactName", contact_phone AS "contactPhone", contact_email AS "contactEmail", observacao, created_at, updated_at`;

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${FIELDS} FROM operadoras ORDER BY name`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar operadoras." });
  }
});

router.post("/", auth, async (req, res) => {
  const { name, contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO operadoras (name, contact_name, contact_phone, contact_email, observacao)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${FIELDS}`,
      [name.trim(), contactName||null, contactPhone||null, contactEmail||null, observacao||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Operadora já cadastrada." });
    console.error(err);
    res.status(500).json({ error: "Erro ao criar operadora." });
  }
});

router.put("/:id", auth, async (req, res) => {
  const { name, contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE operadoras SET name=$1, contact_name=$2, contact_phone=$3, contact_email=$4, observacao=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING ${FIELDS}`,
      [name.trim(), contactName||null, contactPhone||null, contactEmail||null, observacao||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Operadora não encontrada." });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Operadora já cadastrada." });
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar operadora." });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM operadoras WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir operadora." });
  }
});

module.exports = router;
