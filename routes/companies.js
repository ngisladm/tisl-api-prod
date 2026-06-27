const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const FIELDS = `id, name, razao_social AS "razaoSocial", cnpj,
  insc_estadual AS "inscEstadual", insc_municipal AS "inscMunicipal",
  logradouro, numero, bairro, cep, cidade, estado,
  representante_legal AS "representanteLegal", active, created_at`;

// GET /companies
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${FIELDS} FROM companies ORDER BY name`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar empresas." });
  }
});

// GET /companies/:id/logo
router.get("/:id/logo", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT logo FROM companies WHERE id=$1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Empresa não encontrada." });
    res.json({ logo: result.rows[0].logo || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar logo." });
  }
});

// PUT /companies/:id/logo
router.put("/:id/logo", auth, async (req, res) => {
  const { logo } = req.body;
  try {
    const result = await pool.query(
      "UPDATE companies SET logo=$1 WHERE id=$2 RETURNING id",
      [logo || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Empresa não encontrada." });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar logo." });
  }
});

// POST /companies
router.post("/", auth, async (req, res) => {
  const { name, razaoSocial, cnpj, inscEstadual, inscMunicipal,
          logradouro, numero, bairro, cep, cidade, estado,
          representanteLegal, active = true } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome Fantasia é obrigatório." });
  try {
    const result = await pool.query(
      `INSERT INTO companies
         (name, razao_social, cnpj, insc_estadual, insc_municipal,
          logradouro, numero, bairro, cep, cidade, estado,
          representante_legal, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${FIELDS}`,
      [name.trim(), razaoSocial||null, cnpj||null, inscEstadual||null, inscMunicipal||null,
       logradouro||null, numero||null, bairro||null, cep||null, cidade||null, estado||null,
       representanteLegal||null, active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar empresa." });
  }
});

// PUT /companies/:id
router.put("/:id", auth, async (req, res) => {
  const { name, razaoSocial, cnpj, inscEstadual, inscMunicipal,
          logradouro, numero, bairro, cep, cidade, estado,
          representanteLegal, active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome Fantasia é obrigatório." });
  try {
    const result = await pool.query(
      `UPDATE companies SET
         name=$1, razao_social=$2, cnpj=$3, insc_estadual=$4, insc_municipal=$5,
         logradouro=$6, numero=$7, bairro=$8, cep=$9, cidade=$10, estado=$11,
         representante_legal=$12, active=$13
       WHERE id=$14
       RETURNING ${FIELDS}`,
      [name.trim(), razaoSocial||null, cnpj||null, inscEstadual||null, inscMunicipal||null,
       logradouro||null, numero||null, bairro||null, cep||null, cidade||null, estado||null,
       representanteLegal||null, active, req.params.id]
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
