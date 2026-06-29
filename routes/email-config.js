const express    = require("express");
const router     = express.Router();
const pool       = require("../db");
const auth       = require("../middleware/auth");
const nodemailer = require("nodemailer");

// GET /email-config
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT id, host, port, secure, user_email AS \"userEmail\", from_name AS \"fromName\", from_email AS \"fromEmail\" FROM email_config LIMIT 1");
    res.json(r.rows[0] || null);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar configuração." }); }
});

// PUT /email-config
router.put("/", auth, async (req, res) => {
  const { host, port, secure, userEmail, password, fromName, fromEmail } = req.body;
  try {
    const existing = await pool.query("SELECT id FROM email_config LIMIT 1");
    if (existing.rows.length > 0) {
      const updates = ["host=$1","port=$2","secure=$3","user_email=$4","from_name=$5","from_email=$6","updated_at=NOW()"];
      const vals    = [host||null, port||587, secure||false, userEmail||null, fromName||null, fromEmail||null];
      if (password?.trim()) { updates.push("password=$7"); vals.push(password.trim()); vals.push(existing.rows[0].id); }
      else vals.push(existing.rows[0].id);
      await pool.query(`UPDATE email_config SET ${updates.join(",")} WHERE id=$${vals.length}`, vals);
    } else {
      await pool.query(
        `INSERT INTO email_config (host, port, secure, user_email, password, from_name, from_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [host||null, port||587, secure||false, userEmail||null, password||null, fromName||null, fromEmail||null]
      );
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar configuração." }); }
});

// POST /email-config/testar
router.post("/testar", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM email_config LIMIT 1");
    if (!r.rows[0]) return res.status(400).json({ error: "Configuração de e-mail não encontrada." });
    const cfg = r.rows[0];
    const transporter = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: { user: cfg.user_email, pass: cfg.password },
    });
    await transporter.sendMail({
      from: `"${cfg.from_name||"TI"}" <${cfg.from_email}>`,
      to: cfg.from_email,
      subject: "Teste de Configuração - SL TI System",
      text: "Configuração de e-mail funcionando corretamente.",
    });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Falha no envio: " + err.message }); }
});

module.exports = router;
