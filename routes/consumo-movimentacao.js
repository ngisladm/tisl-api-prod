const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET / — todas as movimentações com JOINs; suporta filtros: itemId, estoqueId, status
router.get("/", auth, canAccess("s47"), async (req, res) => {
  const { itemId, estoqueId, status } = req.query;
  const conditions = [];
  const values = [];

  if (itemId)    { values.push(itemId);    conditions.push(`cm.item_id = $${values.length}`); }
  if (estoqueId) { values.push(estoqueId); conditions.push(`cm.estoque_id = $${values.length}`); }
  if (status)    { values.push(status);    conditions.push(`cm.status = $${values.length}`); }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  try {
    const r = await pool.query(`
      SELECT
        cm.id,
        cm.data,
        ci.item,
        ce.estoque,
        cc1.centro_custo  AS "ccustoDespesa",
        cm.qtde_estoque   AS "qtdeEstoque",
        cc2.centro_custo  AS "ccustoConsumidor",
        cm.qtde_consumida AS "qtdeConsumida",
        cm.qtde_solicitada AS "qtdeSolicitada",
        cm.status,
        cm.solicitacao_id AS "solicitacaoId"
      FROM consumo_movimentacao cm
      LEFT JOIN consumo_itens    ci  ON ci.id  = cm.item_id
      LEFT JOIN consumo_estoques ce  ON ce.id  = cm.estoque_id
      LEFT JOIN consumo_ccusto   cc1 ON cc1.id = cm.ccusto_despesa_id
      LEFT JOIN consumo_ccusto   cc2 ON cc2.id = cm.ccusto_consumidor_id
      ${where}
      ORDER BY cm.data DESC, cm.created_at DESC
    `, values);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar movimentações." }); }
});

module.exports = router;
