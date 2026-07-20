const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET / — todos os recebimentos com JOINs
router.get("/", auth, canAccess("s50"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT cr.id, cr.data,
             ci.item,    cr.item_id        AS "itemId",
             ce.estoque, cr.estoque_id     AS "estoqueId",
                         cr.movimentacao_id AS "movimentacaoId"
        FROM consumo_recebimento cr
        LEFT JOIN consumo_itens    ci ON ci.id = cr.item_id
        LEFT JOIN consumo_estoques ce ON ce.id = cr.estoque_id
       ORDER BY cr.data DESC, cr.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar recebimentos." }); }
});

// GET /disponiveis-agrupados — agrupa movimentações (qtde_solicitada=1) por Item+Estoque
router.get("/disponiveis-agrupados", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT cm.item_id    AS "itemId",
             ci.item,
             cm.estoque_id AS "estoqueId",
             ce.estoque,
             COUNT(*)::int  AS "qtdeSolicitada"
        FROM consumo_movimentacao cm
        LEFT JOIN consumo_itens    ci ON ci.id = cm.item_id
        LEFT JOIN consumo_estoques ce ON ce.id = cm.estoque_id
       WHERE cm.qtde_solicitada = 1
       GROUP BY cm.item_id, ci.item, cm.estoque_id, ce.estoque
       ORDER BY ci.item, ce.estoque
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar disponíveis." }); }
});

// POST / — insere recebimentos conforme qtde indicada por item+estoque
router.post("/", auth, canAccess("s50"), async (req, res) => {
  const { itens } = req.body;
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: "Informe ao menos um item com Qtde Recebida." });
  }
  const linhasValidas = itens.filter(l => l.qtdeRecebida > 0);
  if (linhasValidas.length === 0) {
    return res.status(400).json({ error: "Informe a Qtde Recebida em ao menos um item." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const linha of linhasValidas) {
      const movRes = await client.query(
        `SELECT id, item_id, estoque_id FROM consumo_movimentacao
          WHERE item_id=$1 AND estoque_id=$2 AND qtde_solicitada=1
          ORDER BY created_at
          LIMIT $3`,
        [linha.itemId, linha.estoqueId, linha.qtdeRecebida]
      );
      for (const mov of movRes.rows) {
        await client.query(
          `INSERT INTO consumo_recebimento (data, movimentacao_id, item_id, estoque_id)
           VALUES (CURRENT_DATE, $1, $2, $3)`,
          [mov.id, mov.item_id, mov.estoque_id]
        );
        await client.query(
          `UPDATE consumo_movimentacao
              SET qtde_solicitada=0, qtde_estoque=1, status='Em Estoque', updated_at=NOW()
            WHERE id=$1`,
          [mov.id]
        );
      }
    }
    await client.query("COMMIT");
    res.status(201).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao registrar recebimento." });
  } finally {
    client.release();
  }
});

// DELETE /:id — remove recebimento e reverte movimentação
router.delete("/:id", auth, canAccess("s50"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT movimentacao_id FROM consumo_recebimento WHERE id=$1",
      [req.params.id]
    );
    if (!r.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Não encontrado." });
    }
    const movId = r.rows[0].movimentacao_id;
    await client.query("DELETE FROM consumo_recebimento WHERE id=$1", [req.params.id]);
    if (movId) {
      await client.query(
        `UPDATE consumo_movimentacao
            SET qtde_solicitada=1, qtde_estoque=0, status='Aguardando Compra', updated_at=NOW()
          WHERE id=$1`,
        [movId]
      );
    }
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir recebimento." });
  } finally {
    client.release();
  }
});

module.exports = router;
