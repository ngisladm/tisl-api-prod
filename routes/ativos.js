const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const FIELDS = `
  a.id, a.nome,
  a.tipo_ativo_id AS "tipoAtivoId", ta.name AS "tipoAtivoName",
  a.company_id    AS "companyId",   c.name  AS "companyName",
  a.marca, a.modelo,
  a.numero_serie        AS "numeroSerie",
  a.sistema_operacional AS "sistemaOperacional",
  a.versao, a.processador, a.memoria, a.hd, a.patrimonio,
  a.numero_documento    AS "numeroDocumento",
  a.valor,
  TO_CHAR(a.data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
  a.condicao, a.acessorios,
  a.imei_slot1 AS "imeiSlot1",
  a.imei_slot2 AS "imeiSlot2",
  COALESCE(a.status,'Em Estoque') AS status
`;

router.get("/", auth, canAccess("s20"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${FIELDS}
         FROM ativos a
         LEFT JOIN tipo_ativos ta ON ta.id = a.tipo_ativo_id
         LEFT JOIN companies   c  ON c.id  = a.company_id
        ORDER BY a.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar ativos." }); }
});

const parseDate = str => {
  if (!str) return null;
  const [d, m, y] = str.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

router.post("/", auth, canAccess("s20","edit"), async (req, res) => {
  const { nome, tipoAtivoId, companyId, marca, modelo, numeroSerie, sistemaOperacional,
          versao, processador, memoria, hd, patrimonio, numeroDocumento, valor,
          dataAquisicao, condicao, acessorios, imeiSlot1, imeiSlot2 } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome do ativo é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO ativos
         (nome, tipo_ativo_id, company_id, marca, modelo, numero_serie,
          sistema_operacional, versao, processador, memoria, hd, patrimonio,
          numero_documento, valor, data_aquisicao, condicao, acessorios,
          imei_slot1, imei_slot2, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'Em Estoque')
       RETURNING id`,
      [nome.trim(), tipoAtivoId||null, companyId||null, marca||null, modelo||null,
       numeroSerie||null, sistemaOperacional||null, versao||null, processador||null,
       memoria||null, hd||null, patrimonio||null, numeroDocumento||null,
       valor||null, parseDate(dataAquisicao), condicao||null, acessorios||null,
       imeiSlot1||null, imeiSlot2||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar ativo." }); }
});

router.put("/:id", auth, canAccess("s20","edit"), async (req, res) => {
  const { nome, tipoAtivoId, companyId, marca, modelo, numeroSerie, sistemaOperacional,
          versao, processador, memoria, hd, patrimonio, numeroDocumento, valor,
          dataAquisicao, condicao, acessorios, imeiSlot1, imeiSlot2 } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome do ativo é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE ativos SET
         nome=$1, tipo_ativo_id=$2, company_id=$3, marca=$4, modelo=$5,
         numero_serie=$6, sistema_operacional=$7, versao=$8, processador=$9,
         memoria=$10, hd=$11, patrimonio=$12, numero_documento=$13,
         valor=$14, data_aquisicao=$15, condicao=$16, acessorios=$17,
         imei_slot1=$18, imei_slot2=$19, updated_at=NOW()
       WHERE id=$20
       RETURNING id`,
      [nome.trim(), tipoAtivoId||null, companyId||null, marca||null, modelo||null,
       numeroSerie||null, sistemaOperacional||null, versao||null, processador||null,
       memoria||null, hd||null, patrimonio||null, numeroDocumento||null,
       valor||null, parseDate(dataAquisicao), condicao||null, acessorios||null,
       imeiSlot1||null, imeiSlot2||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Ativo não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar ativo." }); }
});

router.delete("/:id", auth, canAccess("s20","edit"), async (req, res) => {
  try {
    const check = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM historico_movimentacoes_ativos WHERE ativo_id = $1
       ) AS in_historico`,
      [req.params.id]
    );
    if (check.rows[0].in_historico)
      return res.status(400).json({ error: "Este ativo possui registros no Histórico de Movimentações e não pode ser excluído." });
    await pool.query("DELETE FROM ativos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir ativo." }); }
});

// POST /ativos/:id/reverter-baixa — somente Master
router.post("/:id/reverter-baixa", auth, async (req, res) => {
  if (!req.user.isMaster)
    return res.status(403).json({ error: "Apenas usuários Master podem reverter baixas." });
  try {
    const aRes = await pool.query(
      `SELECT a.nome, a.status,
              c.name  AS company_name,
              ta.name AS tipo_ativo_name
         FROM ativos a
         LEFT JOIN companies   c  ON c.id  = a.company_id
         LEFT JOIN tipo_ativos ta ON ta.id = a.tipo_ativo_id
        WHERE a.id=$1`, [req.params.id]
    );
    const a = aRes.rows[0];
    if (!a) return res.status(404).json({ error: "Ativo não encontrado." });
    if (a.status !== "Baixado")
      return res.status(400).json({ error: "Este ativo não está com status 'Baixado'." });

    await pool.query(
      "UPDATE ativos SET status='Em Estoque', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    await pool.query(
      `INSERT INTO historico_movimentacoes_ativos
         (tipo_movimentacao, ativo_nome, tipo_ativo_name, company_name, usuario_nome)
       VALUES ($1,$2,$3,$4,$5)`,
      ["Reversão de Baixa", a.nome, a.tipo_ativo_name || null, a.company_name || null, req.user.name || "Sistema"]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao reverter baixa." }); }
});

module.exports = router;
