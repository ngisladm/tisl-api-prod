const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { SCREEN_KEYS, CLOSED_MESSAGE, isDateClosed } = require("../utils/periodClosure");

const parseDate = str => {
  const parts = str.split("/");
  if (parts.length !== 3) throw new Error(`Data inválida: ${str}`);
  const [d,m,y] = parts;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

// GET /extra-avulso
router.get("/", auth, async (req, res) => {
  try {
    const reqUser = await pool.query("SELECT is_master, funcionario_id FROM users WHERE id=$1", [req.user.id]);
    const isMaster = reqUser.rows[0]?.is_master;
    const myFuncId = reqUser.rows[0]?.funcionario_id;

    const params = [];
    let where = "";
    if (!isMaster) {
      params.push(myFuncId);
      where = "WHERE ea.funcionario_id = $1";
    }

    const result = await pool.query(
      `SELECT ea.id,
              ea.company_id     AS "companyId",
              ea.team_id        AS "teamId",
              ea.funcionario_id AS "funcionarioId",
              ea.created_by     AS "createdBy",
              TO_CHAR(ea.data,        'DD/MM/YYYY') AS "data",
              TO_CHAR(ea.hora_inicio, 'HH24:MI')    AS "horaInicio",
              TO_CHAR(ea.hora_fim,    'HH24:MI')    AS "horaFim",
              ea.observacao,
              EXISTS(SELECT 1 FROM period_closures pc WHERE pc.screen_key='EXTRA_AVULSO' AND ea.data BETWEEN pc.date_start AND pc.date_end) AS "periodoFechado",
              c.name  AS "companyName",
              t.name  AS "teamName",
              fn.nome AS "userName"
         FROM extra_avulso ea
         JOIN companies    c  ON c.id  = ea.company_id
         JOIN teams        t  ON t.id  = ea.team_id
         LEFT JOIN funcionarios fn ON fn.id = ea.funcionario_id
        ${where}
        ORDER BY ea.data DESC, fn.nome`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar extras avulsos." });
  }
});

// POST /extra-avulso
router.post("/", auth, async (req, res) => {
  const { companyId, teamId, funcionarioId, data, horaInicio, horaFim, observacao } = req.body;
  if (!companyId || !teamId || !funcionarioId || !data || !horaInicio || !horaFim)
    return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });

  try {
    const reqUser = await pool.query("SELECT is_master, funcionario_id FROM users WHERE id=$1", [req.user.id]);
    const isMaster = reqUser.rows[0]?.is_master;
    const myFuncId = reqUser.rows[0]?.funcionario_id;
    if (!isMaster && funcionarioId !== myFuncId)
      return res.status(403).json({ error: "Você não pode inserir lançamentos para outro funcionário." });
    const parsedDate = parseDate(data);
    if (await isDateClosed(SCREEN_KEYS.EXTRA_AVULSO, parsedDate)) return res.status(409).json({ error: CLOSED_MESSAGE });

    const result = await pool.query(
      `INSERT INTO extra_avulso (company_id, team_id, funcionario_id, data, hora_inicio, hora_fim, observacao, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,
                 company_id     AS "companyId",
                 team_id        AS "teamId",
                 funcionario_id AS "funcionarioId",
                 created_by     AS "createdBy",
                 TO_CHAR(data,        'DD/MM/YYYY') AS "data",
                 TO_CHAR(hora_inicio, 'HH24:MI')    AS "horaInicio",
                 TO_CHAR(hora_fim,    'HH24:MI')    AS "horaFim",
                 observacao`,
      [companyId, teamId, funcionarioId, parsedDate, horaInicio, horaFim, observacao||null, req.user.id]
    );
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    const func    = await pool.query("SELECT nome FROM funcionarios WHERE id=$1", [funcionarioId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    row.userName    = func.rows[0]?.nome;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao criar extra avulso." });
  }
});

// PUT /extra-avulso/:id
router.put("/:id", auth, async (req, res) => {
  const { companyId, teamId, funcionarioId, data, horaInicio, horaFim, observacao } = req.body;
  if (!companyId || !teamId || !funcionarioId || !data || !horaInicio || !horaFim)
    return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });

  try {
    const reqUser = await pool.query("SELECT is_master, funcionario_id FROM users WHERE id=$1", [req.user.id]);
    const isMaster = reqUser.rows[0]?.is_master;
    const myFuncId = reqUser.rows[0]?.funcionario_id;
    const rec = await pool.query("SELECT funcionario_id, data FROM extra_avulso WHERE id=$1", [req.params.id]);
    if (!rec.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    if (!isMaster) {
      if (rec.rows[0].funcionario_id !== myFuncId)
        return res.status(403).json({ error: "Você só pode editar seus próprios lançamentos." });
    }
    if (await isDateClosed(SCREEN_KEYS.EXTRA_AVULSO, rec.rows[0].data) || await isDateClosed(SCREEN_KEYS.EXTRA_AVULSO, parseDate(data)))
      return res.status(409).json({ error: CLOSED_MESSAGE });
  } catch(err) {
    return res.status(500).json({ error: "Erro ao verificar permissão." });
  }

  try {
    const result = await pool.query(
      `UPDATE extra_avulso
          SET company_id=$1, team_id=$2, funcionario_id=$3, data=$4,
              hora_inicio=$5, hora_fim=$6, observacao=$7
        WHERE id=$8
       RETURNING id,
                 company_id     AS "companyId",
                 team_id        AS "teamId",
                 funcionario_id AS "funcionarioId",
                 created_by     AS "createdBy",
                 TO_CHAR(data,        'DD/MM/YYYY') AS "data",
                 TO_CHAR(hora_inicio, 'HH24:MI')    AS "horaInicio",
                 TO_CHAR(hora_fim,    'HH24:MI')    AS "horaFim",
                 observacao`,
      [companyId, teamId, funcionarioId, parseDate(data), horaInicio, horaFim, observacao||null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    const func    = await pool.query("SELECT nome FROM funcionarios WHERE id=$1", [funcionarioId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    row.userName    = func.rows[0]?.nome;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar extra avulso." });
  }
});

// DELETE /extra-avulso/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const reqUser = await pool.query("SELECT is_master, funcionario_id FROM users WHERE id=$1", [req.user.id]);
    const isMaster = reqUser.rows[0]?.is_master;
    const myFuncId = reqUser.rows[0]?.funcionario_id;
    if (!isMaster) {
      const rec = await pool.query("SELECT funcionario_id, data FROM extra_avulso WHERE id=$1", [req.params.id]);
      if (!rec.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
      if (rec.rows[0].funcionario_id !== myFuncId)
        return res.status(403).json({ error: "Você só pode excluir seus próprios lançamentos." });
    }
    const recDate = await pool.query("SELECT data FROM extra_avulso WHERE id=$1", [req.params.id]);
    if (!recDate.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    if (await isDateClosed(SCREEN_KEYS.EXTRA_AVULSO, recDate.rows[0].data)) return res.status(409).json({ error: CLOSED_MESSAGE });
    await pool.query("DELETE FROM extra_avulso WHERE id=$1",[req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir extra avulso." });
  }
});

module.exports = router;
