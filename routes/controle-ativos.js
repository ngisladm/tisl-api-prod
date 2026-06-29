const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// ── Controle de Ativos (cabeçalho) ──────────────────────────

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ca.id, ca.nome_funcionario AS "nomeFuncionario", ca.cpf,
              ca.funcionario_id AS "funcionarioId",
              COUNT(i.id)::int AS "totalItens", ca.created_at AS "createdAt"
         FROM controle_ativos ca
         LEFT JOIN itens_controle_ativos i ON i.controle_ativo_id = ca.id
        GROUP BY ca.id ORDER BY ca.nome_funcionario`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar controle de ativos." }); }
});

router.post("/", auth, async (req, res) => {
  const { nomeFuncionario, cpf, funcionarioId } = req.body;
  if (!nomeFuncionario?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    // Unique funcionário: each employee can only have one controle_ativo record
    if (funcionarioId) {
      const dup = await pool.query("SELECT id FROM controle_ativos WHERE funcionario_id=$1 LIMIT 1", [funcionarioId]);
      if (dup.rows.length > 0)
        return res.status(400).json({ error: "Este funcionário já possui um registro de Controle de Ativos." });
    }
    const r = await pool.query(
      `INSERT INTO controle_ativos (nome_funcionario, cpf, funcionario_id) VALUES ($1,$2,$3)
       RETURNING id, nome_funcionario AS "nomeFuncionario", cpf, funcionario_id AS "funcionarioId"`,
      [nomeFuncionario.trim(), cpf||null, funcionarioId||null]
    );
    res.status(201).json({ ...r.rows[0], totalItens: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar registro." }); }
});

router.put("/:id", auth, async (req, res) => {
  const { nomeFuncionario, cpf, funcionarioId } = req.body;
  if (!nomeFuncionario?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE controle_ativos SET nome_funcionario=$1, cpf=$2, funcionario_id=$3, updated_at=NOW() WHERE id=$4
       RETURNING id, nome_funcionario AS "nomeFuncionario", cpf, funcionario_id AS "funcionarioId"`,
      [nomeFuncionario.trim(), cpf||null, funcionarioId||null, req.params.id]
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

