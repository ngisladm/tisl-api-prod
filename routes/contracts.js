const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

const UPLOAD_DIR = process.env.UPLOAD_DIR_CONTRACTS || (process.platform === "win32" ? "C:/uploads/contratos" : "/app/uploads/contratos");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

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
         ct.frequencia,
         CASE WHEN ct.data_fim IS NOT NULL AND ct.data_fim <= CURRENT_DATE
              THEN 'Inativo' ELSE 'Ativo' END AS status,
         c.name  AS "companyName",
         s.name  AS "supplierName"
    FROM contracts ct
    JOIN companies c ON c.id = ct.company_id
    JOIN suppliers s ON s.id = ct.supplier_id
`;

// GET /contracts/report
router.get("/report", auth, async (req, res) => {
  const { companyId, supplierId, contractNumber, dateFrom, dateTo, status, frequencia } = req.query;
  const params = [];
  const where  = [];

  if (companyId)      { params.push(companyId);             where.push(`ct.company_id      = $${params.length}::uuid`); }
  if (supplierId)     { params.push(supplierId);            where.push(`ct.supplier_id     = $${params.length}::uuid`); }
  if (contractNumber) { params.push(`%${contractNumber}%`); where.push(`ct.contract_number ILIKE $${params.length}`); }
  if (dateFrom)       { params.push(parseDate(dateFrom));   where.push(`ct.data_inicio >= $${params.length}::date`); }
  if (dateTo)         { params.push(parseDate(dateTo));     where.push(`ct.data_fim    <= $${params.length}::date`); }
  if (frequencia)     { params.push(frequencia);            where.push(`ct.frequencia = $${params.length}`); }
  if (status === "Inativo") { where.push(`(ct.data_fim IS NOT NULL AND ct.data_fim <= CURRENT_DATE)`); }
  if (status === "Ativo")   { where.push(`(ct.data_fim IS NULL OR ct.data_fim > CURRENT_DATE)`); }

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
  const { companyId, supplierId, contractNumber, dataInicio, dataFim, valor, valorAtual, observacao, attachments, frequencia } = req.body;
  if (!companyId || !supplierId)
    return res.status(400).json({ error: "Empresa e Fornecedor são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO contracts (company_id, supplier_id, contract_number, data_inicio, data_fim, valor, valor_atual, observacao, attachments, frequencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [companyId, supplierId, contractNumber||null, parseDate(dataInicio), parseDate(dataFim),
       valor||null, valorAtual||null, observacao||null, JSON.stringify(attachments||[]), frequencia||null]
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
  const { companyId, supplierId, contractNumber, dataInicio, dataFim, valor, valorAtual, observacao, attachments, frequencia } = req.body;
  if (!companyId || !supplierId)
    return res.status(400).json({ error: "Empresa e Fornecedor são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE contracts
          SET company_id=$1, supplier_id=$2, contract_number=$3, data_inicio=$4, data_fim=$5,
              valor=$6, valor_atual=$7, observacao=$8, attachments=$9, frequencia=$10, updated_at=NOW()
        WHERE id=$11`,
      [companyId, supplierId, contractNumber||null, parseDate(dataInicio), parseDate(dataFim),
       valor||null, valorAtual||null, observacao||null, JSON.stringify(attachments||[]), frequencia||null, req.params.id]
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
    const ar = await pool.query("SELECT filename FROM contracts_anexos WHERE contract_id=$1", [req.params.id]);
    for (const a of ar.rows) {
      const fp = path.join(UPLOAD_DIR, a.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query("DELETE FROM contracts WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir contrato." });
  }
});

// GET /contracts/download/:filename  ← ANTES de /:id
router.get("/download/:filename", auth, (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "Arquivo não encontrado." });
  res.download(fp);
});

// DELETE /contracts/anexos/:anexoId  ← ANTES de /:id
router.delete("/anexos/:anexoId", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT filename FROM contracts_anexos WHERE id=$1", [req.params.anexoId]);
    if (r.rows[0]) {
      const fp = path.join(UPLOAD_DIR, r.rows[0].filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await pool.query("DELETE FROM contracts_anexos WHERE id=$1", [req.params.anexoId]);
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir anexo." }); }
});

// GET /contracts/:id/anexos
router.get("/:id/anexos", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, nome_original AS \"nomeOriginal\", filename FROM contracts_anexos WHERE contract_id=$1 ORDER BY created_at",
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar anexos." }); }
});

// POST /contracts/:id/anexos
router.post("/:id/anexos", auth, upload.array("files", 10), async (req, res) => {
  try {
    const inserted = [];
    for (const f of (req.files || [])) {
      const r = await pool.query(
        "INSERT INTO contracts_anexos (contract_id, nome_original, filename) VALUES ($1,$2,$3) RETURNING id, nome_original AS \"nomeOriginal\", filename",
        [req.params.id, f.originalname, f.filename]
      );
      inserted.push(r.rows[0]);
    }
    res.status(201).json(inserted);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar anexos." }); }
});

module.exports = router;
