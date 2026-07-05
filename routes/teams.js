const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// Detecta ciclo hierárquico: verifica se definir newParentId em teamId criaria ciclo
async function wouldCreateCycle(teamId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === teamId) return true;
  const visited = new Set();
  let cur = newParentId;
  while (cur) {
    if (visited.has(cur)) return false; // ciclo já existente nos dados — não é causado por nós
    visited.add(cur);
    const r = await pool.query("SELECT parent_id FROM teams WHERE id=$1", [cur]);
    cur = r.rows[0]?.parent_id || null;
    if (cur === teamId) return true;
  }
  return false;
}

// GET /teams
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.active,
              t.parent_id AS "parentId",
              p.name      AS "parentName",
              COUNT(ei.id)::int AS "membros"
         FROM teams t
         LEFT JOIN teams        p  ON p.id  = t.parent_id
         LEFT JOIN equipe_itens ei ON ei.team_id = t.id
        GROUP BY t.id, p.name
        ORDER BY t.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar equipes." });
  }
});

// GET /teams/relatorio-composicao — árvore de equipes com funcionários para relatório
router.get("/relatorio-composicao", auth, async (req, res) => {
  try {
    const [teamsRes, itensRes] = await Promise.all([
      pool.query(
        `SELECT t.id, t.name, t.active, t.parent_id AS "parentId"
           FROM teams t
          ORDER BY t.name`
      ),
      pool.query(
        `SELECT ei.team_id AS "teamId",
                fn.nome           AS "funcionarioNome",
                fn.cargo,
                fn.centro_custo   AS "centroCusto"
           FROM equipe_itens ei
           JOIN funcionarios fn ON fn.id = ei.funcionario_id
          ORDER BY fn.nome`
      )
    ]);

    const itensByTeam = {};
    for (const row of itensRes.rows) {
      if (!itensByTeam[row.teamId]) itensByTeam[row.teamId] = [];
      itensByTeam[row.teamId].push({
        funcionarioNome: row.funcionarioNome,
        cargo: row.cargo,
        centroCusto: row.centroCusto,
      });
    }

    const teams = teamsRes.rows.map(t => ({
      ...t,
      membros: itensByTeam[t.id] || [],
    }));

    res.json(teams);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de composição." });
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
  const { name, active = true, parentId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const result = await pool.query(
      "INSERT INTO teams (name, active, parent_id) VALUES ($1,$2,$3) RETURNING id, name, active, parent_id AS \"parentId\"",
      [name.trim(), active, parentId || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar equipe." });
  }
});

// PUT /teams/:id
router.put("/:id", auth, async (req, res) => {
  const { name, active, parentId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  const pid = parentId || null;
  if (pid === req.params.id)
    return res.status(400).json({ error: "Uma equipe não pode ser subordinada a ela mesma." });
  if (pid && await wouldCreateCycle(req.params.id, pid))
    return res.status(400).json({ error: "Esta subordinação criaria um ciclo hierárquico." });
  try {
    const result = await pool.query(
      "UPDATE teams SET name=$1, active=$2, parent_id=$3 WHERE id=$4 RETURNING id, name, active, parent_id AS \"parentId\"",
      [name.trim(), active, pid, req.params.id]
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
    const check = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM equipe_itens WHERE team_id=$1",
      [req.params.id]
    );
    if (check.rows[0].cnt > 0)
      return res.status(400).json({ error: "Esta equipe possui funcionários vinculados. Exclua os funcionários da equipe antes de excluir a equipe." });
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
