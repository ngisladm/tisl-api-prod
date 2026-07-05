const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// Registra snapshot do item no histórico de movimentações
async function logHistorico(controleAtivoId, itemId, tipoMovimentacao, usuarioNome, funcionarioDestinoNome) {
  try {
    const [itemRes, caRes] = await Promise.all([
      pool.query(`
        SELECT i.ativo_id, i.linha_id,
               i.marca, i.modelo, i.imei_slot1, i.imei_slot2, i.numero_serie,
               i.sistema_operacional, i.versao, i.processador, i.memoria, i.hd,
               i.patrimonio, i.numero_documento, i.valor,
               i.data_aquisicao,
               i.condicao, i.acessorios, i.status_ativo,
               i.acesso, i.estrutura, i.iccid, i.tipo_pacote,
               c.name AS company_name, ta.name AS tipo_ativo_name,
               a.nome AS ativo_nome, o.name AS operadora_name,
               ld.numero_linha
          FROM itens_controle_ativos i
          LEFT JOIN companies          c  ON c.id  = i.company_id
          LEFT JOIN tipo_ativos        ta ON ta.id = i.tipo_ativo_id
          LEFT JOIN ativos             a  ON a.id  = i.ativo_id
          LEFT JOIN operadoras         o  ON o.id  = i.operadora_id
          LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
         WHERE i.id=$1`, [itemId]),
      pool.query("SELECT nome_funcionario, cpf FROM controle_ativos WHERE id=$1", [controleAtivoId])
    ]);
    const it = itemRes.rows[0];
    const ca = caRes.rows[0];
    if (!it) { console.error("logHistorico: item não encontrado id="+itemId); return; }
    if (!ca) { console.error("logHistorico: controle_ativo não encontrado id="+controleAtivoId); return; }
    const baseVals = [itemId, ca.nome_funcionario, ca.cpf, tipoMovimentacao, usuarioNome,
       it.company_name, it.tipo_ativo_name, it.ativo_nome,
       it.marca, it.modelo, it.imei_slot1, it.imei_slot2,
       it.numero_serie, it.numero_linha, it.operadora_name,
       it.iccid, it.acesso, it.estrutura, it.tipo_pacote,
       it.sistema_operacional, it.versao, it.processador,
       it.memoria, it.hd, it.patrimonio, it.numero_documento,
       it.valor, it.data_aquisicao, it.condicao, it.acessorios, it.status_ativo,
       it.ativo_id || null, it.linha_id || null];
    try {
      await pool.query(`
        INSERT INTO historico_movimentacoes_ativos
          (item_id, funcionario_nome, funcionario_cpf, tipo_movimentacao, usuario_nome,
           company_name, tipo_ativo_name, ativo_nome, marca, modelo, imei_slot1, imei_slot2,
           numero_serie, numero_linha, operadora_name, iccid, acesso, estrutura, tipo_pacote,
           sistema_operacional, versao, processador, memoria, hd, patrimonio, numero_documento,
           valor, data_aquisicao, condicao, acessorios, status_ativo, ativo_id, linha_id,
           funcionario_destino_nome)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)`,
        [...baseVals, funcionarioDestinoNome || null]);
    } catch (colErr) {
      if (colErr.code === '42703') {
        // Colunas novas ainda não existem (migração pendente) — insere sem elas
        await pool.query(`
          INSERT INTO historico_movimentacoes_ativos
            (item_id, funcionario_nome, funcionario_cpf, tipo_movimentacao, usuario_nome,
             company_name, tipo_ativo_name, ativo_nome, marca, modelo, imei_slot1, imei_slot2,
             numero_serie, numero_linha, operadora_name, iccid, acesso, estrutura, tipo_pacote,
             sistema_operacional, versao, processador, memoria, hd, patrimonio, numero_documento,
             valor, data_aquisicao, condicao, acessorios, status_ativo)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
          baseVals.slice(0, 31));
      } else {
        throw colErr;
      }
    }
    console.log(`[logHistorico] OK tipo=${tipoMovimentacao} itemId=${itemId}`);
  } catch (e) {
    console.error(`[logHistorico] ERRO tipo=${tipoMovimentacao} itemId=${itemId}:`, e.code, e.message);
  }
}

// ── Controle de Ativos (cabeçalho) ──────────────────────────

router.get("/", auth, canAccess("s21"), async (req, res) => {
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

router.post("/", auth, canAccess("s21","edit"), async (req, res) => {
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

router.put("/:id", auth, canAccess("s21","edit"), async (req, res) => {
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

router.delete("/:id", auth, canAccess("s21","edit"), async (req, res) => {
  try {
    const check = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM itens_controle_ativos WHERE controle_ativo_id=$1",
      [req.params.id]
    );
    if (check.rows[0].cnt > 0)
      return res.status(400).json({ error: "Este registro possui itens vinculados. Exclua os itens antes de excluir o registro." });
    await pool.query("DELETE FROM controle_ativos WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir registro." }); }
});

// ── Itens de Controle de Ativos ───────────────────────────────

// Retorna todos os itens (resumido) para filtros na tela principal
router.get("/itens/all", auth, canAccess("s21"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.controle_ativo_id AS "controleAtivoId",
              i.company_id    AS "companyId",    c.name  AS "companyName",
              i.operadora_id  AS "operadoraId",  o.name  AS "operadoraName",
              ld.numero_linha AS "numeroLinha",
              TO_CHAR(i.data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
              i.numero_serie     AS "numeroSerie",
              i.numero_documento AS "numeroDocumento",
              i.patrimonio,
              i.imei_slot1 AS "imeiSlot1"
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
router.get("/itens/relatorio", auth, canAccess("s21"), async (req, res) => {
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

router.get("/:id/itens", auth, canAccess("s21"), async (req, res) => {
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

router.post("/:id/itens", auth, canAccess("s21","edit"), async (req, res) => {
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
    const itemId = r.rows[0].id;
    // V11: atualiza status do ativo e da linha para "Em uso"
    if (f.ativoId) await pool.query("UPDATE ativos SET status='Em uso' WHERE id=$1", [f.ativoId]).catch(()=>{});
    if (f.linhaId) await pool.query("UPDATE linhas_disponiveis SET status='Em uso' WHERE id=$1", [f.linhaId]).catch(()=>{});
    await logHistorico(req.params.id, itemId, "Inclusão", req.user?.name || "Sistema");
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar item." }); }
});

router.put("/:id/itens/:itemId", auth, canAccess("s21","edit"), async (req, res) => {
  const f = req.body;
  try {
    // Busca valores antigos para gerenciar mudança de ativo/linha
    const old = await pool.query("SELECT ativo_id, linha_id FROM itens_controle_ativos WHERE id=$1", [req.params.itemId]);
    const oldAtivoId = old.rows[0]?.ativo_id || null;
    const oldLinhaId = old.rows[0]?.linha_id || null;

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

    // V11: gerencia mudança de ativo e linha
    const newAtivoId = f.ativoId || null;
    const newLinhaId = f.linhaId || null;
    if (oldAtivoId && oldAtivoId !== newAtivoId)
      await pool.query("UPDATE ativos SET status='Em Estoque' WHERE id=$1", [oldAtivoId]).catch(()=>{});
    if (newAtivoId)
      await pool.query("UPDATE ativos SET status='Em uso' WHERE id=$1", [newAtivoId]).catch(()=>{});
    if (oldLinhaId && oldLinhaId !== newLinhaId)
      await pool.query("UPDATE linhas_disponiveis SET status='Em estoque' WHERE id=$1", [oldLinhaId]).catch(()=>{});
    if (newLinhaId)
      await pool.query("UPDATE linhas_disponiveis SET status='Em uso' WHERE id=$1", [newLinhaId]).catch(()=>{});

    await logHistorico(req.params.id, req.params.itemId, "Edição", req.user?.name || "Sistema");
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar item." }); }
});

router.delete("/:id/itens/:itemId", auth, canAccess("s21","edit"), async (req, res) => {
  try {
    const old = await pool.query(
      `SELECT ica.ativo_id, ica.linha_id, ta.name AS tipo_ativo_name
         FROM itens_controle_ativos ica
         LEFT JOIN tipo_ativos ta ON ta.id = ica.tipo_ativo_id
        WHERE ica.id=$1`,
      [req.params.itemId]
    );
    const row = old.rows[0];
    const oldAtivoId = row?.ativo_id;
    const oldLinhaId = row?.linha_id;
    const isTelefonia = (row?.tipo_ativo_name || "").toLowerCase() === "telefonia";
    await logHistorico(req.params.id, req.params.itemId, "Exclusão", req.user?.name || "Sistema");
    await pool.query("DELETE FROM itens_controle_ativos WHERE id=$1 AND controle_ativo_id=$2",
      [req.params.itemId, req.params.id]);
    if (isTelefonia) {
      if (oldLinhaId) await pool.query("UPDATE linhas_disponiveis SET status='Em estoque' WHERE id=$1", [oldLinhaId]).catch(()=>{});
    } else {
      if (oldAtivoId) await pool.query("UPDATE ativos SET status='Em Estoque' WHERE id=$1", [oldAtivoId]).catch(()=>{});
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir item." }); }
});

// ── Movimentações ─────────────────────────────────────────────
router.post("/:id/itens/:itemId/movimentacao", auth, canAccess("s21","edit"), async (req, res) => {
  const { tipoMovimentacao, funcionarioId } = req.body;
  console.log(`[movimentacao] tipo=${tipoMovimentacao} itemId=${req.params.itemId} controleId=${req.params.id} funcionarioId=${funcionarioId}`);
  if (!["Transferência","Baixa","Devolução Estoque"].includes(tipoMovimentacao))
    return res.status(400).json({ error: "Tipo de movimentação inválido." });
  try {
    // Busca item completo
    const itemRes = await pool.query(
      "SELECT ativo_id, linha_id FROM itens_controle_ativos WHERE id=$1 AND controle_ativo_id=$2",
      [req.params.itemId, req.params.id]
    );
    if (!itemRes.rows[0]) return res.status(404).json({ error: "Item não encontrado." });
    const { ativo_id: ativoId, linha_id: linhaId } = itemRes.rows[0];

    if (tipoMovimentacao === "Transferência") {
      if (!funcionarioId) return res.status(400).json({ error: "Selecione um funcionário para a transferência." });
      // Busca ou cria controle_ativo para o novo funcionário
      let novoCaId;
      let funcionarioDestinoNome = null;
      const existCa = await pool.query("SELECT id FROM controle_ativos WHERE funcionario_id=$1 LIMIT 1", [funcionarioId]);
      if (existCa.rows.length > 0) {
        novoCaId = existCa.rows[0].id;
        const funcRes = await pool.query("SELECT nome FROM funcionarios WHERE id=$1", [funcionarioId]);
        funcionarioDestinoNome = funcRes.rows[0]?.nome || null;
      } else {
        const funcRes = await pool.query("SELECT nome, cpf FROM funcionarios WHERE id=$1", [funcionarioId]);
        if (!funcRes.rows[0]) return res.status(404).json({ error: "Funcionário não encontrado." });
        funcionarioDestinoNome = funcRes.rows[0].nome;
        const newCa = await pool.query(
          "INSERT INTO controle_ativos (nome_funcionario, cpf, funcionario_id) VALUES ($1,$2,$3) RETURNING id",
          [funcRes.rows[0].nome, funcRes.rows[0].cpf, funcionarioId]
        );
        novoCaId = newCa.rows[0].id;
      }
      await logHistorico(req.params.id, req.params.itemId, "Transferência", req.user?.name || "Sistema", funcionarioDestinoNome);
      await pool.query("UPDATE itens_controle_ativos SET controle_ativo_id=$1, updated_at=NOW() WHERE id=$2",
        [novoCaId, req.params.itemId]);
    } else if (tipoMovimentacao === "Baixa") {
      await logHistorico(req.params.id, req.params.itemId, "Baixa", req.user?.name || "Sistema");
      if (ativoId) await pool.query("UPDATE ativos SET status='Baixado' WHERE id=$1", [ativoId]).catch(()=>{});
      if (linhaId) await pool.query("UPDATE linhas_disponiveis SET status='Baixado' WHERE id=$1", [linhaId]).catch(()=>{});
      await pool.query("DELETE FROM itens_controle_ativos WHERE id=$1", [req.params.itemId]);
    } else if (tipoMovimentacao === "Devolução Estoque") {
      await logHistorico(req.params.id, req.params.itemId, "Devolução Estoque", req.user?.name || "Sistema");
      if (ativoId) await pool.query("UPDATE ativos SET status='Em Estoque' WHERE id=$1", [ativoId]).catch(()=>{});
      if (linhaId) await pool.query("UPDATE linhas_disponiveis SET status='Em estoque' WHERE id=$1", [linhaId]).catch(()=>{});
      await pool.query("DELETE FROM itens_controle_ativos WHERE id=$1", [req.params.itemId]);
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao registrar movimentação." }); }
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

router.put("/:id/itens/:itemId/anexos", auth, canAccess("s21","edit"), async (req, res) => {
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
