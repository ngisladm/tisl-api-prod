const express    = require("express");
const router     = express.Router();
const pool       = require("../db");
const auth       = require("../middleware/auth");
const nodemailer = require("nodemailer");
const { decrypt } = require("./email-config");

// POST /email/enviar-contrato
router.post("/enviar-contrato", auth, async (req, res) => {
  const { toEmail, pdfBase64, funcionarioNome } = req.body;
  if (!toEmail?.trim()) return res.status(400).json({ error: "E-mail do destinatário não informado." });
  if (!pdfBase64)       return res.status(400).json({ error: "PDF não gerado." });

  try {
    const r = await pool.query("SELECT * FROM email_config LIMIT 1");
    if (!r.rows[0])
      return res.status(400).json({ error: "Configuração de e-mail não encontrada. Acesse Cadastros › Configuração de E-mail." });
    const cfg = r.rows[0];
    if (!cfg.host || !cfg.user_email || !cfg.password)
      return res.status(400).json({ error: "Configuração de e-mail incompleta. Verifique o servidor SMTP, e-mail e senha." });

    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port || 587,
      secure: cfg.secure || false,
      auth: { user: cfg.user_email, pass: cfg.password ? decrypt(cfg.password) : "" },
      tls: { rejectUnauthorized: false },
    });

    // pdfBase64 pode vir com o prefixo data:application/pdf;base64,...
    const base64Data = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
    const nome = (funcionarioNome || "funcionario").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "-");

    // O "from" deve usar o user_email autenticado para evitar erro SendAsDenied no Exchange/O365.
    // Se from_email for diferente, usamos como replyTo.
    const fromAddr = `"${cfg.from_name || "TI"}" <${cfg.user_email}>`;
    const replyTo  = cfg.from_email && cfg.from_email !== cfg.user_email ? cfg.from_email : undefined;

    await transporter.sendMail({
      from: fromAddr,
      ...(replyTo ? { replyTo } : {}),
      to: toEmail.trim(),
      subject: "Contrato de Ativos - TI",
      text: "Prezado, por favor assinar o contrato em anexo e devolver a TI o mais rápido possível. Agradecemos. TI",
      attachments: [{
        filename: `contrato-${nome}.pdf`,
        content: Buffer.from(base64Data, "base64"),
        contentType: "application/pdf",
      }],
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha no envio: " + err.message });
  }
});

module.exports = router;
