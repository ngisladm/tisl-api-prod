const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcryptjs");
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /users
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.active,
              u.profile_id  AS "profileId",
              u.company_id  AS "companyId",
              u.team_id     AS "teamId",
              c.name        AS "companyName",
              p.name        AS "profileName",
              t.name        AS "teamName"
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         LEFT JOIN profiles  p ON p.id = u.profile_id
         LEFT JOIN teams     t ON t.id = u.team_id
        ORDER BY u.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar usuários." });
  }
});

// POST /users
router.post("/", auth, async (req, res) => {
  const { name, email, password, profileId, companyId, teamId, active = true } = req.body;
  if (!name?.trim() || !email?.trim())
    return res.status(400).json({ error: "Nome e e-mail são obrigatórios." });
  if (!password?.trim())
    return res.status(400).json({ error: "Senha é obrigatória." });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, profile_id, company_id, team_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, active,
                 profile_id AS "profileId",
                 company_id AS "companyId",
                 team_id    AS "teamId"`,
      [name.trim(), email.trim().toLowerCase(), hash, profileId||null, companyId||null, teamId||null, active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "E-mail já cadastrado." });
    console.error(err);
    res.status(500).json({ error: "Erro ao criar usuário." });
  }
});

// PUT /users/:id
router.put("/:id", auth, async (req, res) => {
  const { name, email, password, profileId, companyId, teamId, active } = req.body;
  if (!name?.trim() || !email?.trim())
    return res.status(400).json({ error: "Nome e e-mail são obrigatórios." });
  try {
    let query, params;
    if (password?.trim()) {
      const hash = await bcrypt.hash(password, 10);
      query  = `UPDATE users SET name=$1, email=$2, password_hash=$3, profile_id=$4, company_id=$5, team_id=$6, active=$7
                 WHERE id=$8
                RETURNING id, name, email, active, profile_id AS "profileId", company_id AS "companyId", team_id AS "teamId"`;
      params = [name.trim(), email.trim().toLowerCase(), hash, profileId||null, companyId||null, teamId||null, active, req.params.id];
    } else {
      query  = `UPDATE users SET name=$1, email=$2, profile_id=$3, company_id=$4, team_id=$5, active=$6
                 WHERE id=$7
                RETURNING id, name, email, active, profile_id AS "profileId", company_id AS "companyId", team_id AS "teamId"`;
      params = [name.trim(), email.trim().toLowerCase(), profileId||null, companyId||null, teamId||null, active, req.params.id];
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
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir usuário." });
  }
});

module.exports = router;
