const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /extra-avulso
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ea.id,
              ea.company_id  AS "companyId",
              ea.team_id     AS "teamId",
              ea.user_id     AS "userId",
              TO_CHAR(ea.data,        'DD/MM/YYYY') AS "data",
              TO_CHAR(ea.hora_inicio, 'HH24:MI')    AS "horaInicio",
              TO_CHAR(ea.hora_fim,    'HH24:MI')    AS "horaFim",
              ea.observacao,
              c.name AS "companyName",
              t.name AS "teamName",
              u.name AS "userName"
         FROM extra_avulso ea
         JOIN companies c ON c.id = ea.company_id
         JOIN teams     t ON t.id = ea.team_id
         JOIN users     u ON u.id = ea.user_id
        ORDER BY ea.data DESC, u.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar extras avulsos." });
  }
});

// POST /extra-avulso
router.post("/", auth, async (req, res) => {
  const { companyId, teamId, userId, data, horaInicio, horaFim, observacao } = req.body;
  if (!companyId || !teamId || !userId || !data || !horaInicio || !horaFim)
    return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });

  const parseDate = (str) => {
    const parts = str.split("/");
    if (parts.length !== 3) throw new Error(`Data inválida: ${str}`);
    const [d, m, y] = parts;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  };

  try {
    const result = await pool.query(
      `INSERT INTO extra_avulso (company_id, team_id, user_id, data, hora_inicio, hora_fim, observacao, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,
                 company_id AS "companyId", team_id AS "teamId", user_id AS "userId",
                 TO_CHAR(data,        'DD/MM/YYYY') AS "data",
                 TO_CHAR(hora_inicio, 'HH24:MI')    AS "horaInicio",
                 TO_CHAR(hora_fim,    'HH24:MI')    AS "horaFim",
                 observacao`,
      [companyId, teamId, userId, parseDate(data), horaInicio, horaFim, observacao||null, req.user.id]
    );
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    const user    = await pool.query("SELECT name FROM users WHERE id=$1",    [userId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    row.userName    = user.rows[0]?.name;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao criar extra avulso." });
  }
});

// PUT /extra-avulso/:id
router.put("/:id", auth, async (req, res) => {
  const { companyId, teamId, userId, data, horaInicio, horaFim, observacao } = req.body;
  if (!companyId || !teamId || !userId || !data || !horaInicio || !horaFim)
    return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });

  // Check ownership: only master or own record
  try {
    const reqUser = await pool.query("SELECT is_master FROM users WHERE id=$1", [req.user.id]);
    const isMaster = reqUser.rows[0]?.is_master;
    if (!isMaster) {
      const rec = await pool.query("SELECT user_id FROM extra_avulso WHERE id=$1", [req.params.id]);
      if (!rec.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
      if (rec.rows[0].user_id !== req.user.id)
        return res.status(403).json({ error: "Você só pode editar seus próprios lançamentos." });
    }
  } catch(err) {
    return res.status(500).json({ error: "Erro ao verificar permissão." });
  }

  const parseDate = (str) => {
    const [d,m,y] = str.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  };

  try {
    const result = await pool.query(
      `UPDATE extra_avulso
          SET company_id=$1, team_id=$2, user_id=$3, data=$4,
              hora_inicio=$5, hora_fim=$6, observacao=$7
        WHERE id=$8
       RETURNING id,
                 company_id AS "companyId", team_id AS "teamId", user_id AS "userId",
                 TO_CHAR(data,        'DD/MM/YYYY') AS "data",
                 TO_CHAR(hora_inicio, 'HH24:MI')    AS "horaInicio",
                 TO_CHAR(hora_fim,    'HH24:MI')    AS "horaFim",
                 observacao`,
      [companyId, teamId, userId, parseDate(data), horaInicio, horaFim, observacao||null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1",[companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",    [teamId]);
    const user    = await pool.query("SELECT name FROM users WHERE id=$1",    [userId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    row.userName    = user.rows[0]?.name;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar extra avulso." });
  }
});

// DELETE /extra-avulso/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    // Check ownership
    const reqUser = await pool.query("SELECT is_master FROM users WHERE id=$1", [req.user.id]);
    const isMaster = reqUser.rows[0]?.is_master;
    if (!isMaster) {
      const rec = await pool.query("SELECT user_id FROM extra_avulso WHERE id=$1", [req.params.id]);
      if (!rec.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
      if (rec.rows[0].user_id !== req.user.id)
        return res.status(403).json({ error: "Você só pode excluir seus próprios lançamentos." });
    }
    await pool.query("DELETE FROM extra_avulso WHERE id=$1",[req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir extra avulso." });
  }
});

module.exports = router;
