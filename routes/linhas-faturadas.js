const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /linhas-faturadas
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT lf.id, lf.mes_ano AS "mesAno",
              lf.operadora_id AS "operadoraId", o.name AS "operadoraName",
              lf.company_id   AS "companyId",   c.name AS "companyName",
              COUNT(i.id)::int AS "totalItens",
              lf.created_at AS "createdAt"
         FROM linhas_faturadas lf
         LEFT JOIN operadoras  o ON o.id = lf.operadora_id
         LEFT JOIN companies   c ON c.id = lf.company_id
         LEFT JOIN itens_linhas_faturadas i ON i.linha_faturada_id = lf.id
        GROUP BY lf.id, o.name, c.name
        ORDER BY lf.mes_ano DESC, o.name`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar linhas faturadas." });
  }
});

// POST /linhas-faturadas
router.post("/", auth, async (req, res) => {
  const { operadoraId, companyId, mesAno } = req.body;
  if (!operadoraId || !mesAno?.trim())
    return res.status(400).json({ error: "Operadora e Mês/Ano são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO linhas_faturadas (operadora_id, company_id, mes_ano)
       VALUES ($1, $2, $3)
       RETURNING id, operadora_id AS "operadoraId", company_id AS "companyId", mes_ano AS "mesAno"`,
      [operadoraId, companyId||null, mesAno.trim()]
    );
    const row = r.rows[0];
    const op = await pool.query("SELECT name FROM operadoras WHERE id=$1", [operadoraId]);
    const co = companyId ? await pool.query("SELECT name FROM companies WHERE id=$1", [companyId]) : null;
    row.operadoraName = op.rows[0]?.name;
    row.companyName   = co?.rows[0]?.name || null;
    row.totalItens = 0;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar linha faturada." });
  }
});

// PUT /linhas-faturadas/:id
router.put("/:id", auth, async (req, res) => {
  const { operadoraId, companyId, mesAno } = req.body;
  if (!operadoraId || !mesAno?.trim())
    return res.status(400).json({ error: "Operadora e Mês/Ano são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE linhas_faturadas SET operadora_id=$1, company_id=$2, mes_ano=$3, updated_at=NOW()
        WHERE id=$4
       RETURNING id, operadora_id AS "operadoraId", company_id AS "companyId", mes_ano AS "mesAno"`,
      [operadoraId, companyId||null, mesAno.trim(), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Linha não encontrada." });
    const row = r.rows[0];
    const op = await pool.query("SELECT name FROM operadoras WHERE id=$1", [operadoraId]);
    const co = companyId ? await pool.query("SELECT name FROM companies WHERE id=$1", [companyId]) : null;
    row.operadoraName = op.rows[0]?.name;
    row.companyName   = co?.rows[0]?.name || null;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar linha faturada." });
  }
});

// DELETE /linhas-faturadas/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_linhas_faturadas WHERE linha_faturada_id=$1", [req.params.id]);
    await pool.query("DELETE FROM linhas_faturadas WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir linha faturada." });
  }
});

// GET /linhas-faturadas/itens/all — resumo de todos os itens para filtros na tela principal
router.get("/itens/all", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.linha_faturada_id AS "linhaFaturadaId", i.numero_linha AS "numeroLinha"
         FROM itens_linhas_faturadas i
        WHERE i.numero_linha IS NOT NULL AND i.numero_linha <> ''`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// GET /linhas-faturadas/:id/itens
router.get("/:id/itens", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.numero_linha AS "numeroLinha", i.plano,
              i.consumo_linha AS "consumoLinha", i.valor_linha AS "valorLinha",
              lf.mes_ano AS "mesAno",
              o.name AS "operadoraName",
              c.name AS "companyName"
         FROM itens_linhas_faturadas i
         JOIN linhas_faturadas lf ON lf.id = i.linha_faturada_id
         JOIN operadoras  o ON o.id = lf.operadora_id
         LEFT JOIN companies c ON c.id = lf.company_id
        WHERE i.linha_faturada_id=$1
        ORDER BY i.numero_linha`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar itens." });
  }
});

// POST /linhas-faturadas/:id/itens/importar
router.post("/:id/itens/importar", auth, async (req, res) => {
  const { itens } = req.body;
  if (!Array.isArray(itens) || itens.length === 0)
    return res.status(400).json({ error: "Nenhum item para importar." });
  try {
    await pool.query("DELETE FROM itens_linhas_faturadas WHERE linha_faturada_id=$1", [req.params.id]);
    for (const item of itens) {
      await pool.query(
        `INSERT INTO itens_linhas_faturadas (linha_faturada_id, numero_linha, plano, consumo_linha, valor_linha)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, item.numeroLinha||null, item.plano||null, item.consumoLinha||null, item.valorLinha||null]
      );
    }
    res.json({ success: true, total: itens.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao importar itens." });
  }
});

// POST /linhas-faturadas/:id/gerar-linhas-disponiveis
router.post("/:id/gerar-linhas-disponiveis", auth, async (req, res) => {
  try {
    // Busca a linha faturada com operadora e empresa
    const lfResult = await pool.query(
      `SELECT lf.operadora_id, lf.company_id, o.name AS "operadoraName"
         FROM linhas_faturadas lf
         LEFT JOIN operadoras o ON o.id = lf.operadora_id
        WHERE lf.id=$1`, [req.params.id]
    );
    if (!lfResult.rows[0]) return res.status(404).json({ error: "Linha faturada não encontrada." });
    const { operadora_id, company_id } = lfResult.rows[0];

    // Verifica se existe tipo_ativo "Telefonia"
    const taResult = await pool.query(
      "SELECT id FROM tipo_ativos WHERE LOWER(name)='telefonia' LIMIT 1"
    );
    if (!taResult.rows[0])
      return res.status(400).json({ error: "É necessário cadastrar um Tipo de Ativo chamado 'Telefonia' antes de gerar as linhas disponíveis." });
    const tipoAtivoId = taResult.rows[0].id;

    // Busca itens da linha faturada
    const itensResult = await pool.query(
      "SELECT numero_linha FROM itens_linhas_faturadas WHERE linha_faturada_id=$1 AND numero_linha IS NOT NULL",
      [req.params.id]
    );

    let inseridos = 0, ignorados = 0;
    for (const item of itensResult.rows) {
      // Verifica duplicidade por operadora + numero_linha
      const existe = await pool.query(
        "SELECT id FROM linhas_disponiveis WHERE operadora_id=$1 AND numero_linha=$2",
        [operadora_id, item.numero_linha]
      );
      if (existe.rows.length > 0) { ignorados++; continue; }
      await pool.query(
        `INSERT INTO linhas_disponiveis (company_id, operadora_id, tipo_ativo_id, numero_linha, status)
         VALUES ($1,$2,$3,$4,'Em análise')`,
        [company_id, operadora_id, tipoAtivoId, item.numero_linha]
      );
      inseridos++;
    }
    res.json({ success: true, inseridos, ignorados, total: itensResult.rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao gerar linhas disponíveis." }); }
});

module.exports = router;
