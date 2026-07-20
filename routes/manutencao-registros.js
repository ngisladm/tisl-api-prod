const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const TIPO_STATUS = {
  "Entrada do Equipamento": "Aguardando",
  "Envio para Manutenção":  "Enviado",
  "Retorno de Manutenção":  "Disponível",
  "Entrega do Equipamento": "Entregue",
  "Solicitação de Baixa":   "Condenado",
};

async function syncStatus(client, manutencaoId) {
  const r = await client.query(
    `SELECT status FROM manutencao_itens
      WHERE manutencao_id=$1
      ORDER BY data DESC, created_at DESC LIMIT 1`,
    [manutencaoId]
  );
  await client.query(
    "UPDATE manutencao_registros SET status=$1, updated_at=NOW() WHERE id=$2",
    [r.rows[0]?.status || null, manutencaoId]
  );
}

// GET /selects — dados para os dropdowns (deve vir antes de /:id)
router.get("/selects", auth, async (req, res) => {
  try {
    const [ativosRes, funcRes, ccustoRes, fornecRes] = await Promise.all([
      pool.query(`
        SELECT a.id,
               a.nome || COALESCE(' | ' || a.marca, '') ||
               COALESCE(' | ' || a.modelo, '') ||
               COALESCE(' | ' || a.numero_serie, '') ||
               COALESCE(' | ' || a.imei_slot1, '') AS label,
               a.marca, a.modelo,
               a.numero_serie AS "numeroSerie",
               a.imei_slot1   AS "imeiSlot1",
               c.name         AS "empresa",
               ca.funcionario_id AS "funcionarioId",
               f.nome            AS "funcionarioNome"
          FROM ativos a
          LEFT JOIN companies c ON c.id = a.company_id
          LEFT JOIN (
            SELECT DISTINCT ON (ica.ativo_id) ica.ativo_id, ca2.funcionario_id
              FROM itens_controle_ativos ica
              JOIN controle_ativos ca2 ON ca2.id = ica.controle_ativo_id
             WHERE ca2.funcionario_id IS NOT NULL
             ORDER BY ica.ativo_id, ica.created_at DESC
          ) ca ON ca.ativo_id = a.id
          LEFT JOIN funcionarios f ON f.id = ca.funcionario_id
         WHERE NOT EXISTS (
           SELECT 1 FROM manutencao_registros mr
            WHERE mr.ativo_id = a.id
              AND (mr.status IS NULL OR mr.status <> 'Entregue')
         )
         ORDER BY a.nome
      `),
      pool.query("SELECT id, nome FROM funcionarios ORDER BY nome"),
      pool.query(`SELECT id, centro_custo AS "centroCusto" FROM consumo_ccusto ORDER BY centro_custo`),
      pool.query("SELECT id, name FROM suppliers ORDER BY name"),
    ]);
    res.json({
      ativos:       ativosRes.rows,
      funcionarios: funcRes.rows,
      ccustos:      ccustoRes.rows,
      fornecedores: fornecRes.rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar selects." }); }
});

// GET / — todos os registros de manutenção
router.get("/", auth, canAccess("s51"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT mr.id, mr.data,
             a.nome          AS "nomeAtivo", mr.ativo_id       AS "ativoId",
             c.name          AS "empresa",
             a.marca, a.modelo,
             a.numero_serie  AS "numeroSerie",
             a.imei_slot1    AS "imeiSlot1",
             f.nome          AS "funcionario",  mr.funcionario_id AS "funcionarioId",
             cc.centro_custo AS "ccusto",        mr.ccusto_id      AS "ccustoId",
             mr.observacao, mr.status
        FROM manutencao_registros mr
        LEFT JOIN ativos         a  ON a.id  = mr.ativo_id
        LEFT JOIN companies      c  ON c.id  = a.company_id
        LEFT JOIN funcionarios   f  ON f.id  = mr.funcionario_id
        LEFT JOIN consumo_ccusto cc ON cc.id = mr.ccusto_id
       ORDER BY mr.data DESC, mr.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar registros." }); }
});

// POST /
router.post("/", auth, canAccess("s51"), async (req, res) => {
  const { data, ativoId, funcionarioId, ccustoId, observacao } = req.body;
  if (!data || !ativoId) return res.status(400).json({ error: "Data e Ativo são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO manutencao_registros (data, ativo_id, funcionario_id, ccusto_id, observacao)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [data, ativoId, funcionarioId || null, ccustoId || null, observacao || null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar registro." }); }
});

// PUT /itens/:id — deve vir antes de PUT /:id
router.put("/itens/:id", auth, canAccess("s51"), async (req, res) => {
  const { data, tipo, fornecedorId, funcionarioId, observacao } = req.body;
  if (!data || !tipo) return res.status(400).json({ error: "Data e Tipo são obrigatórios." });
  const status = TIPO_STATUS[tipo] || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE manutencao_itens
          SET data=$1, tipo=$2, fornecedor_id=$3, funcionario_id=$4,
              observacao=$5, status=$6, updated_at=NOW()
        WHERE id=$7 RETURNING manutencao_id`,
      [data, tipo, fornecedorId || null, funcionarioId || null, observacao || null, status, req.params.id]
    );
    if (!r.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Não encontrado." }); }
    await syncStatus(client, r.rows[0].manutencao_id);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err); res.status(500).json({ error: "Erro ao atualizar item." });
  } finally { client.release(); }
});

// PUT /:id
router.put("/:id", auth, canAccess("s51"), async (req, res) => {
  const { data, ativoId, funcionarioId, ccustoId, observacao } = req.body;
  if (!data || !ativoId) return res.status(400).json({ error: "Data e Ativo são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE manutencao_registros
          SET data=$1, ativo_id=$2, funcionario_id=$3, ccusto_id=$4, observacao=$5, updated_at=NOW()
        WHERE id=$6 RETURNING id`,
      [data, ativoId, funcionarioId || null, ccustoId || null, observacao || null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar registro." }); }
});

// DELETE /itens/:id — deve vir antes de DELETE /:id
router.delete("/itens/:id", auth, canAccess("s51"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "DELETE FROM manutencao_itens WHERE id=$1 RETURNING manutencao_id",
      [req.params.id]
    );
    if (!r.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Não encontrado." }); }
    await syncStatus(client, r.rows[0].manutencao_id);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err); res.status(500).json({ error: "Erro ao excluir item." });
  } finally { client.release(); }
});

// DELETE /:id
router.delete("/:id", auth, canAccess("s51"), async (req, res) => {
  try {
    await pool.query("DELETE FROM manutencao_registros WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir registro." }); }
});

