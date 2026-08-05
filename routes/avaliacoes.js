const express = require("express");
const router = express.Router();
const pool = require("../db");
const auth = require("../middleware/auth");
const { canAccess, canAccessExact, canAccessAny } = require("../middleware/canAccess");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = process.env.UPLOAD_DIR_PDIS || (process.platform === "win32" ? "C:/uploads/pdis" : "/app/uploads/pdis");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

const parseDate = value => {
  if (!value) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/");
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
};

const validScore = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
const VALID_STATUS = ["Não iniciado", "Em andamento", "Concluído"];

const AVALIACAO_SELECT = `
  SELECT a.id,
         a.equipe_item_id AS "equipeItemId",
         TO_CHAR(a.data, 'DD/MM/YYYY') AS data,
         a.competencia,
         a.esperado,
         a.atual,
         COUNT(p.id) FILTER (WHERE p.status = 'Não iniciado')::int AS "pdiNaoIniciado",
         COUNT(p.id) FILTER (WHERE p.status = 'Em andamento')::int AS "pdiEmAndamento",
         COUNT(p.id) FILTER (WHERE p.status = 'Concluído')::int AS "pdiConcluido"
    FROM avaliacoes a
    LEFT JOIN pdis p ON p.avaliacao_id = a.id
`;

const PDI_SELECT = `
  SELECT p.id,
         p.avaliacao_id AS "avaliacaoId",
         p.objetivo,
         a.competencia AS "competenciaRelacionada",
         p.justificativa,
         p.acao_desenvolvimento AS "acaoDesenvolvimento",
         TO_CHAR(p.prazo, 'DD/MM/YYYY') AS prazo,
         p.responsavel_funcionario_id AS "responsavelId",
         f.nome AS "responsavelNome",
         p.evidencia,
         p.resultado_esperado AS "resultadoEsperado",
         p.resultado_obtido AS "resultadoObtido",
         p.status,
         (SELECT COUNT(*) FROM pdi_anexos pa WHERE pa.pdi_id = p.id)::int AS "anexosCount"
    FROM pdis p
    JOIN avaliacoes a ON a.id = p.avaliacao_id
    LEFT JOIN funcionarios f ON f.id = p.responsavel_funcionario_id
`;

async function removeFilesForPdis(client, pdiIds) {
  if (!pdiIds.length) return [];
  const result = await client.query("SELECT filename FROM pdi_anexos WHERE pdi_id = ANY($1::uuid[])", [pdiIds]);
  return result.rows.map(row => row.filename);
}

function unlinkFiles(filenames) {
  for (const filename of filenames) {
    const filePath = path.join(UPLOAD_DIR, path.basename(filename));
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (err) { console.error("[pdi-anexo]", err.message); }
    }
  }
}

// Relatório agrupado de Avaliações e PDIs.
router.get("/relatorio/pdi", auth, canAccess("s65"), async (req, res) => {
  const { dataInicial, dataFinal, funcionarioId, prazoInicial, prazoFinal, responsavelId, status } = req.query;
  const params = [];
  const where = [];
  const add = (value, condition) => { params.push(value); where.push(condition.replace("?", `$${params.length}`)); };

  if (dataInicial) add(parseDate(dataInicial), "a.data >= ?::date");
  if (dataFinal) add(parseDate(dataFinal), "a.data <= ?::date");
  if (funcionarioId) add(funcionarioId, "ei.funcionario_id = ?::uuid");
  if (prazoInicial) add(parseDate(prazoInicial), "p.prazo >= ?::date");
  if (prazoFinal) add(parseDate(prazoFinal), "p.prazo <= ?::date");
  if (responsavelId) add(responsavelId, "p.responsavel_funcionario_id = ?::uuid");
  if (status) {
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: "Status inválido." });
    add(status, "p.status = ?");
  }

  try {
    const result = await pool.query(
      `SELECT a.id AS "avaliacaoId",
              TO_CHAR(a.data,'DD/MM/YYYY') AS data,
              ei.funcionario_id AS "funcionarioId",
              fn.nome AS "funcionarioNome",
              a.competencia, a.esperado, a.atual,
              (SELECT COUNT(*) FROM pdis pc WHERE pc.avaliacao_id=a.id AND pc.status='Não iniciado')::int AS "pdiNaoIniciado",
              (SELECT COUNT(*) FROM pdis pc WHERE pc.avaliacao_id=a.id AND pc.status='Em andamento')::int AS "pdiEmAndamento",
              (SELECT COUNT(*) FROM pdis pc WHERE pc.avaliacao_id=a.id AND pc.status='Concluído')::int AS "pdiConcluido",
              p.id AS "pdiId",
              p.acao_desenvolvimento AS "acaoDesenvolvimento",
              p.resultado_esperado AS "resultadoEsperado",
              TO_CHAR(p.prazo,'DD/MM/YYYY') AS prazo,
              rf.nome AS "responsavelNome",
              p.status
         FROM avaliacoes a
         JOIN equipe_itens ei ON ei.id = a.equipe_item_id
         JOIN funcionarios fn ON fn.id = ei.funcionario_id
         LEFT JOIN pdis p ON p.avaliacao_id = a.id
         LEFT JOIN funcionarios rf ON rf.id = p.responsavel_funcionario_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY a.data DESC, fn.nome, a.competencia, p.prazo, p.created_at`,
      params
    );

    const groups = [];
    const groupMap = new Map();
    for (const row of result.rows) {
      let group = groupMap.get(row.avaliacaoId);
      if (!group) {
        group = {
          id: row.avaliacaoId,
          data: row.data,
          funcionarioId: row.funcionarioId,
          funcionarioNome: row.funcionarioNome,
          competencia: row.competencia,
          esperado: row.esperado,
          atual: row.atual,
          pdiNaoIniciado: row.pdiNaoIniciado,
          pdiEmAndamento: row.pdiEmAndamento,
          pdiConcluido: row.pdiConcluido,
          pdis: [],
        };
        groupMap.set(row.avaliacaoId, group);
        groups.push(group);
      }
      if (row.pdiId) group.pdis.push({
        id: row.pdiId,
        acaoDesenvolvimento: row.acaoDesenvolvimento,
        resultadoEsperado: row.resultadoEsperado,
        prazo: row.prazo,
        responsavelNome: row.responsavelNome,
        status: row.status,
      });
    }
    res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório de PDI." });
  }
});

