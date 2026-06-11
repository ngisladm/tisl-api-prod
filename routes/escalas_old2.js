const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// ── Helpers ──────────────────────────────────────────────────
function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHHMM(mins) {
  if (!mins || mins <= 0) return "00:00";
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function turnoHoras(turno, isWeekendOrFeriado) {
  // Returns duration in minutes for each turno
  if (!isWeekendOrFeriado) {
    // Mon-Fri: turno1=00:00-07:30 (450min), turno2=17:30-00:00 (390min)
    return turno === "turno1" ? 450 : 390;
  } else {
    // Sat/Sun/Feriado: turno1=00:00-12:00 (720min), turno2=12:00-00:00 (720min)
    return 720;
  }
}

// GET /escalas
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.company_id AS "companyId", e.team_id AS "teamId",
              TO_CHAR(e.data_inicio,'DD/MM/YYYY') AS "dataInicio",
              TO_CHAR(e.data_fim,   'DD/MM/YYYY') AS "dataFim",
              c.name AS "companyName", t.name AS "teamName"
         FROM escalas e
         LEFT JOIN companies c ON c.id = e.company_id
         LEFT JOIN teams     t ON t.id = e.team_id
        ORDER BY e.data_inicio DESC, c.name, t.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar escalas." });
  }
});

// POST /escalas
router.post("/", auth, async (req, res) => {
  const { companyId, teamId, dataInicio, dataFim } = req.body;
  if (!companyId || !teamId || !dataInicio || !dataFim)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });

  // Parse dd/mm/yyyy -> yyyy-mm-dd
  const parseDate = (str) => {
    const [d,m,y] = str.split("/");
    return `${y}-${m}-${d}`;
  };

  try {
    const result = await pool.query(
      `INSERT INTO escalas (company_id, team_id, data_inicio, data_fim)
       VALUES ($1,$2,$3,$4)
       RETURNING id, company_id AS "companyId", team_id AS "teamId",
                 TO_CHAR(data_inicio,'DD/MM/YYYY') AS "dataInicio",
                 TO_CHAR(data_fim,   'DD/MM/YYYY') AS "dataFim"`,
      [companyId, teamId, parseDate(dataInicio), parseDate(dataFim)]
    );
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    res.status(201).json(row);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Já existe uma escala para esta equipe neste período." });
    console.error(err);
    res.status(500).json({ error: "Erro ao criar escala." });
  }
});

// PUT /escalas/:id
router.put("/:id", auth, async (req, res) => {
  const { companyId, teamId, dataInicio, dataFim } = req.body;
  if (!companyId || !teamId || !dataInicio || !dataFim)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });

  const parseDate = (str) => { const [d,m,y] = str.split("/"); return `${y}-${m}-${d}`; };

  try {
    const result = await pool.query(
      `UPDATE escalas SET company_id=$1, team_id=$2, data_inicio=$3, data_fim=$4
        WHERE id=$5
       RETURNING id, company_id AS "companyId", team_id AS "teamId",
                 TO_CHAR(data_inicio,'DD/MM/YYYY') AS "dataInicio",
                 TO_CHAR(data_fim,   'DD/MM/YYYY') AS "dataFim"`,
      [companyId, teamId, parseDate(dataInicio), parseDate(dataFim), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Escala não encontrada." });
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar escala." });
  }
});

// DELETE /escalas/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM escala_turnos WHERE escala_id=$1",[req.params.id]);
    await pool.query("DELETE FROM escalas WHERE id=$1",[req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir escala." });
  }
});

