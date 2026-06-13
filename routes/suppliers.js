const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM suppliers ORDER BY name");
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar fornecedores." });
  }
});

router.post("/", auth, async (req, res) => {
  const { name, cnpj, contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do fornecedor é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO suppliers (name, cnpj, contact_name, contact_phone, contact_email, observacao)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, cnpj,
                 contact_name  AS "contactName",
                 contact_phone AS "contactPhone",
                 contact_email AS "contactEmail",
                 observacao`,
      [name.trim(), cnpj||null, contactName||null, contactPhone||null, contactEmail||null, observacao||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar fornecedor." });
  }
});

router.put("/:id", auth, async (req, res) => {
  const { name, cnpj, contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do fornecedor é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE suppliers
          SET name=$1, cnpj=$2, contact_name=$3, contact_phone=$4, contact_email=$5,
              observacao=$6, updated_at=NOW()
        WHERE id=$7
       RETURNING id, name, cnpj,
                 contact_name  AS "contactName",
                 contact_phone AS "contactPhone",
                 contact_email AS "contactEmail",
                 observacao`,
      [name.trim(), cnpj||null, contactName||null, contactPhone||null, contactEmail||null, observacao||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar fornecedor." });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM suppliers WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir fornecedor." });
  }
});

module.exports = router;
