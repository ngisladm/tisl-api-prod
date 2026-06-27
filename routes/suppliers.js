const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const RETURNING = `
  RETURNING id, name, razao_social AS "razaoSocial", cnpj,
    insc_estadual AS "inscEstadual", insc_municipal AS "inscMunicipal",
    logradouro, numero, bairro, cep, cidade, estado,
    contact_name  AS "contactName",
    contact_phone AS "contactPhone",
    contact_email AS "contactEmail",
    observacao`;

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, razao_social AS "razaoSocial", cnpj,
         insc_estadual AS "inscEstadual", insc_municipal AS "inscMunicipal",
         logradouro, numero, bairro, cep, cidade, estado,
         contact_name  AS "contactName",
         contact_phone AS "contactPhone",
         contact_email AS "contactEmail",
         observacao
       FROM suppliers ORDER BY name`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar fornecedores." });
  }
});

router.post("/", auth, async (req, res) => {
  const { name, razaoSocial, cnpj, inscEstadual, inscMunicipal,
          logradouro, numero, bairro, cep, cidade, estado,
          contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome Fantasia é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO suppliers
         (name, razao_social, cnpj, insc_estadual, insc_municipal,
          logradouro, numero, bairro, cep, cidade, estado,
          contact_name, contact_phone, contact_email, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ${RETURNING}`,
      [name.trim(), razaoSocial||null, cnpj||null, inscEstadual||null, inscMunicipal||null,
       logradouro||null, numero||null, bairro||null, cep||null, cidade||null, estado||null,
       contactName||null, contactPhone||null, contactEmail||null, observacao||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar fornecedor." });
  }
});

router.put("/:id", auth, async (req, res) => {
  const { name, razaoSocial, cnpj, inscEstadual, inscMunicipal,
          logradouro, numero, bairro, cep, cidade, estado,
          contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome Fantasia é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE suppliers SET
         name=$1, razao_social=$2, cnpj=$3, insc_estadual=$4, insc_municipal=$5,
         logradouro=$6, numero=$7, bairro=$8, cep=$9, cidade=$10, estado=$11,
         contact_name=$12, contact_phone=$13, contact_email=$14, observacao=$15,
         updated_at=NOW()
       WHERE id=$16
       ${RETURNING}`,
      [name.trim(), razaoSocial||null, cnpj||null, inscEstadual||null, inscMunicipal||null,
       logradouro||null, numero||null, bairro||null, cep||null, cidade||null, estado||null,
       contactName||null, contactPhone||null, contactEmail||null, observacao||null,
       req.params.id]
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
