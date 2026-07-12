const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcrypt");
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const onlyMaster = (req, res, next) =>
  req.user.isMaster ? next() : res.status(403).json({ error: "Apenas usuários Master podem executar esta operação." });

// GET /users/me — perfil do usuário logado
router.get("/me", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, apelido, email, avatar FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar perfil." });
  }
});

// PUT /users/me — atualizar nome, apelido e/ou avatar
router.put("/me", auth, async (req, res) => {
  const { name, apelido, avatar } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const result = await pool.query(
      `UPDATE users SET name=$1, apelido=$2, avatar=$3, updated_at=NOW() WHERE id=$4
       RETURNING id, name, apelido, email, avatar`,
      [name.trim(), apelido||null, avatar || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar perfil." });
  }
});

// PUT /users/me/password — alterar senha
router.put("/me/password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
  if (newPassword.length < 8)
    return res.status(400).json({ error: "A nova senha deve ter no mínimo 8 caracteres." });
  try {
    const result = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Usuário não encontrado." });
    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) return res.status(400).json({ error: "Senha atual incorreta." });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2", [hash, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao alterar senha." });
  }
});

// GET /users/basic — lista mínima (sem dados sensíveis) acessível por qualquer autenticado
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.apelido, u.active,
              u.company_id AS "companyId",
              COALESCE(
                (SELECT ei.team_id FROM equipe_itens ei WHERE ei.funcionario_id = u.funcionario_id LIMIT 1),
                u.team_id
              ) AS "teamId",
              u.funcionario_id AS "funcionarioId"
         FROM users u
        WHERE u.active = true
        ORDER BY u.name`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar usuários." });
  }
});

// GET /users
router.get("/", auth, canAccess("s2"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.apelido, u.email, u.active,
              u.profile_id                            AS "profileId",
              u.company_id                            AS "companyId",
              u.is_master                             AS "isMaster",
              u.funcionario_id                        AS "funcionarioId",
              fn.nome                                 AS "funcionarioNome",
              COALESCE(ei.team_id, u.team_id)         AS "teamId",
              COALESCE(et.name, t.name)               AS "teamName",
              c.name                                  AS "companyName",
              p.name                                  AS "profileName"
         FROM users u
         LEFT JOIN companies    c  ON c.id  = u.company_id
         LEFT JOIN profiles     p  ON p.id  = u.profile_id
         LEFT JOIN teams        t  ON t.id  = u.team_id
         LEFT JOIN funcionarios fn ON fn.id = u.funcionario_id
         LEFT JOIN equipe_itens ei ON ei.funcionario_id = u.funcionario_id
         LEFT JOIN teams        et ON et.id = ei.team_id
        ORDER BY u.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar usuários." });
  }
});

// POST /users
router.post("/", auth, canAccess("s2","edit"), async (req, res) => {
  const { name, apelido, email, password, profileId, companyId, teamId, active = true, isMaster = false, funcionarioId } = req.body;
  if (!name?.trim() || !email?.trim())
    return res.status(400).json({ error: "Nome e e-mail são obrigatórios." });
  if (!password?.trim())
    return res.status(400).json({ error: "Senha é obrigatória." });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, apelido, email, password_hash, profile_id, company_id, team_id, active, is_master, funcionario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, apelido, email, active, is_master AS "isMaster",
                 profile_id AS "profileId",
                 company_id AS "companyId",
                 team_id    AS "teamId",
                 funcionario_id AS "funcionarioId"`,
      [name.trim(), apelido||null, email.trim().toLowerCase(), hash, profileId||null, companyId||null, teamId||null, active, isMaster, funcionarioId||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "E-mail já cadastrado." });
    console.error(err);
    res.status(500).json({ error: "Erro ao criar usuário." });
  }
});

// PUT /users/:id
router.put("/:id", auth, canAccess("s2","edit"), async (req, res) => {
  const { name, apelido, email, password, profileId, companyId, teamId, active, isMaster, funcionarioId } = req.body;
  if (!name?.trim() || !email?.trim())
    return res.status(400).json({ error: "Nome e e-mail são obrigatórios." });
  try {
    let query, params;
    if (password?.trim()) {
      const hash = await bcrypt.hash(password, 10);
      query  = `UPDATE users SET name=$1, apelido=$2, email=$3, password_hash=$4, profile_id=$5, company_id=$6, team_id=$7, active=$8, is_master=$9, funcionario_id=$10
                 WHERE id=$11
                RETURNING id, name, apelido, email, active, is_master AS "isMaster", profile_id AS "profileId", company_id AS "companyId", team_id AS "teamId", funcionario_id AS "funcionarioId"`;
      params = [name.trim(), apelido||null, email.trim().toLowerCase(), hash, profileId||null, companyId||null, teamId||null, active, isMaster||false, funcionarioId||null, req.params.id];
    } else {
      query  = `UPDATE users SET name=$1, apelido=$2, email=$3, profile_id=$4, company_id=$5, team_id=$6, active=$7, is_master=$8, funcionario_id=$9
                 WHERE id=$10
                RETURNING id, name, apelido, email, active, is_master AS "isMaster", profile_id AS "profileId", company_id AS "companyId", team_id AS "teamId", funcionario_id AS "funcionarioId"`;
      params = [name.trim(), apelido||null, email.trim().toLowerCase(), profileId||null, companyId||null, teamId||null, active, isMaster||false, funcionarioId||null, req.params.id];
    }
    const result = await pool.query(query, params);
    if (!result.rows[0]) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "E-mail já cadastrado." });
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar usuário." });
  }
});

// DELETE /users/:id
router.delete("/:id", auth, canAccess("s2","edit"), async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: "Não é possível excluir o próprio usuário." });
  try {
    const r = await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir usuário." });
  }
});

module.exports = router;
