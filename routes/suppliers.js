const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const RETURNING = `
  RETURNING id, name, razao_social AS "razaoSocial",
    tipo, cnpj,
    insc_estadual AS "inscEstadual", insc_municipal AS "inscMunicipal",
    logradouro, numero, bairro, cep, cidade, estado, pais,
    contact_name  AS "contactName",
    contact_phone AS "contactPhone",
    contact_email AS "contactEmail",
    observacao`;

// GET /suppliers/busca-base?q=... — busca no MSSQL para autocompletar
router.get("/busca-base", auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  try {
    const { getPool, sql } = require("../db-mssql");
    const mssql = await getPool();
    const result = await mssql.request()
      .input("q", sql.NVarChar, `%${q.trim()}%`)
      .query(`
        WITH enderecos AS (
          SELECT *,
                 ROW_NUMBER() OVER (PARTITION BY CodigoFornecedor ORDER BY CodigoFornecedor) AS rn
          FROM GR_dim_Fornecedor_Endereco
        )
        SELECT TOP 20
          f.RazaoSocial,
          f.NomeFantasia,
          CASE
            WHEN p.TipoPessoa IN ('Jurídica','Juridica','J') THEN 'PJ'
            WHEN p.TipoPessoa IN ('Física','Fisica','F')     THEN 'PF'
            ELSE p.TipoPessoa
          END AS Tipo,
          p.CPF_CNPJ,
          p.RG_CGF,
          e.Endereco,
          p.Bairro,
          f.CEP,
          p.Municipio,
          p.Estado,
          p.Pais,
          CONCAT(e.DDD, e.Telefone) AS Telefone,
          e.Email
        FROM GR_dim_Fornecedor f
        JOIN enderecos   e ON e.CodigoFornecedor = f.CodigoFornecedor AND e.rn = 1
        JOIN GR_dim_Pessoa p ON p.CodigoPessoa   = f.CodigoPessoa
        WHERE (f.RazaoSocial LIKE @q OR p.CPF_CNPJ LIKE @q)
        ORDER BY f.RazaoSocial
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("MSSQL busca-base:", err.message);
    res.status(500).json({ error: "Erro ao buscar fornecedor base: " + err.message });
  }
});

// GET /suppliers
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, razao_social AS "razaoSocial",
         tipo, cnpj,
         insc_estadual AS "inscEstadual", insc_municipal AS "inscMunicipal",
         logradouro, numero, bairro, cep, cidade, estado, pais,
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

// POST /suppliers
router.post("/", auth, async (req, res) => {
  const { name, razaoSocial, tipo, cnpj, inscEstadual, inscMunicipal,
          logradouro, numero, bairro, cep, cidade, estado, pais,
          contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome Fantasia é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO suppliers
         (name, razao_social, tipo, cnpj, insc_estadual, insc_municipal,
          logradouro, numero, bairro, cep, cidade, estado, pais,
          contact_name, contact_phone, contact_email, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ${RETURNING}`,
      [name.trim(), razaoSocial||null, tipo||null, cnpj||null, inscEstadual||null, inscMunicipal||null,
       logradouro||null, numero||null, bairro||null, cep||null, cidade||null, estado||null, pais||null,
       contactName||null, contactPhone||null, contactEmail||null, observacao||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Já existe um fornecedor cadastrado com este CNPJ/CPF." });
    console.error(err);
    res.status(500).json({ error: "Erro ao criar fornecedor." });
  }
});

// PUT /suppliers/:id
router.put("/:id", auth, async (req, res) => {
  const { name, razaoSocial, tipo, cnpj, inscEstadual, inscMunicipal,
          logradouro, numero, bairro, cep, cidade, estado, pais,
          contactName, contactPhone, contactEmail, observacao } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome Fantasia é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE suppliers SET
         name=$1, razao_social=$2, tipo=$3, cnpj=$4, insc_estadual=$5, insc_municipal=$6,
         logradouro=$7, numero=$8, bairro=$9, cep=$10, cidade=$11, estado=$12, pais=$13,
         contact_name=$14, contact_phone=$15, contact_email=$16, observacao=$17,
         updated_at=NOW()
       WHERE id=$18
       ${RETURNING}`,
      [name.trim(), razaoSocial||null, tipo||null, cnpj||null, inscEstadual||null, inscMunicipal||null,
       logradouro||null, numero||null, bairro||null, cep||null, cidade||null, estado||null, pais||null,
       contactName||null, contactPhone||null, contactEmail||null, observacao||null,
       req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Já existe um fornecedor cadastrado com este CNPJ/CPF." });
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar fornecedor." });
  }
});

// DELETE /suppliers/:id
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
