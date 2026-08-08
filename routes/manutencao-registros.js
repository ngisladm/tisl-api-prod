const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess, canAccessExact } = require("../middleware/canAccess");

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
      ORDER BY (tipo='Solicitação de Baixa') DESC, created_at DESC LIMIT 1`,
    [manutencaoId]
  );
  await client.query(
    "UPDATE manutencao_registros SET status=$1, updated_at=NOW() WHERE id=$2",
    [r.rows[0]?.status || null, manutencaoId]
  );
}

const NEXT_TYPES = {
  "Entrada do Equipamento": ["Envio para Manutenção"],
  "Envio para Manutenção": ["Retorno de Manutenção"],
  "Retorno de Manutenção": ["Entrega do Equipamento", "Solicitação de Baixa"],
  "Entrega do Equipamento": [],
  "Solicitação de Baixa": [],
};

async function validateNextType(client, manutencaoId, tipo) {
  const parent = await client.query(
    "SELECT status FROM manutencao_registros WHERE id=$1 FOR UPDATE",
    [manutencaoId]
  );
  if (!parent.rows[0]) return "Registro de manutenção não encontrado.";
  if (["Condenado", "Entregue", "Revertido"].includes(parent.rows[0].status))
    return "Este ciclo de manutenção já foi encerrado.";

  const last = await client.query(
    `SELECT tipo FROM manutencao_itens
      WHERE manutencao_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [manutencaoId]
  );
  const allowed = last.rows[0]
    ? (NEXT_TYPES[last.rows[0].tipo] || [])
    : ["Entrada do Equipamento", "Solicitação de Baixa"];
  return allowed.includes(tipo) ? null : "Tipo inválido para a etapa atual da manutenção.";
}

async function registrarBaixaManutencao(client, manutencaoId, usuarioNome) {
  const ativo = await client.query(
    `SELECT a.id, a.status FROM manutencao_registros mr
      JOIN ativos a ON a.id=mr.ativo_id WHERE mr.id=$1 FOR UPDATE OF a`,
    [manutencaoId]
  );
  if (!ativo.rows[0]) throw new Error("Ativo da manutenção não encontrado.");
  if (ativo.rows[0].status === "Baixado") throw new Error("Este ativo já está baixado.");

  const snapshot = await client.query(
    `INSERT INTO historico_movimentacoes_ativos
       (item_id, funcionario_nome, funcionario_cpf, tipo_movimentacao, usuario_nome,
        company_name, tipo_ativo_name, ativo_nome, marca, modelo, imei_slot1, imei_slot2,
        numero_serie, numero_linha, operadora_name, iccid, acesso, estrutura, tipo_pacote,
        sistema_operacional, versao, processador, memoria, hd, patrimonio, numero_documento,
        valor, data_aquisicao, condicao, acessorios, status_ativo, ativo_id, linha_id)
     SELECT i.id,
            COALESCE(ca.nome_funcionario, f.nome), COALESCE(ca.cpf, f.cpf),
            'Baixa', $2, c.name, ta.name, a.nome,
            COALESCE(NULLIF(i.marca,''),a.marca), COALESCE(NULLIF(i.modelo,''),a.modelo),
            COALESCE(NULLIF(i.imei_slot1,''),a.imei_slot1), COALESCE(NULLIF(i.imei_slot2,''),a.imei_slot2),
            COALESCE(NULLIF(i.numero_serie,''),a.numero_serie), ld.numero_linha, o.name,
            i.iccid, i.acesso, i.estrutura, i.tipo_pacote,
            COALESCE(NULLIF(i.sistema_operacional,''),a.sistema_operacional),
            COALESCE(NULLIF(i.versao,''),a.versao), COALESCE(NULLIF(i.processador,''),a.processador),
            COALESCE(NULLIF(i.memoria,''),a.memoria), COALESCE(NULLIF(i.hd,''),a.hd),
            COALESCE(NULLIF(i.patrimonio,''),a.patrimonio),
            COALESCE(NULLIF(i.numero_documento,''),a.numero_documento),
            COALESCE(i.valor,a.valor), COALESCE(i.data_aquisicao,a.data_aquisicao),
            COALESCE(NULLIF(i.condicao,''),a.condicao), COALESCE(NULLIF(i.acessorios,''),a.acessorios),
            COALESCE(NULLIF(i.status_ativo,''),a.status), a.id, i.linha_id
       FROM manutencao_registros mr
       JOIN ativos a ON a.id=mr.ativo_id
       LEFT JOIN companies c ON c.id=a.company_id
       LEFT JOIN tipo_ativos ta ON ta.id=a.tipo_ativo_id
       LEFT JOIN funcionarios f ON f.id=mr.funcionario_id
       LEFT JOIN LATERAL (
         SELECT ici.* FROM itens_controle_ativos ici
          WHERE ici.ativo_id=a.id ORDER BY ici.created_at DESC LIMIT 1
       ) i ON TRUE
       LEFT JOIN controle_ativos ca ON ca.id=i.controle_ativo_id
       LEFT JOIN linhas_disponiveis ld ON ld.id=i.linha_id
       LEFT JOIN operadoras o ON o.id=i.operadora_id
      WHERE mr.id=$1
     RETURNING ativo_id AS "ativoId"`,
    [manutencaoId, usuarioNome || "Sistema"]
  );
  if (!snapshot.rows[0]) throw new Error("Ativo da manutenção não encontrado.");
  const ativoId = snapshot.rows[0].ativoId;
  await client.query("UPDATE ativos SET status='Baixado', updated_at=NOW() WHERE id=$1", [ativoId]);
  await client.query("DELETE FROM itens_controle_ativos WHERE ativo_id=$1", [ativoId]);
}

