const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const parseDate = str => {
  if (!str) return null;
  const [d,m,y] = str.split("/");
  if (!d||!m||!y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

// ── Relatório de Férias (s31) ───────────────────────────────────

router.get("/relatorio", auth, canAccess("s31"), async (req, res) => {
  const {
    companyId, teamIds, ano, funcionarioId, chamado,
    diasNaoProgramados,
    dtInicFerDe, dtInicFerAte,
    dtInicProgrDe, dtInicProgrAte,
  } = req.query;

  const conditions = [];
  const params = [];
  let idx = 1;

  if (companyId)     { conditions.push(`f.company_id = $${idx++}`);      params.push(companyId); }

  if (teamIds) {
    const ids = teamIds.split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length === 1) { conditions.push(`f.team_id = $${idx++}`); params.push(ids[0]); }
    else if (ids.length > 1) { conditions.push(`f.team_id = ANY($${idx++})`); params.push(ids); }
  }

  if (ano)           { conditions.push(`f.ano = $${idx++}`);             params.push(parseInt(ano)); }
  if (funcionarioId) { conditions.push(`fe.funcionario_id = $${idx++}`); params.push(funcionarioId); }
  if (chamado)       { conditions.push(`fe.chamado ILIKE $${idx++}`);    params.push(`%${chamado}%`); }

  // Filtro Dias não Programados — referencia o alias calculado via subquery p
  if (diasNaoProgramados === "zerado")
    conditions.push(`((fe.total_dias - fe.dias_vendidos) - COALESCE(p.soma_qtde, 0)) = 0`);
  else if (diasNaoProgramados === "naoZerado")
    conditions.push(`((fe.total_dias - fe.dias_vendidos) - COALESCE(p.soma_qtde, 0)) <> 0`);

  // Período Inic Férias — fe.data_ferias
  if (dtInicFerDe)  { conditions.push(`fe.data_ferias >= $${idx++}`); params.push(dtInicFerDe); }
  if (dtInicFerAte) { conditions.push(`fe.data_ferias <= $${idx++}`); params.push(dtInicFerAte); }

  // Período Inic Progr. — EXISTS em periodos_ferias.data_inicial
  if (dtInicProgrDe || dtInicProgrAte) {
    let sub = `EXISTS (SELECT 1 FROM periodos_ferias pf WHERE pf.ferias_equipe_id = fe.id`;
    if (dtInicProgrDe)  { sub += ` AND pf.data_inicial >= $${idx++}`; params.push(dtInicProgrDe); }
    if (dtInicProgrAte) { sub += ` AND pf.data_inicial <= $${idx++}`; params.push(dtInicProgrAte); }
    conditions.push(sub + ")");
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  try {
    const equipeRows = await pool.query(
      `SELECT fe.id                                                            AS "feriasEquipeId",
              f.ano,
              c.name                                                           AS "empresaNome",
              t.name                                                           AS "equipeNome",
              fn.nome                                                          AS "funcionarioNome",
              TO_CHAR(fe.data_limite,'DD/MM/YYYY')                            AS "dataLimite",
              TO_CHAR(fe.data_ferias,'DD/MM/YYYY')                            AS "dtInicFer",
              TO_CHAR(fe.dt_final_fer,'DD/MM/YYYY')                           AS "dtFinalFer",
              fe.chamado,
              fe.total_dias                                                    AS "totalDias",
              fe.dias_vendidos                                                 AS "diasVendidos",
              (fe.total_dias - fe.dias_vendidos)                              AS "diasGozo",
              COALESCE(p.soma_qtde, 0)                                        AS "somaQtde",
              ((fe.total_dias - fe.dias_vendidos) - COALESCE(p.soma_qtde,0)) AS "saldoDias"
         FROM ferias_equipe fe
         JOIN ferias        f  ON f.id  = fe.ferias_id
         LEFT JOIN companies   c  ON c.id  = f.company_id
         LEFT JOIN teams       t  ON t.id  = f.team_id
         LEFT JOIN funcionarios fn ON fn.id = fe.funcionario_id
         LEFT JOIN (
           SELECT ferias_equipe_id, SUM(qtde_dias) AS soma_qtde
             FROM periodos_ferias GROUP BY ferias_equipe_id
         ) p ON p.ferias_equipe_id = fe.id
         ${where}
         ORDER BY f.ano DESC, c.name, t.name, fn.nome`,
      params
    );

    if (!equipeRows.rows.length) return res.json([]);

    const ids = equipeRows.rows.map(r => r.feriasEquipeId);
    const periodosRows = await pool.query(
      `SELECT ferias_equipe_id                   AS "feriasEquipeId",
              TO_CHAR(data_inicial,'DD/MM/YYYY') AS "dataInicial",
              TO_CHAR(data_final,'DD/MM/YYYY')   AS "dataFinal",
              qtde_dias                          AS "qtdeDias",
              status
         FROM periodos_ferias
        WHERE ferias_equipe_id = ANY($1)
        ORDER BY data_inicial`,
      [ids]
    );

    const periodosMap = {};
    for (const p of periodosRows.rows) {
      if (!periodosMap[p.feriasEquipeId]) periodosMap[p.feriasEquipeId] = [];
      periodosMap[p.feriasEquipeId].push({
        dataInicial: p.dataInicial,
        dataFinal:   p.dataFinal,
        qtdeDias:    p.qtdeDias,
        status:      p.status,
      });
    }

    res.json(equipeRows.rows.map(r => ({ ...r, periodos: periodosMap[r.feriasEquipeId] || [] })));
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao gerar relatório de férias." }); }
});

// ── Férias (cabeçalho) ──────────────────────────────────────────

router.get("/", auth, canAccess("s30"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.id, f.ano,
              f.company_id AS "companyId", c.name AS "companyName",
              f.team_id    AS "teamId",    t.name AS "teamName",
              COUNT(fe.id)::int AS "totalFuncionarios"
         FROM ferias f
         LEFT JOIN companies    c  ON c.id  = f.company_id
         LEFT JOIN teams        t  ON t.id  = f.team_id
         LEFT JOIN ferias_equipe fe ON fe.ferias_id = f.id
        GROUP BY f.id, c.name, t.name
        ORDER BY f.ano DESC, c.name, t.name`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar férias." }); }
});

router.post("/", auth, canAccess("s30","edit"), async (req, res) => {
  const { companyId, teamId, ano } = req.body;
  if (!ano) return res.status(400).json({ error: "Ano é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO ferias (company_id, team_id, ano) VALUES ($1,$2,$3) RETURNING id`,
      [companyId||null, teamId||null, parseInt(ano)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar férias." }); }
});

router.put("/:id", auth, canAccess("s30","edit"), async (req, res) => {
  const { companyId, teamId, ano } = req.body;
  if (!ano) return res.status(400).json({ error: "Ano é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE ferias SET company_id=$1, team_id=$2, ano=$3, updated_at=NOW() WHERE id=$4 RETURNING id`,
      [companyId||null, teamId||null, parseInt(ano), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar férias." }); }
});

router.delete("/:id", auth, canAccess("s30","edit"), async (req, res) => {
  try {
    await pool.query("DELETE FROM ferias WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir férias." }); }
});

// ── Férias Equipe ───────────────────────────────────────────────

router.get("/:id/equipe", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT fe.id,
              fe.ferias_id       AS "feriasId",
              fe.funcionario_id  AS "funcionarioId",
              fn.nome            AS "funcionarioNome",
              TO_CHAR(fe.data_limite,'DD/MM/YYYY')  AS "dataLimite",
              TO_CHAR(fe.data_ferias,'DD/MM/YYYY')      AS "dtInicFer",
              TO_CHAR(fe.dt_final_fer,'DD/MM/YYYY')    AS "dtFinalFer",
              fe.chamado,
              fe.total_dias      AS "totalDias",
              fe.dias_vendidos   AS "diasVendidos",
              (fe.total_dias - fe.dias_vendidos)                              AS "diasGozo",
              COALESCE(p.soma_qtde, 0)                                        AS "somaQtde",
              ((fe.total_dias - fe.dias_vendidos) - COALESCE(p.soma_qtde,0)) AS "saldoDias"
         FROM ferias_equipe fe
         LEFT JOIN funcionarios fn ON fn.id = fe.funcionario_id
         LEFT JOIN (
           SELECT ferias_equipe_id, SUM(qtde_dias) AS soma_qtde
             FROM periodos_ferias
            GROUP BY ferias_equipe_id
         ) p ON p.ferias_equipe_id = fe.id
        WHERE fe.ferias_id=$1
        ORDER BY fn.nome`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar equipe de férias." }); }
});

router.post("/:id/equipe", auth, async (req, res) => {
  const { funcionarioId, dataLimite, dtInicFer, dtFinalFer, chamado, totalDias, diasVendidos } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO ferias_equipe (ferias_id, funcionario_id, data_limite, data_ferias, dt_final_fer, chamado, total_dias, dias_vendidos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.params.id, funcionarioId||null, parseDate(dataLimite), parseDate(dtInicFer), parseDate(dtFinalFer), chamado||null,
       parseInt(totalDias)||30, parseInt(diasVendidos)||0]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar item de férias." }); }
});

router.put("/:id/equipe/:equipeId", auth, async (req, res) => {
  const { funcionarioId, dataLimite, dtInicFer, dtFinalFer, chamado, totalDias, diasVendidos } = req.body;
  try {
    const r = await pool.query(
      `UPDATE ferias_equipe
          SET funcionario_id=$1, data_limite=$2, data_ferias=$3, dt_final_fer=$4, chamado=$5,
              total_dias=$6, dias_vendidos=$7, updated_at=NOW()
        WHERE id=$8 AND ferias_id=$9 RETURNING id`,
      [funcionarioId||null, parseDate(dataLimite), parseDate(dtInicFer), parseDate(dtFinalFer), chamado||null,
       parseInt(totalDias)||30, parseInt(diasVendidos)||0,
       req.params.equipeId, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Item não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar item de férias." }); }
});

router.delete("/:id/equipe/:equipeId", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM ferias_equipe WHERE id=$1 AND ferias_id=$2",
      [req.params.equipeId, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir item de férias." }); }
});

// ── Períodos de Férias ──────────────────────────────────────────

router.get("/:id/equipe/:equipeId/periodos", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id,
              ferias_equipe_id             AS "feriasEquipeId",
              TO_CHAR(data_inicial,'DD/MM/YYYY') AS "dataInicial",
              TO_CHAR(data_final,'DD/MM/YYYY')   AS "dataFinal",
              qtde_dias AS "qtdeDias",
              status
         FROM periodos_ferias
        WHERE ferias_equipe_id=$1
        ORDER BY data_inicial`,
      [req.params.equipeId]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar períodos de férias." }); }
});

router.post("/:id/equipe/:equipeId/periodos", auth, async (req, res) => {
  const { dataInicial, dataFinal, status } = req.body;
  const di = parseDate(dataInicial);
  const df = parseDate(dataFinal);
  let qtdeDias = 0;
  if (di && df) {
    const d1 = new Date(di), d2 = new Date(df);
    qtdeDias = Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
  }
  try {
    const r = await pool.query(
      `INSERT INTO periodos_ferias (ferias_equipe_id, data_inicial, data_final, qtde_dias, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.params.equipeId, di, df, qtdeDias, status||'Pendente']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar período de férias." }); }
});

router.put("/:id/equipe/:equipeId/periodos/:periodoId", auth, async (req, res) => {
  const { dataInicial, dataFinal, status } = req.body;
  const di = parseDate(dataInicial);
  const df = parseDate(dataFinal);
  let qtdeDias = 0;
  if (di && df) {
    const d1 = new Date(di), d2 = new Date(df);
    qtdeDias = Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
  }
  try {
    const r = await pool.query(
      `UPDATE periodos_ferias SET data_inicial=$1, data_final=$2, qtde_dias=$3, status=$4, updated_at=NOW()
       WHERE id=$5 AND ferias_equipe_id=$6 RETURNING id`,
      [di, df, qtdeDias, status||'Pendente', req.params.periodoId, req.params.equipeId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Período não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar período de férias." }); }
});

router.delete("/:id/equipe/:equipeId/periodos/:periodoId", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM periodos_ferias WHERE id=$1 AND ferias_equipe_id=$2",
      [req.params.periodoId, req.params.equipeId]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir período de férias." }); }
});

module.exports = router;
