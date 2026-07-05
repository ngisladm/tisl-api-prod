const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /teams
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.active,
              COUNT(ei.id)::int AS "membros"
         FROM teams t
         LEFT JOIN equipe_itens ei ON ei.team_id = t.id
        GROUP BY t.id
        ORDER BY t.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar equipes." });
  }
});

// GET /teams/:id/users  — usuários da equipe (via funcionário vinculado)
router.get("/:id/users", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.company_id AS "companyId", u.funcionario_id AS "funcionarioId"
         FROM users u
         JOIN equipe_itens ei ON ei.funcionario_id = u.funcionario_id
        WHERE ei.team_id = $1 AND u.active = TRUE AND u.funcionario_id IS NOT NULL
        ORDER BY u.name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar usuários da equipe." });
  }
});

// POST /teams
router.post("/", auth, async (req, res) => {
  const { name, active = true } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const result = await pool.query(
      "INSERT INTO teams (name, active) VALUES ($1, $2) RETURNING *",
      [name.trim(), active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar equipe." });
  }
});

// PUT /teams/:id
router.put("/:id", auth, async (req, res) => {
  const { name, active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const result = await pool.query(
      "UPDATE teams SET name=$1, active=$2 WHERE id=$3 RETURNING *",
      [name.trim(), active, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Equipe não encontrada." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar equipe." });
  }
});

// DELETE /teams/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM teams WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir equipe." });
  }
});

// ── Itens de Equipe ────────────────────────────────────────────

// GET /teams/:id/itens
router.get("/:id/itens", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ei.id,
              ei.funcionario_id AS "funcionarioId",
              fn.nome           AS "funcionarioNome",
              fn.cargo,
              fn.centro_custo   AS "centroCusto"
         FROM equipe_itens ei
         JOIN funcionarios fn ON fn.id = ei.funcionario_id
        WHERE ei.team_id = $1
        ORDER BY fn.nome`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar itens da equipe." });
  }
});

// POST /teams/:id/itens
router.post("/:id/itens", auth, async (req, res) => {
  const { funcionarioId } = req.body;
  if (!funcionarioId) return res.status(400).json({ error: "Funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO equipe_itens (team_id, funcionario_id)
       VALUES ($1, $2)
       ON CONFLICT (team_id, funcionario_id) DO NOTHING
       RETURNING id`,
      [req.params.id, funcionarioId]
    );
    if (!r.rows[0]) return res.status(409).json({ error: "Funcionário já está nesta equipe." });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao adicionar funcionário à equipe." });
  }
});

// PUT /teams/:id/itens/:itemId  — troca o funcionário vinculado
router.put("/:id/itens/:itemId", auth, async (req, res) => {
  const { funcionarioId } = req.body;
  if (!funcionarioId) return res.status(400).json({ error: "Funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE equipe_itens SET funcionario_id = $1, updated_at = NOW()
        WHERE id = $2 AND team_id = $3
       RETURNING id`,
      [funcionarioId, req.params.itemId, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Item não encontrado." });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Funcionário já está nesta equipe." });
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar item da equipe." });
  }
});

// DELETE /teams/:id/itens/:itemId
router.delete("/:id/itens/:itemId", auth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM equipe_itens WHERE id = $1 AND team_id = $2",
      [req.params.itemId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover funcionário da equipe." });
  }
});

module.exports = router;
