const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /historico-movimentacoes
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id,
              item_id          AS "itemId",
              funcionario_nome AS "funcionarioNome",
              -- M5: CPF mascarado — ROLLBACK: substituir CASE por: funcionario_cpf AS "funcionarioCpf"
              CASE WHEN funcionario_cpf IS NULL THEN NULL
                   WHEN LENGTH(funcionario_cpf) >= 5 THEN LEFT(funcionario_cpf,3) || '.***.***-' || RIGHT(funcionario_cpf,2)
                   ELSE '***' END AS "funcionarioCpf",
              tipo_movimentacao AS "tipoMovimentacao",
              usuario_nome     AS "usuarioNome",
              company_name     AS "companyName",
              tipo_ativo_name  AS "tipoAtivoName",
              ativo_nome       AS "ativoNome",
              marca, modelo,
              imei_slot1       AS "imeiSlot1",
              imei_slot2       AS "imeiSlot2",
              numero_serie     AS "numeroSerie",
              numero_linha     AS "numeroLinha",
              operadora_name   AS "operadoraName",
              iccid, acesso, estrutura,
              tipo_pacote      AS "tipoPacote",
              sistema_operacional AS "sistemaOperacional",
              versao, processador, memoria, hd, patrimonio,
              numero_documento AS "numeroDocumento",
              valor,
              TO_CHAR(data_aquisicao,'DD/MM/YYYY') AS "dataAquisicao",
              condicao, acessorios,
              status_ativo     AS "statusAtivo",
              funcionario_destino_nome AS "funcionarioDestinoNome",
              TO_CHAR(created_at,'DD/MM/YYYY HH24:MI') AS "dataHora"
         FROM historico_movimentacoes_ativos
        ORDER BY created_at DESC
        LIMIT 2000`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar histórico." }); }
});

module.exports = router;
