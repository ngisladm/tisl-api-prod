const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

function movWhere(q) {
  const c = [], v = [];
  const add = (val, sql) => { v.push(val); c.push(sql.replace("?", `$${v.length}`)); };
  if (q.numSol)          add(Number(q.numSol),    "cm.numero_solicitacao = ?");
  if (q.dataInicio)      add(q.dataInicio,         "cm.data >= ?");
  if (q.dataFim)         add(q.dataFim,            "cm.data <= ?");
  if (q.itemId)          add(q.itemId,             "cm.item_id = ?");
  if (q.estoqueId)       add(q.estoqueId,          "cm.estoque_id = ?");
  if (q.ccustoDespesaId) add(q.ccustoDespesaId,    "cm.ccusto_despesa_id = ?");
  if (q.status)          add(q.status,             "cm.status = ?");
  return { where: c.length ? "WHERE " + c.join(" AND ") : "", values: v };
}

// GET /movimentacao-detalhado (s52)
router.get("/movimentacao-detalhado", auth, canAccess("s52"), async (req, res) => {
  const { where, values } = movWhere(req.query);
  try {
    const r = await pool.query(`
      SELECT cm.numero_solicitacao AS "numSolicitacao", cm.data,
             ci.item, ce.estoque, cc.centro_custo AS "ccustoDespesa",
             SUM(cm.qtde_estoque)::int    AS "qtdeEstoque",
             SUM(cm.qtde_consumida)::int  AS "qtdeConsumida",
             SUM(cm.qtde_solicitada)::int AS "qtdeSolicitada",
             cm.status
        FROM consumo_movimentacao cm
        LEFT JOIN consumo_itens    ci  ON ci.id  = cm.item_id
        LEFT JOIN consumo_estoques ce  ON ce.id  = cm.estoque_id
        LEFT JOIN consumo_ccusto   cc  ON cc.id  = cm.ccusto_despesa_id
       ${where}
       GROUP BY cm.numero_solicitacao, cm.data, ci.item, ce.estoque, cc.centro_custo, cm.status
       ORDER BY cm.numero_solicitacao NULLS LAST, cm.data DESC, ci.item
    `, values);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar relatório." }); }
});

// GET /movimentacao-agr-sol (s53)
router.get("/movimentacao-agr-sol", auth, canAccess("s53"), async (req, res) => {
  const { where, values } = movWhere(req.query);
  try {
    const r = await pool.query(`
      SELECT cm.numero_solicitacao AS "numSolicitacao", cm.data,
             ci.item, ce.estoque,
             SUM(cm.qtde_estoque)::int    AS "qtdeEstoque",
             SUM(cm.qtde_consumida)::int  AS "qtdeConsumida",
             SUM(cm.qtde_solicitada)::int AS "qtdeSolicitada"
        FROM consumo_movimentacao cm
        LEFT JOIN consumo_itens    ci  ON ci.id  = cm.item_id
        LEFT JOIN consumo_estoques ce  ON ce.id  = cm.estoque_id
        LEFT JOIN consumo_ccusto   cc  ON cc.id  = cm.ccusto_despesa_id
       ${where}
       GROUP BY cm.numero_solicitacao, cm.data, ci.item, ce.estoque
       ORDER BY cm.numero_solicitacao NULLS LAST, cm.data DESC, ci.item
    `, values);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar relatório." }); }
});

// GET /movimentacao-resumo (s54)
router.get("/movimentacao-resumo", auth, canAccess("s54"), async (req, res) => {
  const c = [], v = [];
  const add = (val, sql) => { v.push(val); c.push(sql.replace("?", `$${v.length}`)); };
  if (req.query.dataInicio) add(req.query.dataInicio, "cm.data >= ?");
  if (req.query.dataFim)    add(req.query.dataFim,    "cm.data <= ?");
  if (req.query.itemId)    add(req.query.itemId,    "cm.item_id = ?");
  if (req.query.estoqueId) add(req.query.estoqueId, "cm.estoque_id = ?");
  if (req.query.status)    add(req.query.status,    "cm.status = ?");
  const where = c.length ? "WHERE " + c.join(" AND ") : "";
  try {
    const r = await pool.query(`
      SELECT ci.item, ce.estoque,
             SUM(cm.qtde_estoque)::int    AS "qtdeEstoque",
             SUM(cm.qtde_consumida)::int  AS "qtdeConsumida",
             SUM(cm.qtde_solicitada)::int AS "qtdeSolicitada"
        FROM consumo_movimentacao cm
        LEFT JOIN consumo_itens    ci ON ci.id = cm.item_id
        LEFT JOIN consumo_estoques ce ON ce.id = cm.estoque_id
       ${where}
       GROUP BY ci.item, ce.estoque
       ORDER BY ci.item, ce.estoque
    `, v);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar relatório." }); }
});

// GET /entrega (s55)
router.get("/entrega", auth, canAccess("s55"), async (req, res) => {
  const c = [], v = [];
  const add = (val, sql) => { v.push(val); c.push(sql.replace("?", `$${v.length}`)); };
  if (req.query.dataInicio)         add(req.query.dataInicio,         "ce.data >= ?");
  if (req.query.dataFim)            add(req.query.dataFim,            "ce.data <= ?");
  if (req.query.itemId)             add(req.query.itemId,             "ce.item_id = ?");
  if (req.query.estoqueId)          add(req.query.estoqueId,          "ce.estoque_id = ?");
  if (req.query.ccustoConsumidorId) add(req.query.ccustoConsumidorId, "ce.ccusto_consumidor_id = ?");
  if (req.query.funcionarioId)      add(req.query.funcionarioId,      "ce.funcionario_id = ?");
  const where = c.length ? "WHERE " + c.join(" AND ") : "";
  try {
    const r = await pool.query(`
      SELECT ce.data, ci.item, ces.estoque,
             COUNT(*)::int         AS "qtdeEntregue",
             cc.centro_custo       AS "ccustoConsumidor",
             f.nome                AS "funcionario",
             MAX(ce.observacao)    AS "observacao"
        FROM consumo_entrega ce
        LEFT JOIN consumo_itens    ci  ON ci.id  = ce.item_id
        LEFT JOIN consumo_estoques ces ON ces.id = ce.estoque_id
        LEFT JOIN consumo_ccusto   cc  ON cc.id  = ce.ccusto_consumidor_id
        LEFT JOIN funcionarios     f   ON f.id   = ce.funcionario_id
       ${where}
       GROUP BY ce.data, ci.item, ces.estoque, cc.centro_custo, f.nome
       ORDER BY ce.data DESC, ci.item
    `, v);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar relatório." }); }
});

// GET /manutencao (s56)
router.get("/manutencao", auth, canAccess("s56"), async (req, res) => {
  const c = [], v = [];
  const add = (val, sql) => { v.push(val); c.push(sql.replace("?", `$${v.length}`)); };
  if (req.query.dataInicio)    add(req.query.dataInicio,         "mr.data >= ?");
  if (req.query.dataFim)       add(req.query.dataFim,            "mr.data <= ?");
  if (req.query.ativoId)       add(req.query.ativoId,            "mr.ativo_id = ?");
  if (req.query.empresa)       add(`%${req.query.empresa}%`,     "c.name ILIKE ?");
  if (req.query.marca)         add(`%${req.query.marca}%`,       "a.marca ILIKE ?");
  if (req.query.modelo)        add(`%${req.query.modelo}%`,      "a.modelo ILIKE ?");
  if (req.query.serie)         add(`%${req.query.serie}%`,       "a.numero_serie ILIKE ?");
  if (req.query.imei)          add(`%${req.query.imei}%`,        "a.imei_slot1 ILIKE ?");
  if (req.query.funcionarioId) add(req.query.funcionarioId,      "mr.funcionario_id = ?");
  if (req.query.ccustoId)      add(req.query.ccustoId,           "mr.ccusto_id = ?");
  if (req.query.status)        add(req.query.status,             "mr.status = ?");
  const where = c.length ? "WHERE " + c.join(" AND ") : "";
  try {
    const r = await pool.query(`
      SELECT mr.id AS "registroId", mr.data AS "registroData",
             a.nome AS "nomeAtivo", c.name AS "empresa",
             a.marca, a.modelo,
             a.numero_serie AS "numeroSerie", a.imei_slot1 AS "imeiSlot1",
             f.nome  AS "funcionario",  cc.centro_custo AS "ccusto",
             mr.observacao AS "registroObservacao", mr.status AS "registroStatus",
             mi.id AS "itemId", mi.data AS "itemData", mi.tipo,
             s.name AS "fornecedor",
             fi.nome AS "funcionarioItem",
             mi.observacao AS "itemObservacao", mi.status AS "itemStatus"
        FROM manutencao_registros mr
        LEFT JOIN ativos         a  ON a.id  = mr.ativo_id
        LEFT JOIN companies      c  ON c.id  = a.company_id
        LEFT JOIN funcionarios   f  ON f.id  = mr.funcionario_id
        LEFT JOIN consumo_ccusto cc ON cc.id = mr.ccusto_id
        LEFT JOIN manutencao_itens mi ON mi.manutencao_id = mr.id
        LEFT JOIN suppliers      s  ON s.id  = mi.fornecedor_id
        LEFT JOIN funcionarios   fi ON fi.id = mi.funcionario_id
       ${where}
       ORDER BY mr.data DESC, mr.created_at DESC, mi.data ASC, mi.created_at ASC
    `, v);

    const map = new Map();
    for (const row of r.rows) {
      if (!map.has(row.registroId)) {
        map.set(row.registroId, {
          id: row.registroId, data: row.registroData, nomeAtivo: row.nomeAtivo,
          empresa: row.empresa, marca: row.marca, modelo: row.modelo,
          numeroSerie: row.numeroSerie, imeiSlot1: row.imeiSlot1,
          funcionario: row.funcionario, ccusto: row.ccusto,
          observacao: row.registroObservacao, status: row.registroStatus,
          itens: []
        });
      }
      if (row.itemId) {
        map.get(row.registroId).itens.push({
          id: row.itemId, data: row.itemData, tipo: row.tipo,
          fornecedor: row.fornecedor, funcionario: row.funcionarioItem,
          observacao: row.itemObservacao, status: row.itemStatus
        });
      }
    }
    res.json([...map.values()]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar relatório." }); }
});

// GET /selects — dados comuns para filtros dos relatórios
router.get("/selects", auth, async (req, res) => {
  try {
    const [itens, estoques, ccustos, funcs, ativos] = await Promise.all([
      pool.query("SELECT id, item FROM consumo_itens ORDER BY item"),
      pool.query("SELECT id, estoque FROM consumo_estoques ORDER BY estoque"),
      pool.query(`SELECT id, centro_custo AS "centroCusto" FROM consumo_ccusto ORDER BY centro_custo`),
      pool.query("SELECT id, nome FROM funcionarios ORDER BY nome"),
      pool.query("SELECT id, nome FROM ativos ORDER BY nome"),
    ]);
    res.json({
      itens: itens.rows, estoques: estoques.rows, ccustos: ccustos.rows,
      funcionarios: funcs.rows, ativos: ativos.rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar selects." }); }
});

module.exports = router;