// GET /selects — dados para os dropdowns (deve vir antes de /:id)
router.get("/selects", auth, canAccess("s51"), async (req, res) => {
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
         WHERE COALESCE(a.status,'Em Estoque') <> 'Baixado'
           AND NOT EXISTS (
           SELECT 1 FROM manutencao_registros mr
            WHERE mr.ativo_id = a.id
              AND (mr.status IS NULL OR mr.status NOT IN ('Entregue','Revertido'))
         )
         ORDER BY a.nome
      `),
      pool.query("SELECT id, nome FROM funcionarios ORDER BY nome"),
      pool.query(`SELECT id, centro_custo AS "centroCusto", descricao FROM consumo_ccusto ORDER BY centro_custo`),
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
             cc.descricao    AS "descricaoCcusto",
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
router.post("/", auth, canAccessExact("s51", "insert"), async (req, res) => {
  const { data, ativoId, funcionarioId, ccustoId, observacao } = req.body;
  if (!data || !ativoId) return res.status(400).json({ error: "Data e Ativo são obrigatórios." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ativo = await client.query("SELECT status FROM ativos WHERE id=$1 FOR UPDATE", [ativoId]);
    if (!ativo.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Ativo não encontrado." }); }
    if (ativo.rows[0].status === "Baixado") { await client.query("ROLLBACK"); return res.status(400).json({ error: "Ativos baixados não podem iniciar uma manutenção." }); }
    const open = await client.query(
      `SELECT 1 FROM manutencao_registros
        WHERE ativo_id=$1 AND (status IS NULL OR status NOT IN ('Entregue','Revertido')) LIMIT 1`,
      [ativoId]
    );
    if (open.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Este ativo já possui um ciclo de manutenção em aberto." }); }
    const r = await client.query(
      `INSERT INTO manutencao_registros (data, ativo_id, funcionario_id, ccusto_id, observacao)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [data, ativoId, funcionarioId || null, ccustoId || null, observacao || null]
    );
    await client.query("COMMIT");
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err); res.status(500).json({ error: "Erro ao criar registro." });
  } finally { client.release(); }
});

// PUT /itens/:id — deve vir antes de PUT /:id
router.put("/itens/:id", auth, canAccessExact("s51", "edit"), async (req, res) => {
  const { data, tipo, fornecedorId, funcionarioId, observacao } = req.body;
  if (!data || !tipo) return res.status(400).json({ error: "Data e Tipo são obrigatórios." });
  const status = TIPO_STATUS[tipo] || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT tipo FROM manutencao_itens WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Não encontrado." }); }
    if (current.rows[0].tipo === "Solicitação de Baixa") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uma Solicitação de Baixa não pode ser editada." });
    }
    if (current.rows[0].tipo !== tipo) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "O tipo de um registro já lançado não pode ser alterado." });
    }
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
router.put("/:id", auth, canAccessExact("s51", "edit"), async (req, res) => {
  const { data, ativoId, funcionarioId, ccustoId, observacao } = req.body;
  if (!data || !ativoId) return res.status(400).json({ error: "Data e Ativo são obrigatórios." });
  try {
    const current = await pool.query("SELECT status FROM manutencao_registros WHERE id=$1", [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    if (["Condenado", "Revertido"].includes(current.rows[0].status))
      return res.status(400).json({ error: "Um ciclo condenado ou revertido não pode ser editado." });
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
router.delete("/itens/:id", auth, canAccessExact("s51", "delete"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT tipo FROM manutencao_itens WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Não encontrado." }); }
    if (current.rows[0].tipo === "Solicitação de Baixa") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Uma Solicitação de Baixa não pode ser excluída. Utilize Reverter Baixa na tela Ativos." });
    }
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
router.delete("/:id", auth, canAccessExact("s51", "delete"), async (req, res) => {
  try {
    const current = await pool.query("SELECT status FROM manutencao_registros WHERE id=$1", [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    if (["Condenado", "Revertido"].includes(current.rows[0].status))
      return res.status(400).json({ error: "Um ciclo condenado ou revertido não pode ser excluído." });
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
router.post("/:id/itens", auth, canAccessExact("s51", "insert"), async (req, res) => {
  const { data, tipo, fornecedorId, funcionarioId, observacao } = req.body;
  if (!data || !tipo) return res.status(400).json({ error: "Data e Tipo são obrigatórios." });
  const status = TIPO_STATUS[tipo] || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sequenceError = await validateNextType(client, req.params.id, tipo);
    if (sequenceError) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: sequenceError });
    }
    const r = await client.query(
      `INSERT INTO manutencao_itens
         (manutencao_id, data, tipo, fornecedor_id, funcionario_id, observacao, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.params.id, data, tipo, fornecedorId || null, funcionarioId || null, observacao || null, status]
    );
    if (tipo === "Solicitação de Baixa") {
      await registrarBaixaManutencao(client, req.params.id, req.user?.name || "Sistema");
    }
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
