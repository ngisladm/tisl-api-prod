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
    const parts = str.split("/");
    if (parts.length !== 3) throw new Error(`Data inválida: ${str}. Use o formato dd/mm/aaaa.`);
    const [d, m, y] = parts;
    if (!d || !m || !y || y.length !== 4) throw new Error(`Data inválida: ${str}. Use o formato dd/mm/aaaa.`);
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  };

  try {
    const di = parseDate(dataInicio);
    const df = parseDate(dataFim);

    if (new Date(di) > new Date(df))
      return res.status(400).json({ error: "A data inicial não pode ser maior que a data final." });

    const result = await pool.query(
      `INSERT INTO escalas (company_id, team_id, data_inicio, data_fim)
       VALUES ($1,$2,$3,$4)
       RETURNING id, company_id AS "companyId", team_id AS "teamId",
                 TO_CHAR(data_inicio,'DD/MM/YYYY') AS "dataInicio",
                 TO_CHAR(data_fim,   'DD/MM/YYYY') AS "dataFim"`,
      [companyId, teamId, di, df]
    );
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    res.status(201).json(row);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Já existe uma escala para esta equipe neste período." });
    console.error("ERRO POST /escalas:", err.message, err.stack);
    res.status(500).json({ error: err.message || "Erro ao criar escala." });
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
      const upsert = await pool.query(
        `INSERT INTO escala_turnos (escala_id, turno_date, turno, user_id, hora_inicio, hora_fim, is_feriado)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE)
         ON CONFLICT (escala_id, turno_date, turno)
         DO UPDATE SET user_id=$4, hora_inicio=COALESCE(escala_turnos.hora_inicio,$5), hora_fim=COALESCE(escala_turnos.hora_fim,$6)
         RETURNING id`,
        [req.params.id, turnoDate, turno, userId, horaInicio, horaFim]
      );
      return res.json({ success: true, id: upsert.rows[0]?.id });
    }
    res.json({ success: true, id: null });
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

