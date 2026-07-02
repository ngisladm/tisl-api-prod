const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const parseDate = str => {
  if (!str) return null;
  const [d,m,y] = str.split("/");
  if (!d||!m||!y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

// ── Férias (cabeçalho) ──────────────────────────────────────────

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.id, f.ano,
              f.company_id AS "companyId", c.name AS "companyName",
              f.team_id    AS "teamId",    t.name AS "teamName"
         FROM ferias f
         LEFT JOIN companies c ON c.id = f.company_id
         LEFT JOIN teams     t ON t.id = f.team_id
        ORDER BY f.ano DESC, c.name, t.name`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar férias." }); }
});

router.post("/", auth, async (req, res) => {
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

router.put("/:id", auth, async (req, res) => {
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

router.delete("/:id", auth, async (req, res) => {
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
