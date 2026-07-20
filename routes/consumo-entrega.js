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
        cc.centro_custo       AS "ccustoConsumidor",
        cc.descricao          AS "descricaoCcusto",
        f.nome                AS "funcionario",
        ce.funcionario_id     AS "funcionarioId",
        ce.observacao,
        ce.movimentacao_id    AS "movimentacaoId"
      FROM consumo_entrega ce
      LEFT JOIN consumo_itens    ci  ON ci.id  = ce.item_id
      LEFT JOIN consumo_estoques ces ON ces.id = ce.estoque_id
      LEFT JOIN consumo_ccusto   cc  ON cc.id  = ce.ccusto_consumidor_id
      LEFT JOIN funcionarios     f   ON f.id   = ce.funcionario_id
      ORDER BY ce.data DESC, ce.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar entregas." }); }
});

// GET /disponiveis-agrupados — agrupa movimentações (qtde_estoque=1) por Item+Estoque
router.get("/disponiveis-agrupados", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT cm.item_id    AS "itemId",
             ci.item,
             cm.estoque_id AS "estoqueId",
             ce.estoque,
             COUNT(*)::int  AS "qtdeEstoque"
        FROM consumo_movimentacao cm
        LEFT JOIN consumo_itens    ci ON ci.id = cm.item_id
        LEFT JOIN consumo_estoques ce ON ce.id = cm.estoque_id
       WHERE cm.qtde_estoque = 1
       GROUP BY cm.item_id, ci.item, cm.estoque_id, ce.estoque
       ORDER BY ci.item, ce.estoque
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar disponíveis." }); }
});

// POST / — registra entregas conforme qtde indicada por item+estoque
router.post("/", auth, canAccess("s49"), async (req, res) => {
  const { itens } = req.body;
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "Informe ao menos um item com Qtde Entregue." });
  }
  const linhasValidas = itens.filter(l => l.qtdeEntregue > 0);
  if (linhasValidas.length === 0) {
    return res.status(400).json({ error: "Informe a Qtde Entregue em ao menos um item." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const linha of linhasValidas) {
      if (!linha.data || !linha.ccustoConsumidorId) continue;
      const movRes = await client.query(
        `SELECT id, item_id, estoque_id FROM consumo_movimentacao
          WHERE item_id=$1 AND estoque_id=$2 AND qtde_estoque=1
          ORDER BY created_at
          LIMIT $3`,
        [linha.itemId, linha.estoqueId, linha.qtdeEntregue]
      );
      for (const mov of movRes.rows) {
        await client.query(
          `INSERT INTO consumo_entrega
             (data, movimentacao_id, item_id, estoque_id, ccusto_consumidor_id, funcionario_id, observacao)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [linha.data, mov.id, mov.item_id, mov.estoque_id, linha.ccustoConsumidorId, linha.funcionarioId || null, linha.observacao || null]
        );
        await client.query(
          `UPDATE consumo_movimentacao
              SET qtde_estoque=0, qtde_consumida=1, ccusto_consumidor_id=$1, status='Consumido', updated_at=NOW()
            WHERE id=$2`,
          [linha.ccustoConsumidorId, mov.id]
        );
      }
    }
    await client.query("COMMIT");
    res.status(201).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao registrar entregas." });
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