// Avaliações do funcionário vinculado ao item da equipe.
router.get("/equipe-item/:itemId", auth, canAccess("s63"), async (req, res) => {
  try {
    const result = await pool.query(
      `${AVALIACAO_SELECT}
       WHERE a.equipe_item_id = $1
       GROUP BY a.id
       ORDER BY a.data DESC, a.created_at DESC`,
      [req.params.itemId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar avaliações." });
  }
});

router.post("/", auth, canAccessExact("s63", "insert"), async (req, res) => {
  const { equipeItemId, data, competencia, esperado, atual } = req.body;
  const parsedDate = parseDate(data);
  if (!equipeItemId || !parsedDate || !competencia?.trim() || !validScore(esperado) || !validScore(atual)) {
    return res.status(400).json({ error: "Preencha Data, Competência, Esperado e Atual corretamente." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO avaliacoes (equipe_item_id, data, competencia, esperado, atual, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [equipeItemId, parsedDate, competencia.trim(), Number(esperado), Number(atual), req.user.id]
    );
    const row = await pool.query(`${AVALIACAO_SELECT} WHERE a.id=$1 GROUP BY a.id`, [result.rows[0].id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(err.code === "23503" ? 404 : 500).json({ error: err.code === "23503" ? "Item da equipe não encontrado." : "Erro ao criar avaliação." });
  }
});

router.put("/:id", auth, canAccessExact("s63", "edit"), async (req, res) => {
  const { data, competencia, esperado, atual } = req.body;
  const parsedDate = parseDate(data);
  if (!parsedDate || !competencia?.trim() || !validScore(esperado) || !validScore(atual)) {
    return res.status(400).json({ error: "Preencha Data, Competência, Esperado e Atual corretamente." });
  }
  try {
    const result = await pool.query(
      `UPDATE avaliacoes SET data=$1, competencia=$2, esperado=$3, atual=$4, updated_at=NOW()
       WHERE id=$5 RETURNING id`,
      [parsedDate, competencia.trim(), Number(esperado), Number(atual), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Avaliação não encontrada." });
    const row = await pool.query(`${AVALIACAO_SELECT} WHERE a.id=$1 GROUP BY a.id`, [req.params.id]);
    res.json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar avaliação." });
  }
});

router.delete("/:id", auth, canAccessExact("s63", "delete"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pdis = await client.query("SELECT id FROM pdis WHERE avaliacao_id=$1", [req.params.id]);
    const filenames = await removeFilesForPdis(client, pdis.rows.map(row => row.id));
    const result = await client.query("DELETE FROM avaliacoes WHERE id=$1", [req.params.id]);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Avaliação não encontrada." });
    }
    await client.query("COMMIT");
    unlinkFiles(filenames);
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir avaliação." });
  } finally {
    client.release();
  }
});

// PDIs vinculados a uma avaliação.
router.get("/:avaliacaoId/pdis", auth, canAccess("s64"), async (req, res) => {
  try {
    const result = await pool.query(`${PDI_SELECT} WHERE p.avaliacao_id=$1 ORDER BY p.created_at DESC`, [req.params.avaliacaoId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar PDIs." });
  }
});

router.post("/:avaliacaoId/pdis", auth, canAccessExact("s64", "insert"), async (req, res) => {
  const { objetivo, justificativa, acaoDesenvolvimento, prazo, responsavelId, evidencia, resultadoEsperado, resultadoObtido, status } = req.body;
  const parsedPrazo = parseDate(prazo);
  if (!objetivo?.trim() || !parsedPrazo || !responsavelId || !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: "Preencha Objetivo, Prazo, Responsável e Status corretamente." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO pdis (avaliacao_id, objetivo, justificativa, acao_desenvolvimento, prazo,
                         responsavel_funcionario_id, evidencia, resultado_esperado, resultado_obtido, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [req.params.avaliacaoId, objetivo, justificativa || null, acaoDesenvolvimento || null, parsedPrazo,
       responsavelId, evidencia || null, resultadoEsperado || null, resultadoObtido || null, status, req.user.id]
    );
    const row = await pool.query(`${PDI_SELECT} WHERE p.id=$1`, [result.rows[0].id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(err.code === "23503" ? 400 : 500).json({ error: err.code === "23503" ? "Avaliação ou responsável inválido." : "Erro ao criar PDI." });
  }
});

router.put("/pdis/:pdiId", auth, canAccessExact("s64", "edit"), async (req, res) => {
  const { objetivo, justificativa, acaoDesenvolvimento, prazo, responsavelId, evidencia, resultadoEsperado, resultadoObtido, status } = req.body;
  const parsedPrazo = parseDate(prazo);
  if (!objetivo?.trim() || !parsedPrazo || !responsavelId || !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: "Preencha Objetivo, Prazo, Responsável e Status corretamente." });
  }
  try {
    const result = await pool.query(
      `UPDATE pdis SET objetivo=$1, justificativa=$2, acao_desenvolvimento=$3, prazo=$4,
                       responsavel_funcionario_id=$5, evidencia=$6, resultado_esperado=$7,
                       resultado_obtido=$8, status=$9, updated_at=NOW()
       WHERE id=$10 RETURNING id`,
      [objetivo, justificativa || null, acaoDesenvolvimento || null, parsedPrazo, responsavelId,
       evidencia || null, resultadoEsperado || null, resultadoObtido || null, status, req.params.pdiId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "PDI não encontrado." });
    const row = await pool.query(`${PDI_SELECT} WHERE p.id=$1`, [req.params.pdiId]);
    res.json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(err.code === "23503" ? 400 : 500).json({ error: err.code === "23503" ? "Responsável inválido." : "Erro ao atualizar PDI." });
  }
});

router.delete("/pdis/:pdiId", auth, canAccessExact("s64", "delete"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const filenames = await removeFilesForPdis(client, [req.params.pdiId]);
    const result = await client.query("DELETE FROM pdis WHERE id=$1", [req.params.pdiId]);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "PDI não encontrado." });
    }
    await client.query("COMMIT");
    unlinkFiles(filenames);
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir PDI." });
  } finally {
    client.release();
  }
});

router.get("/pdis/:pdiId/anexos", auth, canAccess("s64"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nome_original AS "nomeOriginal", created_at AS "createdAt"
       FROM pdi_anexos WHERE pdi_id=$1 ORDER BY created_at`,
      [req.params.pdiId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar anexos." });
  }
});

router.post("/pdis/:pdiId/anexos", auth, canAccessAny("s64", ["insert", "edit"]), upload.array("files", 20), async (req, res) => {
  const inserted = [];
  try {
    for (const file of (req.files || [])) {
      const result = await pool.query(
        `INSERT INTO pdi_anexos (pdi_id, nome_original, filename, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id, nome_original AS "nomeOriginal", created_at AS "createdAt"`,
        [req.params.pdiId, file.originalname, file.filename, req.user.id]
      );
      inserted.push(result.rows[0]);
    }
    res.status(201).json(inserted);
  } catch (err) {
    unlinkFiles((req.files || []).map(file => file.filename));
    console.error(err);
    res.status(err.code === "23503" ? 404 : 500).json({ error: err.code === "23503" ? "PDI não encontrado." : "Erro ao salvar anexos." });
  }
});

router.get("/anexos/:anexoId/download", auth, canAccess("s64"), async (req, res) => {
  try {
    const result = await pool.query("SELECT nome_original, filename FROM pdi_anexos WHERE id=$1", [req.params.anexoId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Anexo não encontrado." });
    const filePath = path.join(UPLOAD_DIR, path.basename(result.rows[0].filename));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Arquivo não encontrado." });
    res.download(filePath, result.rows[0].nome_original);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao baixar anexo." });
  }
});

router.delete("/anexos/:anexoId", auth, canAccessExact("s64", "delete"), async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM pdi_anexos WHERE id=$1 RETURNING filename", [req.params.anexoId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Anexo não encontrado." });
    unlinkFiles([result.rows[0].filename]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir anexo." });
  }
});

module.exports = router;