// GET /escalas/:id/relatorio-calendario — calendário da escala com nomes dos usuários
router.get("/:id/relatorio-calendario", auth, async (req, res) => {
  try {
    const escalaResult = await pool.query(
      `SELECT e.id, e.company_id AS "companyId", e.team_id AS "teamId",
              TO_CHAR(e.data_inicio,'DD/MM/YYYY') AS "dataInicio",
              TO_CHAR(e.data_fim,   'DD/MM/YYYY') AS "dataFim",
              c.name AS "companyName", t.name AS "teamName"
         FROM escalas e
         LEFT JOIN companies c ON c.id = e.company_id
         LEFT JOIN teams     t ON t.id = e.team_id
        WHERE e.id=$1`,
      [req.params.id]
    );
    if (!escalaResult.rows[0]) return res.status(404).json({ error: "Escala não encontrada." });

    const turnosResult = await pool.query(
      `SELECT et.id,
              TO_CHAR(et.turno_date,'YYYY-MM-DD') AS "turnoDate",
              et.turno,
              et.user_id   AS "userId",
              et.is_feriado AS "isFeriado",
              TO_CHAR(et.hora_inicio,  'HH24:MI') AS "horaInicio",
              TO_CHAR(et.hora_fim,     'HH24:MI') AS "horaFim",
              TO_CHAR(et.extra_inicio, 'HH24:MI') AS "extraInicio",
              TO_CHAR(et.extra_fim,    'HH24:MI') AS "extraFim",
              et.observacao,
              u.name AS "userName"
         FROM escala_turnos et
         LEFT JOIN users u ON u.id = et.user_id
        WHERE et.escala_id=$1
        ORDER BY et.turno_date, et.turno`,
      [req.params.id]
    );

    res.json({ escala: escalaResult.rows[0], turnos: turnosResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de calendário." });
  }
});

// GET /escalas/relatorio/horas
router.get("/relatorio/horas", auth, async (req, res) => {
  const { dataInicio, dataFim, userId, teamId, companyId } = req.query;
  if (!dataInicio || !dataFim) return res.status(400).json({ error: "Período obrigatório." });

  const parseDate = (str) => { const [d,m,y] = str.split("/"); return `${y}-${m}-${d}`; };
  const di = parseDate(dataInicio);
  const df = parseDate(dataFim);

  function toMinutes(t){ if(!t)return 0; const[h,m]=t.split(":").map(Number); return h*60+m; }
  function minutesToHHMM(m){ if(!m||m<=0)return"00:00"; return`${String(Math.floor(Math.abs(m)/60)).padStart(2,"0")}:${String(Math.abs(m)%60).padStart(2,"0")}`; }
  function turnoHoras(turno, isWeekendOrFeriado){
    if(!isWeekendOrFeriado) return turno==="turno1"?450:390;
    return 720;
  }

  try {
    // ── 1. Buscar turnos de escala no período ──────────────────
    const turnoFilters = ["et.turno_date BETWEEN $1 AND $2","et.user_id IS NOT NULL"];
    const turnoParams  = [di, df];
    let i = 3;
    if (userId)    { turnoFilters.push(`et.user_id    = $${i++}`); turnoParams.push(userId); }
    if (teamId)    { turnoFilters.push(`u.team_id     = $${i++}`); turnoParams.push(teamId); }
    if (companyId) { turnoFilters.push(`e.company_id  = $${i++}`); turnoParams.push(companyId); }

    const turnosResult = await pool.query(
      `SELECT et.escala_id AS "escalaId",
              TO_CHAR(et.turno_date,'YYYY-MM-DD') AS "turnoDate",
              et.turno,
              et.user_id    AS "userId",
              et.is_feriado AS "isFeriado",
              EXTRACT(DOW FROM et.turno_date)      AS "dow",
              TO_CHAR(et.hora_inicio,  'HH24:MI') AS "horaInicio",
              TO_CHAR(et.hora_fim,     'HH24:MI') AS "horaFim",
              TO_CHAR(et.extra_inicio, 'HH24:MI') AS "extraInicio",
              TO_CHAR(et.extra_fim,    'HH24:MI') AS "extraFim",
              u.name AS "userName",
              t.id   AS "teamId",  t.name AS "teamName"
         FROM escala_turnos et
         JOIN escalas   e ON e.id   = et.escala_id
         JOIN users     u ON u.id   = et.user_id
         JOIN teams     t ON t.id   = u.team_id
        WHERE ${turnoFilters.join(" AND ")}
        ORDER BY t.name, u.name, et.turno_date, et.turno`,
      turnoParams
    );

    // ── 2. Buscar extras avulsos no período ────────────────────
    const avulsoFilters = ["ea.data BETWEEN $1 AND $2"];
    const avulsoParams  = [di, df];
    let j = 3;
    if (userId)    { avulsoFilters.push(`ea.user_id    = $${j++}`); avulsoParams.push(userId); }
    if (teamId)    { avulsoFilters.push(`ea.team_id    = $${j++}`); avulsoParams.push(teamId); }
    if (companyId) { avulsoFilters.push(`ea.company_id = $${j++}`); avulsoParams.push(companyId); }

    const avulsosResult = await pool.query(
      `SELECT ea.user_id    AS "userId",
              TO_CHAR(ea.data,        'YYYY-MM-DD') AS "data",
              TO_CHAR(ea.hora_inicio, 'HH24:MI')    AS "horaInicio",
              TO_CHAR(ea.hora_fim,    'HH24:MI')    AS "horaFim",
              u.name AS "userName",
              t.id   AS "teamId",  t.name AS "teamName"
         FROM extra_avulso ea
         JOIN users  u ON u.id = ea.user_id
         JOIN teams  t ON t.id = ea.team_id
        WHERE ${avulsoFilters.join(" AND ")}`,
      avulsoParams
    );

    // ── 3. Montar mapa de extras avulsos por userId+data ───────
    // avulsoMap[userId][date] = totalMinutes
    const avulsoMap = {};
    for (const row of avulsosResult.rows) {
      let mins = toMinutes(row.horaFim) - toMinutes(row.horaInicio);
      if (mins < 0) mins += 1440;
      if (!avulsoMap[row.userId]) avulsoMap[row.userId] = {};
      avulsoMap[row.userId][row.data] = (avulsoMap[row.userId][row.data] || 0) + mins;
    }

    // ── 4. Agregar por equipe/usuário ──────────────────────────
    const teamMap = {};

    // Ensure teams from avulsos also appear even if no escala turno
    for (const row of avulsosResult.rows) {
      if (!teamMap[row.teamId]) teamMap[row.teamId] = { teamId:row.teamId, teamName:row.teamName, users:{} };
      if (!teamMap[row.teamId].users[row.userId])
        teamMap[row.teamId].users[row.userId] = { userId:row.userId, userName:row.userName, sobreavisoMins:0, extraTurnoMins:0, extraAvulsoMins:0, plantoes:0 };
    }

    for (const row of turnosResult.rows) {
      const isWeekendOrFeriado = row.isFeriado || row.dow==0 || row.dow==6;
      const turnoTotalMins     = turnoHoras(row.turno, isWeekendOrFeriado);

      // Extra do turno
      let extraTurnoMins = 0;
      if (row.extraInicio && row.extraFim) {
        let d = toMinutes(row.extraFim) - toMinutes(row.extraInicio);
        if (d < 0) d += 1440;
        extraTurnoMins = d;
      }

      // Extra avulso no mesmo dia do turno (se houver)
      const extraAvulsoDia = (avulsoMap[row.userId]?.[row.turnoDate]) || 0;

      // Sobreaviso = horas do turno - extra do turno - extra avulso do mesmo dia
      const sobreavisoMins = Math.max(0, turnoTotalMins - extraTurnoMins - extraAvulsoDia);

      if (!teamMap[row.teamId]) teamMap[row.teamId] = { teamId:row.teamId, teamName:row.teamName, users:{} };
      const team = teamMap[row.teamId];
      if (!team.users[row.userId])
        team.users[row.userId] = { userId:row.userId, userName:row.userName, sobreavisoMins:0, extraTurnoMins:0, extraAvulsoMins:0, plantoes:0 };

      team.users[row.userId].sobreavisoMins  += sobreavisoMins;
      team.users[row.userId].extraTurnoMins  += extraTurnoMins;
      team.users[row.userId].plantoes        += 1;
    }

    // Somar extras avulsos totais por usuário
    for (const [uid, dateMap] of Object.entries(avulsoMap)) {
      const totalAvulso = Object.values(dateMap).reduce((s,v)=>s+v, 0);
      for (const team of Object.values(teamMap)) {
        if (team.users[uid]) {
          team.users[uid].extraAvulsoMins += totalAvulso;
        }
      }
    }

    // ── 5. Formatar resultado ──────────────────────────────────
    const teams = Object.values(teamMap).map(team => {
      const users = Object.values(team.users).map(u => {
        const totalExtraMins     = u.extraTurnoMins + u.extraAvulsoMins;
        const sobreavisoDivMins  = Math.floor(u.sobreavisoMins / 2);
        return {
          ...u,
          totalExtraMins,
          extraHHMM:          minutesToHHMM(totalExtraMins),
          sobreavisoHHMM:     minutesToHHMM(sobreavisoDivMins), // dividido por 2
          sobreavisoBrutoHHMM:minutesToHHMM(u.sobreavisoMins),
        };
      });
      const totExtra      = users.reduce((s,u)=>s+u.totalExtraMins,0);
      const totSobreaviso = users.reduce((s,u)=>s+Math.floor(u.sobreavisoMins/2),0);
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