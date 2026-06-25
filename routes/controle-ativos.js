const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// ── Controle de Ativos (cabeçalho) ──────────────────────────

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ca.id, ca.nome_funcionario AS "nomeFuncionario", ca.cpf,
              COUNT(i.id)::int AS "totalItens", ca.created_at AS "createdAt"
         FROM controle_ativos ca
         LEFT JOIN itens_controle_ativos i ON i.controle_ativo_id = ca.id
        GROUP BY ca.id ORDER BY ca.nome_funcionario`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar controle de ativos." }); }
});

router.post("/", auth, async (req, res) => {
  const { nomeFuncionario, cpf } = req.body;
  if (!nomeFuncionario?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO controle_ativos (nome_funcionario, cpf) VALUES ($1,$2)
       RETURNING id, nome_funcionario AS "nomeFuncionario", cpf`,
      [nomeFuncionario.trim(), cpf||null]
    );
    res.status(201).json({ ...r.rows[0], totalItens: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar registro." }); }
});

router.put("/:id", auth, async (req, res) => {
  const { nomeFuncionario, cpf } = req.body;
  if (!nomeFuncionario?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE controle_ativos SET nome_funcionario=$1, cpf=$2, updated_at=NOW() WHERE id=$3
       RETURNING id, nome_funcionario AS "nomeFuncionario", cpf`,
      [nomeFuncionario.trim(), cpf||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar registro." }); }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_controle_ativos WHERE controle_ativo_id=$1", [req.params.id]);
    await pool.query("DELETE FROM controle_ativos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir registro." }); }
});

// ── Itens de Controle de Ativos ───────────────────────────────

// Retorna todos os itens (resumido) para filtros na tela principal
router.get("/itens/all", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.controle_ativo_id AS "controleAtivoId",
              i.company_id    AS "companyId",    c.name  AS "companyName",
              i.operadora_id  AS "operadoraId",  o.name  AS "operadoraName",
              ld.numero_linha AS "numeroLinha",
              TO_CHAR(i.data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
              i.numero_serie     AS "numeroSerie",
              i.numero_documento AS "numeroDocumento"
         FROM itens_controle_ativos i
         LEFT JOIN companies          c  ON c.id  = i.company_id
         LEFT JOIN operadoras         o  ON o.id  = i.operadora_id
         LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
        ORDER BY i.created_at`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

router.get("/:id/itens", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id,
              i.acesso, i.estrutura, i.iccid, i.tipo_pacote AS "tipoPacote",
              i.marca, i.modelo, i.imei_slot1 AS "imeiSlot1", i.imei_slot2 AS "imeiSlot2",
              i.numero_serie AS "numeroSerie", i.sistema_operacional AS "sistemaOperacional",
              i.versao, i.processador, i.memoria, i.hd, i.patrimonio,
              i.numero_documento AS "numeroDocumento",
              i.valor, TO_CHAR(i.data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
              i.condicao, i.acessorios, i.status_ativo AS "statusAtivo",
              i.attachments,
              i.company_id    AS "companyId",   c.name  AS "companyName",
              i.tipo_ativo_id AS "tipoAtivoId", ta.name AS "tipoAtivoName",
              i.operadora_id  AS "operadoraId", o.name  AS "operadoraName",
              i.linha_id      AS "linhaId",     ld.numero_linha AS "numeroLinha",
              i.ativo_id      AS "ativoId",     a.nome  AS "ativoNome"
         FROM itens_controle_ativos i
         LEFT JOIN companies          c  ON c.id  = i.company_id
         LEFT JOIN tipo_ativos        ta ON ta.id = i.tipo_ativo_id
         LEFT JOIN operadoras         o  ON o.id  = i.operadora_id
         LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
         LEFT JOIN ativos             a  ON a.id  = i.ativo_id
        WHERE i.controle_ativo_id=$1
        ORDER BY i.created_at`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

const parseDate = str => {
  if (!str) return null;
  const [d,m,y] = str.split("/");
  if (!d||!m||!y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

router.post("/:id/itens", auth, async (req, res) => {
  const f = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO itens_controle_ativos
         (controle_ativo_id, company_id, tipo_ativo_id, operadora_id, linha_id, ativo_id,
          acesso, estrutura, iccid, tipo_pacote,
          marca, modelo, imei_slot1, imei_slot2, numero_serie, sistema_operacional,
          versao, processador, memoria, hd, patrimonio, numero_documento,
          valor, data_aquisicao, condicao, acessorios, status_ativo, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'[]')
       RETURNING id`,
      [req.params.id,
       f.companyId||null, f.tipoAtivoId||null, f.operadoraId||null, f.linhaId||null, f.ativoId||null,
       f.acesso||null, f.estrutura||null, f.iccid||null, f.tipoPacote||null,
       f.marca||null, f.modelo||null, f.imeiSlot1||null, f.imeiSlot2||null,
       f.numeroSerie||null, f.sistemaOperacional||null, f.versao||null,
       f.processador||null, f.memoria||null, f.hd||null, f.patrimonio||null,
       f.numeroDocumento||null,
       f.valor||null, parseDate(f.dataAquisicao), f.condicao||null,
       f.acessorios||null, f.statusAtivo||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar item." }); }
});

router.put("/:id/itens/:itemId", auth, async (req, res) => {
  const f = req.body;
  try {
    const r = await pool.query(
      `UPDATE itens_controle_ativos SET
         company_id=$1, tipo_ativo_id=$2, operadora_id=$3, linha_id=$4, ativo_id=$5,
         acesso=$6, estrutura=$7, iccid=$8, tipo_pacote=$9,
         marca=$10, modelo=$11, imei_slot1=$12, imei_slot2=$13, numero_serie=$14,
         sistema_operacional=$15, versao=$16, processador=$17, memoria=$18, hd=$19,
         patrimonio=$20, numero_documento=$21, valor=$22, data_aquisicao=$23,
         condicao=$24, acessorios=$25, status_ativo=$26, updated_at=NOW()
       WHERE id=$27 AND controle_ativo_id=$28
       RETURNING id`,
      [f.companyId||null, f.tipoAtivoId||null, f.operadoraId||null, f.linhaId||null, f.ativoId||null,
       f.acesso||null, f.estrutura||null, f.iccid||null, f.tipoPacote||null,
       f.marca||null, f.modelo||null, f.imeiSlot1||null, f.imeiSlot2||null,
       f.numeroSerie||null, f.sistemaOperacional||null, f.versao||null,
       f.processador||null, f.memoria||null, f.hd||null, f.patrimonio||null,
       f.numeroDocumento||null, f.valor||null, parseDate(f.dataAquisicao),
       f.condicao||null, f.acessorios||null, f.statusAtivo||null,
       req.params.itemId, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Item não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar item." }); }
});

router.delete("/:id/itens/:itemId", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_controle_ativos WHERE id=$1 AND controle_ativo_id=$2",
      [req.params.itemId, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir item." }); }
});

// ── Anexos ────────────────────────────────────────────────────

router.put("/:id/itens/:itemId/anexos", auth, async (req, res) => {
  const { attachments } = req.body;
  try {
    await pool.query(
      "UPDATE itens_controle_ativos SET attachments=$1, updated_at=NOW() WHERE id=$2 AND controle_ativo_id=$3",
      [JSON.stringify(attachments||[]), req.params.itemId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar anexos." }); }
});

module.exports = router;
