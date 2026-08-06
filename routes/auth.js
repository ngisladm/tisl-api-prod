const express   = require("express");
const router    = express.Router();
const bcrypt    = require("bcrypt");
const jwt       = require("jsonwebtoken");
const pool      = require("../db");
const rateLimit = require("express-rate-limit");
const { mergePermissions } = require("../utils/permissions");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente em 15 minutos." },
});

// POST /auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "E-mail e senha são obrigatórios." });

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.apelido, u.email, u.password_hash, u.active,
              u.profile_id AS "profileId", u.company_id AS "companyId",
              u.is_master  AS "isMaster",
              u.avatar
         FROM users u
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

    const profilesResult = await pool.query(
      `SELECT p.id, p.permissions
         FROM profiles p
        WHERE p.id IN (
          SELECT up.profile_id FROM user_profiles up WHERE up.user_id=$1
          UNION
          SELECT u.profile_id FROM users u WHERE u.id=$1 AND u.profile_id IS NOT NULL
        )`,
      [user.id]
    );
    const profileIds = profilesResult.rows.map(row => row.id);
    const permissions = mergePermissions(profilesResult.rows.map(row => row.permissions));

    const token = jwt.sign(
      {
        id:        user.id,
        name:      user.name,
        apelido:   user.apelido || null,
        email:     user.email,
        profileId: user.profileId,
        profileIds,
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
        profileIds,
        companyId:   user.companyId,
        isMaster:    user.isMaster || false,
        avatar:      user.avatar || null,
        permissions,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

module.exports = router;
