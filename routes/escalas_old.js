const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /escalas
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.company_id AS "companyId", e.team_id AS "teamId",
              e.month, e.year,
              c.name AS "companyName", t.name AS "teamName"
         FROM escalas e
         LEFT JOIN companies c ON c.id = e.company_id
         LEFT JOIN teams     t ON t.id = e.team_id
        ORDER BY e.year DESC, e.month DESC, c.name, t.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar escalas." });
  }
});

// POST /escalas
router.post("/", auth, async (req, res) => {
  const { companyId, teamId, month, year } = req.body;
  if (!companyId || !teamId || !month || !year)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });
  try {
    const result = await pool.query(
      `INSERT INTO escalas (company_id, team_id, month, year)
       VALUES ($1, $2, $3, $4)
       RETURNING id, company_id AS "companyId", team_id AS "teamId", month, year`,
      [companyId, teamId, parseInt(month), parseInt(year)]
    );
    // Enrich with names
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1", [companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",     [teamId]);
    row.companyName = company.rows[0]?.name;
    row.teamName    = team.rows[0]?.name;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar escala." });
  }
});

// PUT /escalas/:id
router.put("/:id", auth, async (req, res) => {
  const { companyId, teamId, month, year } = req.body;
  if (!companyId || !teamId || !month || !year)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });
  try {
    const result = await pool.query(
      `UPDATE escalas SET company_id=$1, team_id=$2, month=$3, year=$4
        WHERE id=$5
       RETURNING id, company_id AS "companyId", team_id AS "teamId", month, year`,
      [companyId, teamId, parseInt(month), parseInt(year), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Escala não encontrada." });
    const row = result.rows[0];
    const company = await pool.query("SELECT name FROM companies WHERE id=$1", [companyId]);
    const team    = await pool.query("SELECT name FROM teams WHERE id=$1",     [teamId]);
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
    await pool.query("DELETE FROM escala_turnos WHERE escala_id=$1", [req.params.id]);
    await pool.query("DELETE FROM escalas WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir escala." });
  }
});

// ── Turnos ──────────────────────────────────────────────────

// GET /escalas/:id/turnos
router.get("/:id/turnos", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT day, turno, user_id AS "userId"
         FROM escala_turnos
        WHERE escala_id = $1`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar turnos." });
  }
});

// POST /escalas/:id/turnos  — upsert de um turno
router.post("/:id/turnos", auth, async (req, res) => {
  const { day, turno, userId } = req.body;
  if (!day || !turno) return res.status(400).json({ error: "day e turno são obrigatórios." });

  try {
    if (!userId) {
      // Remove turno
      await pool.query(
        "DELETE FROM escala_turnos WHERE escala_id=$1 AND day=$2 AND turno=$3",
        [req.params.id, day, turno]
      );
    } else {
      // Upsert
      await pool.query(
        `INSERT INTO escala_turnos (escala_id, day, turno, user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (escala_id, day, turno)
         DO UPDATE SET user_id = EXCLUDED.user_id`,
        [req.params.id, day, turno, userId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar turno." });
  }
});

module.exports = router;
