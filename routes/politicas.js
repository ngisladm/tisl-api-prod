const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const nodemailer = require("nodemailer");
const { decrypt } = require("../utils/crypto-helper");

const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.platform === "win32" ? "C:/uploads/politicas" : "/app/uploads/politicas");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random()*1e6)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET /politicas
router.get("/", auth, async (req, res) => {
  try {
    const { empresa, nome, data, status } = req.query;
    const conds = [], params = [];
    if (empresa) { params.push(empresa); conds.push(`p.empresa_id=$${params.length}`); }
    if (nome)    { params.push(`%${nome}%`); conds.push(`p.nome_politica ILIKE $${params.length}`); }
    if (data)    { params.push(data);    conds.push(`p.data=$${params.length}`); }
    if (status)  { params.push(status);  conds.push(`p.status=$${params.length}`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const r = await pool.query(
      `SELECT p.id, p.empresa_id AS "empresaId", e.name AS "empresaNome",
              p.nome_politica AS "nomePolitica",
              p.data,
              p.status, p.observacao, p.created_at AS "createdAt"
         FROM politicas_ti p
         JOIN companies e ON e.id = p.empresa_id
         ${where} ORDER BY p.data DESC`,
      params
    );
    // Buscar anexos de cada política
    const ids = r.rows.map(x => x.id);
    let anexos = [];
    if (ids.length) {
      const ar = await pool.query(
        "SELECT id, politica_id AS \"politicaId\", nome_original AS \"nomeOriginal\", filename FROM politicas_anexos WHERE politica_id=ANY($1)",
        [ids]
      );
      anexos = ar.rows;
    }
    const rows = r.rows.map(p => ({
      ...p,
      anexos: anexos.filter(a => a.politicaId === p.id),
    }));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar políticas." }); }
});

// POST /politicas
router.post("/", auth, async (req, res) => {
  const { empresaId, nomePolitica, data, status, observacao } = req.body;
  if (!empresaId || !nomePolitica?.trim() || !data)
    return res.status(400).json({ error: "Empresa, Nome e Data são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO politicas_ti (empresa_id,nome_politica,data,status,observacao)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [empresaId, nomePolitica.trim(), data, status || "Ativo", observacao || null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar política." }); }
});

// PUT /politicas/:id
router.put("/:id", auth, async (req, res) => {
  const { empresaId, nomePolitica, data, status, observacao } = req.body;
  if (!empresaId || !nomePolitica?.trim() || !data)
    return res.status(400).json({ error: "Empresa, Nome e Data são obrigatórios." });
  try {
    await pool.query(
      `UPDATE politicas_ti SET empresa_id=$1,nome_politica=$2,data=$3,status=$4,observacao=$5 WHERE id=$6`,
      [empresaId, nomePolitica.trim(), data, status || "Ativo", observacao || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar política." }); }
});

// DELETE /politicas/anexos/:anexoId  ← deve vir ANTES de DELETE /:id
router.delete("/anexos/:anexoId", auth, async (req, res) => {
  try {
    const r = await pool.query("SELECT filename FROM politicas_anexos WHERE id=$1", [req.params.anexoId]);
    if (r.rows[0]) {
      const fp = path.join(UPLOAD_DIR, r.rows[0].filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await pool.query("DELETE FROM politicas_anexos WHERE id=$1", [req.params.anexoId]);
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir anexo." }); }
});

// GET /politicas/download/:filename  ← deve vir ANTES de /:id
router.get("/download/:filename", auth, (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "Arquivo não encontrado." });
  res.download(fp);
});

// POST /politicas/:id/anexos
router.post("/:id/anexos", auth, upload.array("files", 10), async (req, res) => {
  try {
    const inserted = [];
    for (const f of (req.files || [])) {
      const r = await pool.query(
        "INSERT INTO politicas_anexos (politica_id,nome_original,filename) VALUES ($1,$2,$3) RETURNING id,nome_original AS \"nomeOriginal\",filename",
        [req.params.id, f.originalname, f.filename]
      );
      inserted.push(r.rows[0]);
    }
    res.status(201).json(inserted);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar anexos." }); }
});

// DELETE /politicas/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const ar = await pool.query("SELECT filename FROM politicas_anexos WHERE politica_id=$1", [req.params.id]);
    for (const a of ar.rows) {
      const fp = path.join(UPLOAD_DIR, a.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query("DELETE FROM politicas_ti WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir política." }); }
});

// POST /politicas/:id/enviar
router.post("/:id/enviar", auth, async (req, res) => {
  const { emails, assunto, descricao, anexoIds } = req.body;
  if (!emails?.length || !assunto) return res.status(400).json({ error: "E-mails e assunto são obrigatórios." });
  try {
    const cfgR = await pool.query("SELECT * FROM email_config LIMIT 1");
    const cfg  = cfgR.rows[0];
    if (!cfg) return res.status(400).json({ error: "Configuração de e-mail não encontrada." });

    let anexos = [];
    if (anexoIds?.length) {
      const ar = await pool.query(
        "SELECT nome_original AS \"nomeOriginal\", filename FROM politicas_anexos WHERE id=ANY($1)",
        [anexoIds]
      );
      anexos = ar.rows;
    }

    const transporter = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: { user: cfg.user_email, pass: cfg.password ? decrypt(cfg.password) : "" },
    });

    await transporter.sendMail({
      from:        `"${cfg.from_name}" <${cfg.from_email}>`,
      to:          emails.join(", "),
      subject:     assunto,
      text:        descricao,
      attachments: anexos.map(a => ({
        filename: a.nomeOriginal,
        path:     path.join(UPLOAD_DIR, a.filename),
      })),
    });

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: `Erro ao enviar e-mail: ${err.message}` }); }
});

module.exports = router;
