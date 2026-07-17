const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET /links
router.get("/", auth, canAccess("s40"), async (req, res) => {
  const { empresaContratanteId, empresaBeneficiariaId, filialId, fornecedorId, numeroSerie, numeroConta, cnpjContratante } = req.query;
  try {
    let where = [];
    let params = [];
    let i = 1;
    if (empresaContratanteId) { where.push(`l.empresa_contratante_id=$${i++}`); params.push(empresaContratanteId); }
    if (empresaBeneficiariaId) { where.push(`l.empresa_beneficiaria_id=$${i++}`); params.push(empresaBeneficiariaId); }
    if (filialId) { where.push(`l.filial_id=$${i++}`); params.push(filialId); }
    if (fornecedorId) { where.push(`l.fornecedor_id=$${i++}`); params.push(fornecedorId); }
    if (numeroSerie?.trim()) { where.push(`l.numero_serie ILIKE $${i++}`); params.push(`%${numeroSerie.trim()}%`); }
    if (numeroConta?.trim()) { where.push(`l.numero_conta ILIKE $${i++}`); params.push(`%${numeroConta.trim()}%`); }
    if (cnpjContratante?.trim()) { where.push(`ec.cnpj ILIKE $${i++}`); params.push(`%${cnpjContratante.trim()}%`); }

    const sql = `
      SELECT l.id, l.tipo,
             l.empresa_contratante_id AS "empresaContratanteId", ec.name AS "empresaContratanteNome", ec.cnpj AS "cnpjContratante",
             l.empresa_beneficiaria_id AS "empresaBeneficiariaId", eb.name AS "empresaBeneficiariaNome",
             l.filial_id AS "filialId", f.nome AS "filialNome",
             f.logradouro, f.numero AS "filialNumero", f.bairro, f.cidade, f.estado, f.cep, f.complemento,
             l.ccusto,
             l.fornecedor_id AS "fornecedorId", s.name AS "fornecedorNome", s.contact_phone AS "contato",
             l.velocidade, l.contract_id AS "contractId",
             CONCAT(s2.name, ' — ', ct.contract_number) AS "contratoLabel",
             l.email_conta AS "emailConta", l.senha_conta AS "senhaConta",
             l.vr_equipamento AS "vrEquipamento", l.vr_mensal AS "vrMensal",
             l.numero_serie AS "numeroSerie", l.numero_conta AS "numeroConta",
             l.plano, l.observacao, l.status, l.created_at AS "createdAt"
        FROM links l
        LEFT JOIN companies ec ON ec.id = l.empresa_contratante_id
        LEFT JOIN companies eb ON eb.id = l.empresa_beneficiaria_id
        LEFT JOIN network_filiais f ON f.id = l.filial_id
        LEFT JOIN suppliers s ON s.id = l.fornecedor_id
        LEFT JOIN contracts ct ON ct.id = l.contract_id
        LEFT JOIN suppliers s2 ON s2.id = ct.supplier_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY l.created_at DESC`;
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar links." }); }
});

// POST /links
router.post("/", auth, canAccess("s40", "insert"), async (req, res) => {
  const { tipo, empresaContratanteId, empresaBeneficiariaId, filialId, ccusto, fornecedorId,
          velocidade, contractId, emailConta, senhaConta, vrEquipamento, vrMensal,
          numeroSerie, numeroConta, plano, observacao, status = "Ativo" } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO links (tipo, empresa_contratante_id, empresa_beneficiaria_id, filial_id, ccusto,
         fornecedor_id, velocidade, contract_id, email_conta, senha_conta, vr_equipamento, vr_mensal,
         numero_serie, numero_conta, plano, observacao, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [tipo||null, empresaContratanteId||null, empresaBeneficiariaId||null, filialId||null,
       ccusto?.trim()||null, fornecedorId||null, velocidade?.trim()||null, contractId||null,
       emailConta?.trim()||null, senhaConta?.trim()||null,
       vrEquipamento||null, vrMensal||null, numeroSerie?.trim()||null, numeroConta?.trim()||null,
       plano?.trim()||null, observacao?.trim()||null, status]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar link." }); }
});

// PUT /links/:id
router.put("/:id", auth, canAccess("s40", "edit"), async (req, res) => {
  const { tipo, empresaContratanteId, empresaBeneficiariaId, filialId, ccusto, fornecedorId,
          velocidade, contractId, emailConta, senhaConta, vrEquipamento, vrMensal,
          numeroSerie, numeroConta, plano, observacao, status } = req.body;
  try {
    const r = await pool.query(
      `UPDATE links SET tipo=$1, empresa_contratante_id=$2, empresa_beneficiaria_id=$3, filial_id=$4,
         ccusto=$5, fornecedor_id=$6, velocidade=$7, contract_id=$8, email_conta=$9, senha_conta=$10,
         vr_equipamento=$11, vr_mensal=$12, numero_serie=$13, numero_conta=$14, plano=$15,
         observacao=$16, status=$17, updated_at=NOW()
       WHERE id=$18 RETURNING id`,
      [tipo||null, empresaContratanteId||null, empresaBeneficiariaId||null, filialId||null,
       ccusto?.trim()||null, fornecedorId||null, velocidade?.trim()||null, contractId||null,
       emailConta?.trim()||null, senhaConta?.trim()||null,
       vrEquipamento||null, vrMensal||null, numeroSerie?.trim()||null, numeroConta?.trim()||null,
       plano?.trim()||null, observacao?.trim()||null, status, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Link não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar link." }); }
});

// DELETE /links/:id
router.delete("/:id", auth, canAccess("s40", "delete"), async (req, res) => {
  try {
    await pool.query("DELETE FROM links WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir link." }); }
});

// GET /links/report
router.get("/report", auth, async (req, res) => {
  const { tipo, empresaContratanteId, cnpjContratante, filialId, ccusto, fornecedorId, status } = req.query;
  try {
    const where = [];
    const params = [];
    let i = 1;
    if (tipo?.trim())                { where.push(`l.tipo ILIKE $${i++}`);                     params.push(`%${tipo.trim()}%`); }
    if (empresaContratanteId)        { where.push(`l.empresa_contratante_id=$${i++}`);          params.push(empresaContratanteId); }
    if (cnpjContratante?.trim())     { where.push(`ec.cnpj ILIKE $${i++}`);                    params.push(`%${cnpjContratante.trim()}%`); }
    if (filialId)                    { where.push(`l.filial_id=$${i++}`);                       params.push(filialId); }
    if (ccusto?.trim())              { where.push(`l.ccusto ILIKE $${i++}`);                    params.push(`%${ccusto.trim()}%`); }
    if (fornecedorId)                { where.push(`l.fornecedor_id=$${i++}`);                   params.push(fornecedorId); }
    if (status?.trim())              { where.push(`l.status=$${i++}`);                          params.push(status.trim()); }

    const r = await pool.query(
      `SELECT l.id, l.tipo,
              l.filial_id AS "filialId", nf.nome AS "filialNome",
              nf.logradouro, nf.numero AS "filialNumero", nf.bairro, nf.cidade, nf.estado, nf.cep, nf.complemento,
              l.empresa_contratante_id AS "empresaContratanteId", ec.name AS "empresaContratanteNome", ec.cnpj AS "cnpjContratante",
              l.ccusto, l.fornecedor_id AS "fornecedorId", s.name AS "fornecedorNome", s.contact_phone AS "contato",
              l.velocidade, l.email_conta AS "emailConta", l.senha_conta AS "senhaConta",
              l.numero_serie AS "numeroSerie", l.numero_conta AS "numeroConta", l.status
         FROM links l
         LEFT JOIN network_filiais nf ON nf.id = l.filial_id
         LEFT JOIN companies ec ON ec.id = l.empresa_contratante_id
         LEFT JOIN suppliers s ON s.id = l.fornecedor_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY nf.nome NULLS LAST, l.tipo`,
      params
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao gerar relatório de links." }); }
});

// POST /links/import — importação CSV
router.post("/import", auth, canAccess("s40", "insert"), async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "Nenhuma linha para importar." });

  const errors = [];
  let imported = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    try {
      // Resolve empresa contratante pelo nome
      let ecId = null;
      if (row["Empresa Contratante"]) {
        const ec = await pool.query("SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1", [row["Empresa Contratante"].trim()]);
        ecId = ec.rows[0]?.id || null;
      }
      // Resolve empresa beneficiária pelo nome
      let ebId = null;
      if (row["Empresa Beneficiária"]) {
        const eb = await pool.query("SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1", [row["Empresa Beneficiária"].trim()]);
        ebId = eb.rows[0]?.id || null;
      }
      // Resolve filial pelo nome
      let filialId = null;
      if (row["Filial"]) {
        const f = await pool.query("SELECT id FROM network_filiais WHERE nome ILIKE $1 LIMIT 1", [row["Filial"].trim()]);
        filialId = f.rows[0]?.id || null;
      }
      // Resolve fornecedor pelo nome
      let fornecedorId = null;
      if (row["Fornecedor"]) {
        const s = await pool.query("SELECT id FROM suppliers WHERE name ILIKE $1 LIMIT 1", [row["Fornecedor"].trim()]);
        fornecedorId = s.rows[0]?.id || null;
      }

      const vrEq  = row["Vr Equipamento"] ? parseFloat(row["Vr Equipamento"].replace(",",".")) : null;
      const vrMen = row["Vr Mensal"]      ? parseFloat(row["Vr Mensal"].replace(",","."))      : null;

      await pool.query(
        `INSERT INTO links (tipo, empresa_contratante_id, empresa_beneficiaria_id, filial_id, ccusto,
           fornecedor_id, velocidade, email_conta, senha_conta, vr_equipamento, vr_mensal,
           numero_serie, numero_conta, plano, observacao, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [row["Tipo"]||null, ecId, ebId, filialId, row["CCusto"]?.trim()||null,
         fornecedorId, row["Velocidade"]?.trim()||null,
         row["Email conta"]?.trim()||null, row["Senha conta"]?.trim()||null,
         vrEq, vrMen, row["Numero Série"]?.trim()||null, row["Numero Conta"]?.trim()||null,
         row["Plano"]?.trim()||null, row["Observação"]?.trim()||null, row["Status"]||"Ativo"]
      );
      imported++;
    } catch (e) {
      errors.push({ linha: idx + 2, erro: e.message });
    }
  }
  res.json({ imported, errors });
});

module.exports = router;
