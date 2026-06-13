const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const parseDate = (str) => {
  if (!str) return null;
  if (str.includes("/")) {
    const [d, m, y] = str.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return str;
};

const BASE_SELECT = `
  SELECT ct.id,
         ct.company_id      AS "companyId",
         ct.supplier_id     AS "supplierId",
         ct.contract_number AS "contractNumber",
         TO_CHAR(ct.data_inicio,'DD/MM/YYYY') AS "dataInicio",
         TO_CHAR(ct.data_fim,   'DD/MM/YYYY') AS "dataFim",
         ct.valor,
         ct.valor_atual     AS "valorAtual",
         ct.observacao,
         ct.attachments,
         c.name  AS "companyName",
         s.name  AS "supplierName"
    FROM contracts ct
    JOIN companies c ON c.id = ct.company_id
    JOIN suppliers s ON s.id = ct.supplier_id
`;

// GET /contracts/report
router.get("/report", auth, async (req, res) => {
  const { companyId, supplierId, contractNumber, dateFrom, dateTo } = req.query;
  const params = [];
  const where  = [];

  if (companyId)      { params.push(companyId);               where.push(`ct.company_id      = $${params.length}::uuid`); }
  if (supplierId)     { params.push(supplierId);              where.push(`ct.supplier_id     = $${params.length}::uuid`); }
  if (contractNumber) { params.push(`%${contractNumber}%`);   where.push(`ct.contract_number ILIKE $${params.length}`); }
  if (dateFrom)       { params.push(parseDate(dateFrom));     where.push(`ct.data_inicio >= $${params.length}::date`); }
  if (dateTo)         { params.push(parseDate(dateTo));       where.push(`ct.data_fim    <= $${params.length}::date`); }

  const sql = `${BASE_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.name, ct.contract_number`;
  try {
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de contratos." });
  }
});

// GET /contracts
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(`${BASE_SELECT} ORDER BY s.name, ct.contract_number`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar contratos." });
  }
});

// POST /contracts
router.post("/", auth, async (req, res) => {
  const { companyId, supplierId, contractNumber, dataInicio, dataFim, valor, valorAtual, observacao, attachments } = req.body;
  if (!companyId || !supplierId)
    return res.status(400).json({ error: "Empresa e Fornecedor são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO contracts (company_id, supplier_id, contract_number, data_inicio, data_fim, valor, valor_atual, observacao, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [companyId, supplierId, contractNumber||null, parseDate(dataInicio), parseDate(dataFim),
       valor||null, valorAtual||null, observacao||null, JSON.stringify(attachments||[])]
    );
    const row = await pool.query(`${BASE_SELECT} WHERE ct.id=$1`, [r.rows[0].id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar contrato." });
  }
});

// PUT /contracts/:id
router.put("/:id", auth, async (req, res) => {
  const { companyId, supplierId, contractNumber, dataInicio, dataFim, valor, valorAtual, observacao, attachments } = req.body;
  if (!companyId || !supplierId)
    return res.status(400).json({ error: "Empresa e Fornecedor são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE contracts
          SET company_id=$1, supplier_id=$2, contract_number=$3, data_inicio=$4, data_fim=$5,
              valor=$6, valor_atual=$7, observacao=$8, attachments=$9, updated_at=NOW()
        WHERE id=$10`,
      [companyId, supplierId, contractNumber||null, parseDate(dataInicio), parseDate(dataFim),
       valor||null, valorAtual||null, observacao||null, JSON.stringify(attachments||[]), req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Não encontrado." });
    const row = await pool.query(`${BASE_SELECT} WHERE ct.id=$1`, [req.params.id]);
    res.json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar contrato." });
  }
});

// DELETE /contracts/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM contracts WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir contrato." });
  }
});

module.exports = router;
