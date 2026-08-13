const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// Reutiliza a função logHistorico adaptada para terceirizados
async function logHistoricoTerc(controleId, itemId, tipoMovimentacao, usuarioNome, destinoNome) {
  try {
    const [itemRes, caRes] = await Promise.all([
      pool.query(`
        SELECT i.ativo_id, i.linha_id,
               i.marca, i.modelo, i.imei_slot1, i.imei_slot2, i.numero_serie,
               i.sistema_operacional, i.versao, i.processador, i.memoria, i.hd,
               i.patrimonio, i.numero_documento, i.valor,
               i.data_aquisicao, i.condicao, i.acessorios, i.status_ativo,
               i.acesso, i.estrutura, i.iccid, i.tipo_pacote,
               c.name AS company_name, ta.name AS tipo_ativo_name,
               a.nome AS ativo_nome, o.name AS operadora_name,
               ld.numero_linha
          FROM itens_controle_ativos_terceirizados i
          LEFT JOIN companies          c  ON c.id  = i.company_id
          LEFT JOIN tipo_ativos        ta ON ta.id = i.tipo_ativo_id
          LEFT JOIN ativos             a  ON a.id  = i.ativo_id
          LEFT JOIN operadoras         o  ON o.id  = i.operadora_id
          LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
         WHERE i.id=$1`, [itemId]),
      pool.query(`SELECT nf.nome || ' — ' || COALESCE(c.name,'') AS nome_localizacao
                    FROM controle_ativos_terceirizados cat
                    LEFT JOIN network_filiais nf ON nf.id = cat.localizacao_id
                    LEFT JOIN companies c ON c.id = nf.empresa_id
                   WHERE cat.id=$1`, [controleId])
    ]);
    const it = itemRes.rows[0];
    const ca = caRes.rows[0];
    if (!it || !ca) return;
    await pool.query(`
      INSERT INTO historico_movimentacoes_ativos
        (item_id, funcionario_nome, tipo_movimentacao, usuario_nome,
         company_name, tipo_ativo_name, ativo_nome, marca, modelo, imei_slot1, imei_slot2,
         numero_serie, numero_linha, operadora_name, iccid, acesso, estrutura, tipo_pacote,
         sistema_operacional, versao, processador, memoria, hd, patrimonio, numero_documento,
         valor, data_aquisicao, condicao, acessorios, status_ativo, ativo_id, linha_id,
         funcionario_destino_nome)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [itemId, ca.nome_localizacao, tipoMovimentacao, usuarioNome,
       it.company_name, it.tipo_ativo_name, it.ativo_nome,
       it.marca, it.modelo, it.imei_slot1, it.imei_slot2,
       it.numero_serie, it.numero_linha, it.operadora_name,
       it.iccid, it.acesso, it.estrutura, it.tipo_pacote,
       it.sistema_operacional, it.versao, it.processador,
       it.memoria, it.hd, it.patrimonio, it.numero_documento,
       it.valor, it.data_aquisicao, it.condicao, it.acessorios, it.status_ativo,
       it.ativo_id || null, it.linha_id || null, destinoNome || null]);
  } catch (e) {
    console.error(`[logHistoricoTerc] ERRO tipo=${tipoMovimentacao} itemId=${itemId}:`, e.message);
  }
}

// ── Cabeçalho ──────────────────────────────────────────────────

router.get("/", auth, canAccess("s69"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT cat.id,
             cat.localizacao_id AS "localizacaoId",
             nf.nome || ' — ' || COALESCE(c.name,'') AS "nomeLocalizacao",
             nf.nome AS "filialNome", c.name AS "empresaNome"
        FROM controle_ativos_terceirizados cat
        LEFT JOIN network_filiais nf ON nf.id = cat.localizacao_id
        LEFT JOIN companies c ON c.id = nf.empresa_id
       ORDER BY nf.nome`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar registros." }); }
});

router.post("/", auth, canAccess("s69","edit"), async (req, res) => {
  const { localizacaoId } = req.body;
  if (!localizacaoId) return res.status(400).json({ error: "Selecione uma localização." });
  try {
    const r = await pool.query(
      `INSERT INTO controle_ativos_terceirizados (localizacao_id) VALUES ($1) RETURNING id`,
      [localizacaoId]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar registro." }); }
});

router.put("/:id", auth, canAccess("s69","edit"), async (req, res) => {
  const { localizacaoId } = req.body;
  if (!localizacaoId) return res.status(400).json({ error: "Selecione uma localização." });
  try {
    await pool.query(
      `UPDATE controle_ativos_terceirizados SET localizacao_id=$1, updated_at=NOW() WHERE id=$2`,
      [localizacaoId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar." }); }
});

router.delete("/:id", auth, canAccess("s69","delete"), async (req, res) => {
  try {
    const check = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM itens_controle_ativos_terceirizados WHERE controle_terceirizado_id=$1",
      [req.params.id]
    );
    if (check.rows[0].cnt > 0)
      return res.status(400).json({ error: "Este registro possui itens vinculados. Exclua os itens antes de excluir o registro." });
    await pool.query("DELETE FROM controle_ativos_terceirizados WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir." }); }
});

// ── Itens ──────────────────────────────────────────────────────

const ITEM_FIELDS = `
  i.id, i.controle_terceirizado_id AS "controleAtivoId",
  i.company_id AS "companyId", c.name AS "companyName",
  i.tipo_ativo_id AS "tipoAtivoId", ta.name AS "tipoAtivoName",
  i.operadora_id AS "operadoraId", o.name AS "operadoraName",
  i.linha_id AS "linhaId", ld.numero_linha AS "numeroLinha",
  i.ativo_id AS "ativoId", a.nome AS "ativoNome",
  i.acesso, i.estrutura, i.iccid, i.tipo_pacote AS "tipoPacote",
  i.marca, i.modelo, i.imei_slot1 AS "imeiSlot1", i.imei_slot2 AS "imeiSlot2",
  i.numero_serie AS "numeroSerie", i.sistema_operacional AS "sistemaOperacional",
  i.versao, i.processador, i.memoria, i.hd, i.patrimonio,
  i.numero_documento AS "numeroDocumento",
  i.valor, TO_CHAR(i.data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
  i.condicao, i.acessorios, i.status_ativo AS "statusAtivo",
  i.supplier_id AS "supplierId", s.name AS "supplierName",
  i.toner, i.franquia, i.vr_excedentes AS "vrExcedentes",
  i.ip, i.attachments
`;

router.get("/:id/itens", auth, canAccess("s69"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ${ITEM_FIELDS}
        FROM itens_controle_ativos_terceirizados i
        LEFT JOIN companies c ON c.id = i.company_id
        LEFT JOIN tipo_ativos ta ON ta.id = i.tipo_ativo_id
        LEFT JOIN operadoras o ON o.id = i.operadora_id
        LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
        LEFT JOIN ativos a ON a.id = i.ativo_id
        LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.controle_terceirizado_id=$1
       ORDER BY ta.name, a.nome`, [req.params.id]);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// GET /controle-ativos-terceirizados/itens/relatorio — para relatórios s71/s72
router.get("/itens/relatorio", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ${ITEM_FIELDS},
             cat.localizacao_id AS "localizacaoId",
             nf.nome AS "filialNome",
             nf.nome || ' — ' || COALESCE(emp.name,'') AS "nomeLocalizacao",
             emp.name AS "empresaLocalizacao"
        FROM itens_controle_ativos_terceirizados i
        LEFT JOIN controle_ativos_terceirizados cat ON cat.id = i.controle_terceirizado_id
        LEFT JOIN network_filiais nf ON nf.id = cat.localizacao_id
        LEFT JOIN companies emp ON emp.id = nf.empresa_id
        LEFT JOIN companies c ON c.id = i.company_id
        LEFT JOIN tipo_ativos ta ON ta.id = i.tipo_ativo_id
        LEFT JOIN operadoras o ON o.id = i.operadora_id
        LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
        LEFT JOIN ativos a ON a.id = i.ativo_id
        LEFT JOIN suppliers s ON s.id = i.supplier_id
       ORDER BY nf.nome, ta.name, a.nome`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar relatório." }); }
});

router.get("/itens/all", auth, canAccess("s69"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ${ITEM_FIELDS}
        FROM itens_controle_ativos_terceirizados i
        LEFT JOIN companies c ON c.id = i.company_id
        LEFT JOIN tipo_ativos ta ON ta.id = i.tipo_ativo_id
        LEFT JOIN operadoras o ON o.id = i.operadora_id
        LEFT JOIN linhas_disponiveis ld ON ld.id = i.linha_id
        LEFT JOIN ativos a ON a.id = i.ativo_id
        LEFT JOIN suppliers s ON s.id = i.supplier_id
       ORDER BY ta.name`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

const parseDate = str => {
  if (!str) return null;
  const [d, m, y] = str.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

router.post("/:id/itens", auth, canAccess("s69","edit"), async (req, res) => {
  const { companyId, tipoAtivoId, operadoraId, linhaId, ativoId, acesso, estrutura, iccid,
          tipoPacote, marca, modelo, imeiSlot1, imeiSlot2, numeroSerie, sistemaOperacional,
          versao, processador, memoria, hd, patrimonio, numeroDocumento, valor,
          dataAquisicao, condicao, acessorios, statusAtivo,
          supplierId, toner, franquia, vrExcedentes, ip } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`
      INSERT INTO itens_controle_ativos_terceirizados
        (controle_terceirizado_id, company_id, tipo_ativo_id, operadora_id, linha_id, ativo_id,
         acesso, estrutura, iccid, tipo_pacote, marca, modelo, imei_slot1, imei_slot2,
         numero_serie, sistema_operacional, versao, processador, memoria, hd, patrimonio,
         numero_documento, valor, data_aquisicao, condicao, acessorios, status_ativo,
         supplier_id, toner, franquia, vr_excedentes, ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
      RETURNING id`,
      [req.params.id, companyId||null, tipoAtivoId||null, operadoraId||null, linhaId||null, ativoId||null,
       acesso||null, estrutura||null, iccid||null, tipoPacote||null, marca||null, modelo||null,
       imeiSlot1||null, imeiSlot2||null, numeroSerie||null, sistemaOperacional||null, versao||null,
       processador||null, memoria||null, hd||null, patrimonio||null, numeroDocumento||null,
       valor||null, parseDate(dataAquisicao), condicao||null, acessorios||null, 'Em uso',
       supplierId||null, toner||null, franquia||null, vrExcedentes||null, ip||null]);
    if (ativoId) await client.query("UPDATE ativos SET status='Em uso', updated_at=NOW() WHERE id=$1 AND COALESCE(status,'Em Estoque')='Em Estoque'", [ativoId]);
    if (linhaId) await client.query("UPDATE linhas_disponiveis SET status='Em uso' WHERE id=$1", [linhaId]);
    await client.query("COMMIT");
    await logHistoricoTerc(req.params.id, r.rows[0].id, "Inclusão", req.user.name);
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error: "Erro ao criar item." }); }
  finally { client.release(); }
});

router.put("/:id/itens/:itemId", auth, canAccess("s69","edit"), async (req, res) => {
  const { companyId, tipoAtivoId, operadoraId, linhaId, ativoId, acesso, estrutura, iccid,
          tipoPacote, marca, modelo, imeiSlot1, imeiSlot2, numeroSerie, sistemaOperacional,
          versao, processador, memoria, hd, patrimonio, numeroDocumento, valor,
          dataAquisicao, condicao, acessorios, statusAtivo,
          supplierId, toner, franquia, vrExcedentes, ip } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prev = await client.query("SELECT ativo_id, linha_id FROM itens_controle_ativos_terceirizados WHERE id=$1", [req.params.itemId]);
    const old = prev.rows[0];
    await client.query(`
      UPDATE itens_controle_ativos_terceirizados SET
        company_id=$1, tipo_ativo_id=$2, operadora_id=$3, linha_id=$4, ativo_id=$5,
        acesso=$6, estrutura=$7, iccid=$8, tipo_pacote=$9, marca=$10, modelo=$11,
        imei_slot1=$12, imei_slot2=$13, numero_serie=$14, sistema_operacional=$15,
        versao=$16, processador=$17, memoria=$18, hd=$19, patrimonio=$20,
        numero_documento=$21, valor=$22, data_aquisicao=$23, condicao=$24,
        acessorios=$25, status_ativo=$26,
        supplier_id=$27, toner=$28, franquia=$29, vr_excedentes=$30, ip=$31,
        updated_at=NOW()
       WHERE id=$32`,
      [companyId||null, tipoAtivoId||null, operadoraId||null, linhaId||null, ativoId||null,
       acesso||null, estrutura||null, iccid||null, tipoPacote||null, marca||null, modelo||null,
       imeiSlot1||null, imeiSlot2||null, numeroSerie||null, sistemaOperacional||null, versao||null,
       processador||null, memoria||null, hd||null, patrimonio||null, numeroDocumento||null,
       valor||null, parseDate(dataAquisicao), condicao||null, acessorios||null, statusAtivo||null,
       supplierId||null, toner||null, franquia||null, vrExcedentes||null, ip||null,
       req.params.itemId]);
    if (old?.ativo_id && old.ativo_id !== ativoId) await client.query("UPDATE ativos SET status='Em Estoque', updated_at=NOW() WHERE id=$1", [old.ativo_id]);
    if (ativoId && ativoId !== old?.ativo_id) await client.query("UPDATE ativos SET status='Em uso', updated_at=NOW() WHERE id=$1", [ativoId]);
    if (old?.linha_id && old.linha_id !== linhaId) await client.query("UPDATE linhas_disponiveis SET status='Em estoque' WHERE id=$1", [old.linha_id]);
    if (linhaId && linhaId !== old?.linha_id) await client.query("UPDATE linhas_disponiveis SET status='Em uso' WHERE id=$1", [linhaId]);
    await client.query("COMMIT");
    await logHistoricoTerc(req.params.id, req.params.itemId, "Edição", req.user.name);
    res.json({ success: true });
  } catch (err) { await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error: "Erro ao atualizar item." }); }
  finally { client.release(); }
});

router.delete("/:id/itens/:itemId", auth, canAccess("s69","delete"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await logHistoricoTerc(req.params.id, req.params.itemId, "Exclusão", req.user.name);
    const prev = await client.query("SELECT ativo_id, linha_id FROM itens_controle_ativos_terceirizados WHERE id=$1", [req.params.itemId]);
    const old = prev.rows[0];
    await client.query("DELETE FROM itens_controle_ativos_terceirizados WHERE id=$1", [req.params.itemId]);
    if (old?.ativo_id) await client.query("UPDATE ativos SET status='Em Estoque', updated_at=NOW() WHERE id=$1", [old.ativo_id]);
    if (old?.linha_id) await client.query("UPDATE linhas_disponiveis SET status='Em estoque' WHERE id=$1", [old.linha_id]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) { await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error: "Erro ao excluir item." }); }
  finally { client.release(); }
});

// POST /:id/itens/:itemId/movimentacao
router.post("/:id/itens/:itemId/movimentacao", auth, canAccess("s69","edit"), async (req, res) => {
  const { tipoMovimentacao, localizacaoId } = req.body;
  if (!["Transferência","Baixa","Devolução Estoque"].includes(tipoMovimentacao))
    return res.status(400).json({ error: "Tipo de movimentação inválido." });
  try {
    const itemRes = await pool.query(
      "SELECT ativo_id, linha_id FROM itens_controle_ativos_terceirizados WHERE id=$1 AND controle_terceirizado_id=$2",
      [req.params.itemId, req.params.id]
    );
    if (!itemRes.rows[0]) return res.status(404).json({ error: "Item não encontrado." });
    const { ativo_id: ativoId, linha_id: linhaId } = itemRes.rows[0];

    if (tipoMovimentacao === "Transferência") {
      if (!localizacaoId) return res.status(400).json({ error: "Selecione a localização de destino." });
      const locRes = await pool.query(
        "SELECT nf.nome || ' — ' || COALESCE(c.name,'') AS nome_localizacao FROM network_filiais nf LEFT JOIN companies c ON c.id=nf.empresa_id WHERE nf.id=$1",
        [localizacaoId]
      );
      const nomeLocDest = locRes.rows[0]?.nome_localizacao || null;
      let novoControleId;
      const exist = await pool.query("SELECT id FROM controle_ativos_terceirizados WHERE localizacao_id=$1 LIMIT 1", [localizacaoId]);
      if (exist.rows.length > 0) {
        novoControleId = exist.rows[0].id;
      } else {
        const newControle = await pool.query(
          "INSERT INTO controle_ativos_terceirizados (localizacao_id) VALUES ($1) RETURNING id",
          [localizacaoId]
        );
        novoControleId = newControle.rows[0].id;
      }
      await logHistoricoTerc(req.params.id, req.params.itemId, "Transferência", req.user?.name || "Sistema", nomeLocDest);
      await pool.query("UPDATE itens_controle_ativos_terceirizados SET controle_terceirizado_id=$1, updated_at=NOW() WHERE id=$2",
        [novoControleId, req.params.itemId]);
    } else if (tipoMovimentacao === "Baixa") {
      await logHistoricoTerc(req.params.id, req.params.itemId, "Baixa", req.user?.name || "Sistema");
      if (ativoId) await pool.query("UPDATE ativos SET status='Baixado', updated_at=NOW() WHERE id=$1", [ativoId]).catch(()=>{});
      await pool.query("DELETE FROM itens_controle_ativos_terceirizados WHERE id=$1", [req.params.itemId]);
    } else if (tipoMovimentacao === "Devolução Estoque") {
      await logHistoricoTerc(req.params.id, req.params.itemId, "Devolução Estoque", req.user?.name || "Sistema");
      if (ativoId) await pool.query("UPDATE ativos SET status='Em Estoque', updated_at=NOW() WHERE id=$1", [ativoId]).catch(()=>{});
      if (linhaId) await pool.query("UPDATE linhas_disponiveis SET status='Em estoque' WHERE id=$1", [linhaId]).catch(()=>{});
      await pool.query("DELETE FROM itens_controle_ativos_terceirizados WHERE id=$1", [req.params.itemId]);
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao registrar movimentação." }); }
});

// POST /importar-itens — importa itens via CSV (Localização, Empresa, Tipo de Ativo, Nome do Ativo, Nº de Série)
router.post("/importar-itens", auth, canAccess("s69","edit"), async (req, res) => {
  const { linhas } = req.body;
  if (!Array.isArray(linhas) || linhas.length === 0)
    return res.status(400).json({ error: "Nenhuma linha para importar." });

  const col = (row, ...keys) => {
    for (const k of keys) {
      const v = (row[k] || "").trim();
      if (v) return v;
    }
    return "";
  };

  let inseridos = 0, duplicados = 0, naoEncontrados = 0;
  const erros = [];

  for (let idx = 0; idx < linhas.length; idx++) {
    const l = linhas[idx];
    const nomeLocalizacao = col(l, "Localização", "Localizacao");
    const nomeEmpresa     = col(l, "Empresa");
    const nomeTipoAtivo   = col(l, "Tipo de Ativo");
    const nomeAtivo       = col(l, "Nome do Ativo");
    const numeroSerie     = col(l, "Nº de Série", "Nr de Serie", "Numero de Serie");

    if (!nomeLocalizacao || !nomeAtivo || !numeroSerie) {
      erros.push(`Linha ${idx + 1}: Localização, Nome do Ativo e Nº de Série são obrigatórios.`);
      naoEncontrados++;
      continue;
    }

    try {
      // 1. Resolve localização
      let locQ = "SELECT id FROM network_filiais WHERE LOWER(nome)=LOWER($1)";
      const locP = [nomeLocalizacao];
      const locRes = await pool.query(locQ + " LIMIT 1", locP);
      if (!locRes.rows[0]) {
        erros.push(`Linha ${idx + 1}: Localização "${nomeLocalizacao}" não encontrada.`);
        naoEncontrados++; continue;
      }
      const localizacaoId = locRes.rows[0].id;

      // 2. Resolve empresa
      let companyId = null;
      if (nomeEmpresa) {
        const cRes = await pool.query("SELECT id FROM companies WHERE LOWER(name)=LOWER($1) LIMIT 1", [nomeEmpresa]);
        companyId = cRes.rows[0]?.id || null;
      }

      // 3. Resolve tipo de ativo
      let tipoAtivoId = null;
      if (nomeTipoAtivo) {
        const taRes = await pool.query("SELECT id FROM tipo_ativos WHERE LOWER(name)=LOWER($1) LIMIT 1", [nomeTipoAtivo]);
        tipoAtivoId = taRes.rows[0]?.id || null;
      }

      // 4. Resolve ativo por Nome + Nº de Série
      const ativRes = await pool.query(
        `SELECT id, nome, marca, modelo, numero_serie, sistema_operacional, versao,
                processador, memoria, hd, patrimonio, numero_documento, valor,
                data_aquisicao, condicao, acessorios, imei_slot1, imei_slot2,
                tipo_ativo_id, supplier_id, toner, franquia, vr_excedentes
           FROM ativos
          WHERE LOWER(nome)=LOWER($1) AND LOWER(COALESCE(numero_serie,''))=LOWER($2)
          LIMIT 1`,
        [nomeAtivo, numeroSerie]
      );
      if (!ativRes.rows[0]) {
        erros.push(`Linha ${idx + 1}: Ativo "${nomeAtivo}" com Nº de Série "${numeroSerie}" não encontrado.`);
        naoEncontrados++; continue;
      }
      const ativo = ativRes.rows[0];
      const ativoId = ativo.id;
      const tipoFinal = tipoAtivoId || ativo.tipo_ativo_id || null;

      // 5. Verifica duplicata global por Nº de Série
      const dupRes = await pool.query(
        "SELECT id FROM itens_controle_ativos_terceirizados WHERE LOWER(numero_serie)=LOWER($1) LIMIT 1",
        [numeroSerie]
      );
      if (dupRes.rows[0]) { duplicados++; continue; }

      // 6. Busca ou cria cabeçalho (controle_ativos_terceirizados) para essa localização
      const existeControle = await pool.query(
        "SELECT id FROM controle_ativos_terceirizados WHERE localizacao_id=$1 LIMIT 1",
        [localizacaoId]
      );
      let controleId;
      if (existeControle.rows[0]) {
        controleId = existeControle.rows[0].id;
      } else {
        const novoControle = await pool.query(
          "INSERT INTO controle_ativos_terceirizados (localizacao_id) VALUES ($1) RETURNING id",
          [localizacaoId]
        );
        controleId = novoControle.rows[0].id;
      }

      // 7. Insere o item (supplier_id/toner/franquia/vr_excedentes inseridos apenas se as colunas existirem)
      const colsExtra = [];
      const valsExtra = [];
      try {
        const chk = await pool.query("SELECT supplier_id FROM itens_controle_ativos_terceirizados LIMIT 0");
        colsExtra.push("supplier_id","toner","franquia","vr_excedentes");
        valsExtra.push(ativo.supplier_id||null, ativo.toner||null, ativo.franquia||null, ativo.vr_excedentes||null);
      } catch(_) {}

      const baseCols = `controle_terceirizado_id, company_id, tipo_ativo_id, ativo_id,
           marca, modelo, numero_serie, sistema_operacional, versao,
           processador, memoria, hd, patrimonio, numero_documento, valor,
           data_aquisicao, condicao, acessorios, imei_slot1, imei_slot2, status_ativo, attachments`;
      const baseVals = [controleId, companyId, tipoFinal, ativoId,
         ativo.marca||null, ativo.modelo||null, ativo.numero_serie||null,
         ativo.sistema_operacional||null, ativo.versao||null, ativo.processador||null,
         ativo.memoria||null, ativo.hd||null, ativo.patrimonio||null,
         ativo.numero_documento||null, ativo.valor||null, ativo.data_aquisicao||null,
         ativo.condicao||null, ativo.acessorios||null,
         ativo.imei_slot1||null, ativo.imei_slot2||null, 'Em uso', '[]'];
      const allCols = baseCols + (colsExtra.length ? ", " + colsExtra.join(", ") : "");
      const allVals = [...baseVals, ...valsExtra];
      const placeholders = allVals.map((_,i)=>`$${i+1}`).join(",");
      const r = await pool.query(
        `INSERT INTO itens_controle_ativos_terceirizados (${allCols}) VALUES (${placeholders}) RETURNING id`,
        allVals
      );

      // 8. Marca ativo como "Em uso"
      await pool.query("UPDATE ativos SET status='Em uso', updated_at=NOW() WHERE id=$1 AND COALESCE(status,'Em Estoque')='Em Estoque'", [ativoId]).catch(()=>{});
      await logHistoricoTerc(controleId, r.rows[0].id, "Inclusão", req.user?.name || "Sistema");
      inseridos++;
    } catch (e) {
      console.error("[importar-itens-terc]", e.message);
      erros.push(`Linha ${idx + 1}: ${e.message}`);
    }
  }

  res.json({ success: true, inseridos, duplicados, naoEncontrados, erros: erros.slice(0, 20) });
});

// PUT /:id/itens/:itemId/anexos
router.put("/:id/itens/:itemId/anexos", auth, canAccess("s69","edit"), async (req, res) => {
  const { attachments } = req.body;
  try {
    await pool.query("UPDATE itens_controle_ativos_terceirizados SET attachments=$1, updated_at=NOW() WHERE id=$2",
      [JSON.stringify(attachments||[]), req.params.itemId]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar anexos." }); }
});

module.exports = router;
