const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET / — todas as solicitações com JOINs
router.get("/", auth, canAccess("s48"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        cs.id,
        cs.numero,
        cs.data,
        ci.item,
        cs.item_id         AS "itemId",
        ce.estoque,
        cs.estoque_id      AS "estoqueId",
        cs.qtde_solicitada AS "qtdeSolicitada",
        cs.qtde_atendida   AS "qtdeAtendida",
        cs.status
      FROM consumo_solicitacao cs
      LEFT JOIN consumo_itens    ci ON ci.id = cs.item_id
      LEFT JOIN consumo_estoques ce ON ce.id = cs.estoque_id
      ORDER BY cs.data DESC, cs.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar solicitações." }); }
});

// Lógica compartilhada de processamento (usada no POST)
async function processar(client, solicitacao) {
  const STATUS_AGUARDANDO = "Aguardando Compra";

  // Busca linhas Consumidas com Qtde Consumida=1 do mesmo Item+Estoque
  const movRes = await client.query(`
    SELECT * FROM consumo_movimentacao
     WHERE status = 'Consumido'
       AND qtde_consumida = 1
       AND item_id    = $1
       AND estoque_id = $2
     LIMIT $3
  `, [solicitacao.item_id, solicitacao.estoque_id, solicitacao.qtde_solicitada]);

  let totalInserido = 0;

  for (const identified of movRes.rows) {
    await client.query(
      `INSERT INTO consumo_movimentacao
         (data, item_id, estoque_id, ccusto_despesa_id, qtde_estoque,
          ccusto_consumidor_id, qtde_consumida, qtde_solicitada, status, solicitacao_id, numero_solicitacao)
       VALUES (CURRENT_DATE, $1, $2, $3, 0, NULL, 0, 1, $4, $5, $6)`,
      [identified.item_id, identified.estoque_id, identified.ccusto_consumidor_id, STATUS_AGUARDANDO, solicitacao.id, solicitacao.numero]
    );
    totalInserido++;
  }

  const restante = solicitacao.qtde_solicitada - totalInserido;
  if (restante > 0) {
    const estoqueRes = await client.query(
      "SELECT ccusto_estoque_id FROM consumo_estoques WHERE id=$1",
      [solicitacao.estoque_id]
    );
    const ccustoEstoqueId = estoqueRes.rows[0]?.ccusto_estoque_id || null;
    for (let i = 0; i < restante; i++) {
      await client.query(
        `INSERT INTO consumo_movimentacao
           (data, item_id, estoque_id, ccusto_despesa_id, qtde_estoque,
            ccusto_consumidor_id, qtde_consumida, qtde_solicitada, status, solicitacao_id, numero_solicitacao)
         VALUES (CURRENT_DATE, $1, $2, $3, 0, NULL, 0, 1, $4, $5, $6)`,
        [solicitacao.item_id, solicitacao.estoque_id, ccustoEstoqueId, STATUS_AGUARDANDO, solicitacao.id, solicitacao.numero]
      );
      totalInserido++;
    }
  }

  await client.query(
    "UPDATE consumo_solicitacao SET qtde_atendida=$1, status='Processado', updated_at=NOW() WHERE id=$2",
    [totalInserido, solicitacao.id]
  );
}

// POST / — insere e processa imediatamente
router.post("/", auth, canAccess("s48"), async (req, res) => {
  const { data, itemId, estoqueId, qtdeSolicitada } = req.body;
  if (!data || !itemId || !estoqueId || !qtdeSolicitada) {
    return res.status(400).json({ error: "data, itemId, estoqueId e qtdeSolicitada são obrigatórios." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query(`
      INSERT INTO consumo_solicitacao (data, item_id, estoque_id, qtde_solicitada, status)
      VALUES ($1, $2, $3, $4, 'Não Processado')
      RETURNING *
    `, [data, itemId, estoqueId, qtdeSolicitada]);

    await processar(client, r.rows[0]);

    await client.query("COMMIT");
    res.status(201).json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao criar solicitação." });
  } finally {
    client.release();
  }
});

// DELETE /:id — desfaz o processamento e exclui a solicitação
router.delete("/:id", auth, canAccess("s48"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      "SELECT id FROM consumo_solicitacao WHERE id=$1",
      [req.params.id]
    );
    if (!check.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Não encontrado." });
    }

    // Remove as movimentações criadas pelo processamento
    await client.query(
      "DELETE FROM consumo_movimentacao WHERE solicitacao_id=$1",
      [req.params.id]
    );

    await client.query("DELETE FROM consumo_solicitacao WHERE id=$1", [req.params.id]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir solicitação." });
  } finally {
    client.release();
  }
});

module.exports = router;
