const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET / — todas as entregas com JOINs
router.get("/", auth, canAccess("s49"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        ce.id,
        ce.data,
        ci.item,
        ces.estoque,
        cc.centro_custo   AS "ccustoConsumidor",
        ce.observacao,
        ce.movimentacao_id AS "movimentacaoId"
      FROM consumo_entrega ce
      LEFT JOIN consumo_itens    ci  ON ci.id  = ce.item_id
      LEFT JOIN consumo_estoques ces ON ces.id = ce.estoque_id
      LEFT JOIN consumo_ccusto   cc  ON cc.id  = ce.ccusto_consumidor_id
      ORDER BY ce.data DESC, ce.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar entregas." }); }
});

// GET /disponiveis — itens disponíveis para entrega (qtde_estoque=1), sem canAccess
router.get("/disponiveis", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        cm.id,
        ci.item,
        ce.estoque,
        CONCAT(ci.item, ' — ', ce.estoque) AS label
      FROM consumo_movimentacao cm
      LEFT JOIN consumo_itens    ci ON ci.id = cm.item_id
      LEFT JOIN consumo_estoques ce ON ce.id = cm.estoque_id
      WHERE cm.qtde_estoque = 1
      ORDER BY ci.item, ce.estoque
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens disponíveis." }); }
});

// POST / — registra entrega e atualiza movimentação
router.post("/", auth, canAccess("s49"), async (req, res) => {
  const { data, movimentacaoId, ccustoConsumidorId, observacao } = req.body;
  if (!data || !movimentacaoId || !ccustoConsumidorId) {
    return res.status(400).json({ error: "data, movimentacaoId e ccustoConsumidorId são obrigatórios." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Busca item_id e estoque_id da movimentação
    const movRes = await client.query("SELECT item_id, estoque_id FROM consumo_movimentacao WHERE id=$1", [movimentacaoId]);
    if (!movRes.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Movimentação não encontrada." }); }
    const { item_id, estoque_id } = movRes.rows[0];

    // 1. Insere a entrega
    const r = await client.query(`
      INSERT INTO consumo_entrega
        (data, movimentacao_id, item_id, estoque_id, ccusto_consumidor_id, observacao)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [data, movimentacaoId, item_id, estoque_id, ccustoConsumidorId, observacao || null]);

    // 2. Atualiza a movimentação
    await client.query(`
      UPDATE consumo_movimentacao
         SET qtde_estoque=0, qtde_consumida=1, ccusto_consumidor_id=$1, status='Consumido', updated_at=NOW()
       WHERE id=$2
    `, [ccustoConsumidorId, movimentacaoId]);

    await client.query("COMMIT");
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao registrar entrega." });
  } finally {
    client.release();
  }
});

// DELETE /:id — exclui entrega e reverte movimentação
router.delete("/:id", auth, canAccess("s49"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Carrega a entrega para saber o movimentacao_id
    const entRes = await client.query(
      "SELECT * FROM consumo_entrega WHERE id=$1",
      [req.params.id]
    );
    if (!entRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Não encontrado." });
    }
    const entrega = entRes.rows[0];

    // Exclui a entrega
    await client.query("DELETE FROM consumo_entrega WHERE id=$1", [req.params.id]);

    // Reverte a movimentação
    await client.query(`
      UPDATE consumo_movimentacao
         SET qtde_estoque=1, qtde_consumida=0, ccusto_consumidor_id=NULL, updated_at=NOW()
       WHERE id=$1
    `, [entrega.movimentacao_id]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir entrega." });
  } finally {
    client.release();
  }
});

module.exports = router;