// GET /escalas/:id/turnos
router.get("/:id/turnos", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, escala_id AS "escalaId",
              TO_CHAR(turno_date,'YYYY-MM-DD') AS "turnoDate",
              turno, user_id AS "userId",
              is_feriado AS "isFeriado",
              TO_CHAR(hora_inicio, 'HH24:MI') AS "horaInicio",
              TO_CHAR(hora_fim,    'HH24:MI') AS "horaFim",
              TO_CHAR(extra_inicio,'HH24:MI') AS "extraInicio",
              TO_CHAR(extra_fim,   'HH24:MI') AS "extraFim",
              observacao
         FROM escala_turnos
        WHERE escala_id=$1
        ORDER BY turno_date, turno`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar turnos." });
  }
});

// POST /escalas/:id/turnos — upsert responsável do turno (dia+turno+userId)
router.post("/:id/turnos", auth, async (req, res) => {
  const { turnoDate, turno, userId } = req.body;
  if (!turnoDate || !turno) return res.status(400).json({ error: "turnoDate e turno são obrigatórios." });
  try {
    if (!userId) {
      await pool.query(
        "DELETE FROM escala_turnos WHERE escala_id=$1 AND turno_date=$2 AND turno=$3",
        [req.params.id, turnoDate, turno]
      );
    } else {
      // Determine default times based on day of week
      const d = new Date(turnoDate + "T12:00:00Z");
      const dow = d.getUTCDay(); // 0=Sun,6=Sat
      const isWeekend = dow === 0 || dow === 6;
      let horaInicio, horaFim;
      if (!isWeekend) {
        horaInicio = turno === "turno1" ? "00:00" : "17:30";
        horaFim    = turno === "turno1" ? "07:30" : "00:00";
      } else {
        horaInicio = turno === "turno1" ? "00:00" : "12:00";
        horaFim    = turno === "turno1" ? "12:00" : "00:00";
      }
      await pool.query(
        `INSERT INTO escala_turnos (escala_id, turno_date, turno, user_id, hora_inicio, hora_fim, is_feriado)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE)
         ON CONFLICT (escala_id, turno_date, turno)
         DO UPDATE SET user_id=$4, hora_inicio=COALESCE(escala_turnos.hora_inicio,$5), hora_fim=COALESCE(escala_turnos.hora_fim,$6)`,
        [req.params.id, turnoDate, turno, userId, horaInicio, horaFim]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar turno." });
  }
});

// PUT /escalas/:id/turnos/:turnoId — update detail (feriado, horas, extra, obs)
router.put("/:id/turnos/:turnoId", auth, async (req, res) => {
  const { isFeriado, horaInicio, horaFim, extraInicio, extraFim, observacao } = req.body;
  try {
    const result = await pool.query(
      `UPDATE escala_turnos
          SET is_feriado   = $1,
              hora_inicio  = $2,
              hora_fim     = $3,
              extra_inicio = $4,
              extra_fim    = $5,
              observacao   = $6,
              updated_at   = NOW()
        WHERE id=$7 AND escala_id=$8
       RETURNING id`,
      [isFeriado||false, horaInicio||null, horaFim||null, extraInicio||null, extraFim||null, observacao||null,
       req.params.turnoId, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Turno não encontrado." });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar turno." });
  }
});

// GET /escalas/relatorio — relatório de horas por período
router.get("/relatorio/horas", auth, async (req, res) => {
  const { dataInicio, dataFim, userId, teamId, companyId } = req.query;
  if (!dataInicio || !dataFim) return res.status(400).json({ error: "Período obrigatório." });

  const parseDate = (str) => { const [d,m,y] = str.split("/"); return `${y}-${m}-${d}`; };

  const filters = ["et.turno_date BETWEEN $1 AND $2"];
  const params  = [parseDate(dataInicio), parseDate(dataFim)];
  let i = 3;
  if (userId)    { filters.push(`et.user_id = $${i++}`);    params.push(userId); }
  if (teamId)    { filters.push(`u.team_id  = $${i++}`);    params.push(teamId); }
  if (companyId) { filters.push(`e.company_id = $${i++}`);  params.push(companyId); }

  try {
    const result = await pool.query(
      `SELECT
          t.id   AS "teamId",   t.name AS "teamName",
          u.id   AS "userId",   u.name AS "userName",
          et.turno_date  AS "turnoDate",
          et.turno,
          et.is_feriado  AS "isFeriado",
          EXTRACT(DOW FROM et.turno_date) AS "dow",
          TO_CHAR(et.hora_inicio,  'HH24:MI') AS "horaInicio",
          TO_CHAR(et.hora_fim,     'HH24:MI') AS "horaFim",
          TO_CHAR(et.extra_inicio, 'HH24:MI') AS "extraInicio",
          TO_CHAR(et.extra_fim,    'HH24:MI') AS "extraFim"
        FROM escala_turnos et
        JOIN escalas   e ON e.id   = et.escala_id
        JOIN users     u ON u.id   = et.user_id
        JOIN teams     t ON t.id   = u.team_id
        WHERE ${filters.join(" AND ")}
          AND et.user_id IS NOT NULL
        ORDER BY t.name, u.name, et.turno_date, et.turno`,
      params
    );

    // Aggregate in JS
    const teamMap = {};
    for (const row of result.rows) {
      const isWeekendOrFeriado = row.isFeriado || row.dow == 0 || row.dow == 6;
      const turnoMins = turnoHoras(row.turno, isWeekendOrFeriado);

      // Extra mins
      let extraMins = 0;
      if (row.extraInicio && row.extraFim) {
        let diff = toMinutes(row.extraFim) - toMinutes(row.extraInicio);
        if (diff < 0) diff += 1440; // crossed midnight
        extraMins = diff;
      }

      const sobreavisoMins = Math.max(0, turnoMins - extraMins);

      if (!teamMap[row.teamId]) teamMap[row.teamId] = { teamId: row.teamId, teamName: row.teamName, users: {} };
      const team = teamMap[row.teamId];
      if (!team.users[row.userId]) team.users[row.userId] = { userId: row.userId, userName: row.userName, extraMins: 0, sobreavisoMins: 0, plantoes: 0 };
      team.users[row.userId].extraMins      += extraMins;
      team.users[row.userId].sobreavisoMins += sobreavisoMins;
      team.users[row.userId].plantoes       += 1;
    }

    const teams = Object.values(teamMap).map(team => {
      const users = Object.values(team.users).map(u => ({
        ...u,
        extraHHMM:      minutesToHHMM(u.extraMins),
        sobreavisoHHMM: minutesToHHMM(u.sobreavisoMins),
      }));
      const totExtra      = users.reduce((s,u)=>s+u.extraMins,0);
      const totSobreaviso = users.reduce((s,u)=>s+u.sobreavisoMins,0);
      return {
        teamId:   team.teamId,
        teamName: team.teamName,
        users,
        totalExtraHHMM:      minutesToHHMM(totExtra),
        totalSobreavisoHHMM: minutesToHHMM(totSobreaviso),
      };
    });

    res.json(teams);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório." });
  }
});

module.exports = router;