// Retorna todos os itens com info completa para relatórios
router.get("/itens/relatorio", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ca.nome_funcionario AS "nomeFuncionario", ca.cpf, ca.funcionario_id AS "funcionarioId",
              i.id,
              i.company_id    AS "companyId",    c.name  AS "companyName",
              i.tipo_ativo_id AS "tipoAtivoId",  ta.name AS "tipoAtivoName",
              i.ativo_id      AS "ativoId",       a.nome  AS "ativoNome",
              i.marca, i.modelo, i.imei_slot1 AS "imeiSlot1", i.imei_slot2 AS "imeiSlot2",
              i.numero_serie     AS "numeroSerie",
              i.numero_documento AS "numeroDocumento",
              i.sistema_operacional AS "sistemaOperacional", i.versao, i.processador,
              i.memoria, i.hd, i.patrimonio,
              i.valor, TO_CHAR(i.data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
              i.condicao, i.acessorios, i.status_ativo AS "statusAtivo",
              i.operadora_id  AS "operadoraId",  o.name  AS "operadoraName",
              i.linha_id      AS "linhaId",       ld.numero_linha AS "numeroLinha",
              i.iccid, i.acesso, i.estrutura, i.tipo_pacote AS "tipoPacote"
         FROM itens_controle_ativos i
         JOIN controle_ativos ca ON ca.id = i.controle_ativo_id
         LEFT JOIN companies          c  ON c.id  = i.company_id
         LEFT JOIN tipo_ativos        ta ON ta.id = i.tipo_ativo_id
         LEFT JOIN ativos             a  ON a.id  = i.ativo_id
         LEFT JOIN operadoras         o  ON o.id  = i.operadora_id
         LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
        ORDER BY ca.nome_funcionario, ta.name, a.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar dados." }); }
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

// ── Carga Inicial ─────────────────────────────────────────────
// POST /controle-ativos/carga-inicial
// CSV cols (1-based):
//  1=CPF, 2=TipoAtivo, 3=Empresa,
//  Não-Telefonia: 4=NomeAtivo,5=Marca,6=Modelo,7=Serie,8=SO,9=Versao,10=Proc,11=Mem,12=HD,13=Patrimonio,14=NrDoc,15=Valor,16=DataAq,17=Condicao,18=Acessorios,19=Status
//  Telefonia: 20=Marca,21=Modelo,22=IMEI1,23=IMEI2,24=Operadora,25=NrLinha,26=Acesso,27=Estrutura,28=ICCID,29=TipoPacote
router.post("/carga-inicial", auth, async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: "Nenhuma linha recebida." });

  // Pré-carrega todas as tabelas de lookup em paralelo (elimina N+1 queries)
  const [funcRows, tipoRows, coRows, opRows, ldRows] = await Promise.all([
    pool.query("SELECT id, nome, cpf FROM funcionarios"),
    pool.query("SELECT id, name FROM tipo_ativos"),
    pool.query("SELECT id, name FROM companies WHERE active=true"),
    pool.query("SELECT id, name FROM operadoras"),
    pool.query("SELECT id, numero_linha, operadora_id FROM linhas_disponiveis"),
  ]);

  const funcByCpf  = new Map(funcRows.rows.map(f => [f.cpf?.replace(/\D/g, "") || "", f]));
  const tipoByName = new Map(tipoRows.rows.map(r => [r.name.toLowerCase(), r]));
  const coByName   = new Map(coRows.rows.map(r => [r.name.toLowerCase(), r]));
  const opByName   = new Map(opRows.rows.map(r => [r.name.toLowerCase(), r]));
  const ldByLinhaOp = new Map(ldRows.rows.map(r => [`${r.numero_linha}|${r.operadora_id}`, r.id]));

  // Cache de ativos criados durante esta importação: `nome|tipoId` → id
  const ativoCache = new Map();

  let inseridos = 0;
  const erros = [];

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    const linhaNum = i + 1;
    const cpf = c[0]?.trim() || "";
    const tipoAtivoNome = c[1]?.trim() || "";
    const empresaNome   = c[2]?.trim() || "";

    if (!cpf) { erros.push({ linha: linhaNum, msg: "CPF ausente." }); continue; }

    try {
      // 1. Busca funcionário pelo CPF via map (sem query)
      const cpfDigits = cpf.replace(/\D/g, "");
      const func = funcByCpf.get(cpfDigits);
      if (!func) { erros.push({ linha: linhaNum, msg: `Funcionário com CPF "${cpf}" não encontrado.` }); continue; }

      // 2. Resolve tipo_ativo e empresa via map (sem query)
      const tipoAtivo    = tipoByName.get(tipoAtivoNome.toLowerCase());
      const tipoAtivoId  = tipoAtivo?.id || null;
      const tipoAtivoNameDB = tipoAtivo?.name || tipoAtivoNome;
      const company      = coByName.get(empresaNome.toLowerCase());
      const companyId    = company?.id || null;

      // 3. Cria controle_ativo
      const caRes = await pool.query(
        `INSERT INTO controle_ativos (nome_funcionario, cpf, funcionario_id) VALUES ($1,$2,$3) RETURNING id`,
        [func.nome, func.cpf, func.id]
      );
      const controleAtivoId = caRes.rows[0].id;

      const isTel = tipoAtivoNameDB.toLowerCase() === "telefonia";

      if (isTel) {
        // Telefonia — lookup via map
        const marcaT    = c[19]?.trim() || null;
        const modeloT   = c[20]?.trim() || null;
        const imei1     = c[21]?.trim() || null;
        const imei2     = c[22]?.trim() || null;
        const opNome    = c[23]?.trim() || null;
        const nrLinha   = c[24]?.trim() || null;
        const acesso    = c[25]?.trim() || null;
        const estrutura = c[26]?.trim() || null;
        const iccid     = c[27]?.trim() || null;
        const tipoPacote= c[28]?.trim() || null;

        const operadoraId = opNome ? (opByName.get(opNome.toLowerCase())?.id || null) : null;
        const linhaId = (nrLinha && operadoraId)
          ? (ldByLinhaOp.get(`${nrLinha}|${operadoraId}`) || null)
          : null;

        await pool.query(
          `INSERT INTO itens_controle_ativos
             (controle_ativo_id, company_id, tipo_ativo_id, operadora_id, linha_id,
              marca, modelo, imei_slot1, imei_slot2, acesso, estrutura, iccid, tipo_pacote, attachments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'[]')`,
          [controleAtivoId, companyId, tipoAtivoId, operadoraId, linhaId,
           marcaT, modeloT, imei1, imei2, acesso, estrutura, iccid, tipoPacote]
        );
      } else {
        // Não-Telefonia — ativo com cache local
        const nomeAtivo  = c[3]?.trim() || null;
        const marca      = c[4]?.trim() || null;
        const modelo     = c[5]?.trim() || null;
        const serie      = c[6]?.trim() || null;
        const so         = c[7]?.trim() || null;
        const versao     = c[8]?.trim() || null;
        const proc       = c[9]?.trim() || null;
        const mem        = c[10]?.trim() || null;
        const hd         = c[11]?.trim() || null;
        const patr       = c[12]?.trim() || null;
        const nrDoc      = c[13]?.trim() || null;
        const valor      = c[14]?.trim() || null;
        const dataAq     = c[15]?.trim() || null;
        const condicao   = c[16]?.trim() || null;
        const acessorios = c[17]?.trim() || null;
        const status     = c[18]?.trim() || null;

        let ativoId = null;
        if (nomeAtivo) {
          const cacheKey = `${nomeAtivo.toLowerCase()}|${tipoAtivoId}`;
          if (ativoCache.has(cacheKey)) {
            ativoId = ativoCache.get(cacheKey);
          } else {
            const atRes = await pool.query(
              "SELECT id FROM ativos WHERE LOWER(nome)=LOWER($1) AND tipo_ativo_id IS NOT DISTINCT FROM $2 LIMIT 1",
              [nomeAtivo, tipoAtivoId]
            );
            if (atRes.rows[0]) {
              ativoId = atRes.rows[0].id;
            } else {
              const newAt = await pool.query("INSERT INTO ativos (nome, tipo_ativo_id) VALUES ($1,$2) RETURNING id", [nomeAtivo, tipoAtivoId]);
              ativoId = newAt.rows[0].id;
            }
            ativoCache.set(cacheKey, ativoId);
          }
        }

        await pool.query(
          `INSERT INTO itens_controle_ativos
             (controle_ativo_id, company_id, tipo_ativo_id, ativo_id,
              marca, modelo, numero_serie, sistema_operacional, versao,
              processador, memoria, hd, patrimonio, numero_documento,
              valor, data_aquisicao, condicao, acessorios, status_ativo, attachments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'[]')`,
          [controleAtivoId, companyId, tipoAtivoId, ativoId,
           marca, modelo, serie, so, versao,
           proc, mem, hd, patr, nrDoc,
           valor||null, parseDate(dataAq), condicao, acessorios, status]
        );
      }

      inseridos++;
    } catch (e) {
      erros.push({ linha: linhaNum, msg: e.message });
    }
  }

  res.json({ inseridos, erros });
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
