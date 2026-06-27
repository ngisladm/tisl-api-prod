const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const pool    = require("../db");

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "E-mail e senha são obrigatórios." });

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.apelido, u.email, u.password_hash, u.active,
              u.profile_id AS "profileId", u.company_id AS "companyId",
              u.is_master  AS "isMaster",
              u.avatar,
              p.permissions
         FROM users u
         JOIN profiles p ON p.id = u.profile_id
        WHERE u.email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user)
      return res.status(401).json({ error: "E-mail ou senha inválidos." });

    if (!user.active)
      return res.status(401).json({ error: "Usuário inativo." });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "E-mail ou senha inválidos." });

    const token = jwt.sign(
      {
        id:        user.id,
        name:      user.name,
        apelido:   user.apelido || null,
        email:     user.email,
        profileId: user.profileId,
        companyId: user.companyId,
        isMaster:  user.isMaster || false,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      token,
      user: {
        id:          user.id,
        name:        user.name,
        apelido:     user.apelido || null,
        email:       user.email,
        profileId:   user.profileId,
        companyId:   user.companyId,
        isMaster:    user.isMaster || false,
        avatar:      user.avatar || null,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

module.exports = router;
