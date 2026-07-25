const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const parseDate = (str) => {
  if (!str) return null;
  if (str.includes("/")) {
    const [d, m, y] = str.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return str;
};

const INDICADOR_RETURNING = `
  RETURNING id, team_id AS "teamId", nome, unidade, meta,
            periodicidade, origem, direcao, limite_maximo AS "limiteMaximo", ativo,
            created_at AS "createdAt"`;

// ── INDICADORES (catálogo) ──────────────────────────────────────

// GET /indicadores?teamId=
router.get("/", auth, canAccess("s58"), async (req, res) => {
  const { teamId } = req.query;
  const params = [];
  const where  = [];
  if (teamId) { params.push(teamId); where.push(`i.team_id = $${params.length}`); }
  try {
    const r = await pool.query(
      `SELECT i.id, i.team_id AS "teamId", t.name AS "teamName",
              i.nome, i.unidade, i.meta, i.periodicidade, i.origem, i.direcao,
              i.limite_maximo AS "limiteMaximo", i.ativo,
              i.created_at AS "createdAt"
         FROM indicadores i
         JOIN teams t ON t.id = i.team_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY t.name, i.nome`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar indicadores." });
  }
});

router.post("/", auth, canAccess("s58", "edit"), async (req, res) => {
  const { teamId, nome, unidade, meta, periodicidade, origem, direcao, limiteMaximo, ativo = true } = req.body;
  if (!teamId || !nome?.trim())
    return res.status(400).json({ error: "Equipe e Nome são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO indicadores (team_id, nome, unidade, meta, periodicidade, origem, direcao, limite_maximo, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ${INDICADOR_RETURNING}`,
      [teamId, nome.trim(), unidade || null, meta ?? null,
       periodicidade || "Mensal", origem || "Manual", direcao || "Maior", limiteMaximo ?? null, ativo]
    );
    const row = r.rows[0];
    const t = await pool.query("SELECT name FROM teams WHERE id=$1", [teamId]);
    row.teamName = t.rows[0]?.name;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar indicador." });
  }
});

router.put("/:id", auth, canAccess("s58", "edit"), async (req, res) => {
  const { teamId, nome, unidade, meta, periodicidade, origem, direcao, limiteMaximo, ativo } = req.body;
  if (!teamId || !nome?.trim())
    return res.status(400).json({ error: "Equipe e Nome são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE indicadores SET
         team_id=$1, nome=$2, unidade=$3, meta=$4, periodicidade=$5, origem=$6, direcao=$7,
         limite_maximo=$8, ativo=$9,
         updated_at=NOW()
       WHERE id=$10
       ${INDICADOR_RETURNING}`,
      [teamId, nome.trim(), unidade || null, meta ?? null,
       periodicidade || "Mensal", origem || "Manual", direcao || "Maior", limiteMaximo ?? null, ativo, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Indicador não encontrado." });
    const row = r.rows[0];
    const t = await pool.query("SELECT name FROM teams WHERE id=$1", [teamId]);
    row.teamName = t.rows[0]?.name;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar indicador." });
  }
});

router.delete("/:id", auth, canAccess("s58", "edit"), async (req, res) => {
  try {
    const check = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM indicador_lancamentos WHERE indicador_id=$1",
      [req.params.id]
    );
    if (check.rows[0].cnt > 0)
      return res.status(400).json({ error: "Este indicador possui lançamentos. Exclua os lançamentos antes de excluir o indicador." });
    await pool.query("DELETE FROM indicadores WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir indicador." });
  }
});

// ── LANÇAMENTOS ──────────────────────────────────────────────────

const LANCAMENTO_SELECT = `
  SELECT l.id, l.indicador_id AS "indicadorId",
         i.nome AS "indicadorNome", i.unidade, i.meta, i.direcao,
         i.limite_maximo AS "limiteMaximo", i.team_id AS "teamId",
         t.name AS "teamName",
         TO_CHAR(l.data_referencia,'DD/MM/YYYY') AS "dataReferencia",
         l.valor_realizado AS "valorRealizado", l.observacao,
         l.created_at AS "createdAt"
    FROM indicador_lancamentos l
    JOIN indicadores i ON i.id = l.indicador_id
    JOIN teams t        ON t.id = i.team_id`;

// GET /indicadores/lancamentos?teamId=&indicadorId=&dateFrom=&dateTo=  (deve vir antes de /:id)
router.get("/lancamentos", auth, canAccess("s59"), async (req, res) => {
  const { teamId, indicadorId, dateFrom, dateTo } = req.query;
  const params = [];
  const where  = [];
  if (teamId)      { params.push(teamId);            where.push(`i.team_id = $${params.length}`); }
  if (indicadorId) { params.push(indicadorId);        where.push(`l.indicador_id = $${params.length}`); }
  if (dateFrom)    { params.push(parseDate(dateFrom)); where.push(`l.data_referencia >= $${params.length}::date`); }
  if (dateTo)      { params.push(parseDate(dateTo));   where.push(`l.data_referencia <= $${params.length}::date`); }
  try {
    const r = await pool.query(
      `${LANCAMENTO_SELECT}
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY l.data_referencia DESC, t.name, i.nome`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar lançamentos." });
  }
});

router.post("/lancamentos", auth, canAccess("s59", "edit"), async (req, res) => {
  const { indicadorId, dataReferencia, valorRealizado, observacao } = req.body;
  if (!indicadorId || !dataReferencia || valorRealizado == null)
    return res.status(400).json({ error: "Indicador, Data de Referência e Valor Realizado são obrigatórios." });
  const dt = parseDate(dataReferencia);
  try {
    const r = await pool.query(
      `INSERT INTO indicador_lancamentos (indicador_id, data_referencia, valor_realizado, observacao)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (indicador_id, data_referencia) DO NOTHING
       RETURNING id`,
      [indicadorId, dt, valorRealizado, observacao || null]
    );
    if (!r.rows[0])
      return res.status(409).json({ error: "Já existe um lançamento deste indicador para esta data de referência." });
    const row = await pool.query(`${LANCAMENTO_SELECT} WHERE l.id=$1`, [r.rows[0].id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar lançamento." });
  }
});

router.put("/lancamentos/:id", auth, canAccess("s59", "edit"), async (req, res) => {
  const { indicadorId, dataReferencia, valorRealizado, observacao } = req.body;
  if (!indicadorId || !dataReferencia || valorRealizado == null)
    return res.status(400).json({ error: "Indicador, Data de Referência e Valor Realizado são obrigatórios." });
  const dt = parseDate(dataReferencia);
  try {
    const r = await pool.query(
      `UPDATE indicador_lancamentos SET
         indicador_id=$1, data_referencia=$2, valor_realizado=$3, observacao=$4, updated_at=NOW()
       WHERE id=$5
       RETURNING id`,
      [indicadorId, dt, valorRealizado, observacao || null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Lançamento não encontrado." });
    const row = await pool.query(`${LANCAMENTO_SELECT} WHERE l.id=$1`, [req.params.id]);
    res.json(row.rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Já existe um lançamento deste indicador para esta data de referência." });
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar lançamento." });
  }
});

router.delete("/lancamentos/:id", auth, canAccess("s59", "edit"), async (req, res) => {
  try {
    await pool.query("DELETE FROM indicador_lancamentos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir lançamento." });
  }
});

// GET /indicadores/report?dateFrom=&dateTo=&teamId=&indicadorId=  (deve vir antes de /:id)
router.get("/report", auth, canAccess("s60"), async (req, res) => {
  const { teamId, indicadorId, dateFrom, dateTo } = req.query;
  const params = [];
  const where  = [];
  if (teamId)      { params.push(teamId);            where.push(`i.team_id = $${params.length}`); }
  if (indicadorId) { params.push(indicadorId);        where.push(`l.indicador_id = $${params.length}`); }
  if (dateFrom)    { params.push(parseDate(dateFrom)); where.push(`l.data_referencia >= $${params.length}::date`); }
  if (dateTo)      { params.push(parseDate(dateTo));   where.push(`l.data_referencia <= $${params.length}::date`); }
  try {
    const r = await pool.query(
      `${LANCAMENTO_SELECT}
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY t.name, l.data_referencia, i.nome`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de indicadores." });
  }
});

// GET /indicadores/meses-disponiveis?teamId=&indicadorId=  (deve vir antes de /:id)
router.get("/meses-disponiveis", auth, canAccess("s62"), async (req, res) => {
  const { teamId, indicadorId } = req.query;
  const params = [];
  const where  = [];
  if (teamId)      { params.push(teamId);     where.push(`i.team_id = $${params.length}`); }
  if (indicadorId) { params.push(indicadorId); where.push(`l.indicador_id = $${params.length}`); }
  try {
    const r = await pool.query(
      `SELECT DISTINCT TO_CHAR(l.data_referencia,'YYYY-MM') AS mes
         FROM indicador_lancamentos l
         JOIN indicadores i ON i.id = l.indicador_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY mes DESC`,
      params
    );
    res.json(r.rows.map(row => row.mes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar meses disponíveis." });
  }
});

// GET /indicadores/comparativo?teamId=&indicadorId=&months=YYYY-MM,YYYY-MM  (deve vir antes de /:id)
router.get("/comparativo", auth, canAccess("s62"), async (req, res) => {
  const { teamId, indicadorId, months } = req.query;
  const params = [];
  const where  = [];
  if (teamId)      { params.push(teamId);     where.push(`i.team_id = $${params.length}`); }
  if (indicadorId) { params.push(indicadorId); where.push(`l.indicador_id = $${params.length}`); }
  if (months) {
    params.push(months.split(",").filter(Boolean));
    where.push(`TO_CHAR(l.data_referencia,'YYYY-MM') = ANY($${params.length}::text[])`);
  }
  try {
    const r = await pool.query(
      `${LANCAMENTO_SELECT}
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY t.name, i.nome, l.data_referencia`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar comparativo de indicadores." });
  }
});

// GET /indicadores/:id  (deve vir por último, depois das rotas estáticas acima)
router.get("/:id", auth, canAccess("s58"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.team_id AS "teamId", t.name AS "teamName",
              i.nome, i.unidade, i.meta, i.periodicidade, i.origem, i.direcao,
              i.limite_maximo AS "limiteMaximo", i.ativo,
              i.created_at AS "createdAt"
         FROM indicadores i
         JOIN teams t ON t.id = i.team_id
        WHERE i.id=$1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Indicador não encontrado." });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar indicador." });
  }
});

module.exports = router;