// GET /:id/itens
router.get("/:id/itens", auth, canAccess("s51"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT mi.id, mi.data, mi.tipo,
             s.name AS "fornecedor", mi.fornecedor_id AS "fornecedorId",
             f.nome AS "funcionario", mi.funcionario_id AS "funcionarioId",
             mi.observacao, mi.status
        FROM manutencao_itens mi
        LEFT JOIN suppliers    s ON s.id = mi.fornecedor_id
        LEFT JOIN funcionarios f ON f.id = mi.funcionario_id
       WHERE mi.manutencao_id=$1
       ORDER BY mi.data ASC, mi.created_at ASC
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// POST /:id/itens
router.post("/:id/itens", auth, canAccess("s51"), async (req, res) => {
  const { data, tipo, fornecedorId, funcionarioId, observacao } = req.body;
  if (!data || !tipo) return res.status(400).json({ error: "Data e Tipo são obrigatórios." });
  const status = TIPO_STATUS[tipo] || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO manutencao_itens
         (manutencao_id, data, tipo, fornecedor_id, funcionario_id, observacao, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.params.id, data, tipo, fornecedorId || null, funcionarioId || null, observacao || null, status]
    );
    await syncStatus(client, req.params.id);
    await client.query("COMMIT");
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[manutencao-itens POST]", err.message);
    res.status(500).json({ error: err.message || "Erro ao criar item." });
  } finally { client.release(); }
});

module.exports = router;
