const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const sql     = require("mssql");

const mssqlConfig = {
  user:     process.env.MSSQL_USER     || "usr_dados",
  password: process.env.MSSQL_PASSWORD || "zzzzzz",
  server:   process.env.MSSQL_HOST     || "172.22.0.16",
  database: process.env.MSSQL_DATABASE || "RM",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

const QUERY_SQL = `
SELECT DISTINCT
    f.NOME,
    f.CHAPA,
    f.CPF,
    f.CARTIDENTIDADE,
    f.LOGRADOURO,
    f.NUMERO,
    f.COMPLEMENTO,
    f.BAIRRO,
    f.CIDADE,
    f.ESTADO,
    f.CEP,
    cc.CODCCUSTO + ' - ' + cc.NOME AS NOME_CENTRO_CUSTO,
    fc.NOME AS NOME_FUNCAO,
    c.NOME AS NOME_COLIGADA
FROM Rm_fato_funcionarios f
INNER JOIN Rm_dim_Coligadas c
    ON f.CODCOLIGADA = c.CODCOLIGADA
INNER JOIN Rm_dim_Funcoes fc
    ON f.CODFUNCAO = fc.CODIGO
   AND f.CODCOLIGADA = fc.CODCOLIGADA
INNER JOIN Rm_dim_ccusto cc
    ON f.NROCENCUSTOCONT = cc.CODCCUSTO
   AND f.CODCOLIGADA = cc.CODCOLIGADA
WHERE f.CODSITUACAO = 'A'
  AND (
        f.CODCOLIGADA <> 4
        OR NOT EXISTS (
            SELECT 1
            FROM Rm_fato_funcionarios f2
            WHERE f2.NOME = f.NOME
              AND f2.CODSITUACAO = 'A'
              AND f2.CODCOLIGADA <> 4
        )
      )
`;

let syncEmAndamento = false;

async function syncFuncionarios() {
  if (syncEmAndamento) {
    console.log("⚠️  Sync já em andamento, ignorando chamada duplicada.");
    return { ignorado: true };
  }
  syncEmAndamento = true;
  let conn;
  try {
    console.log("🔄 Iniciando sync de funcionários...");
    conn = await new sql.ConnectionPool(mssqlConfig).connect();
    const result = await conn.request().query(QUERY_SQL);
    const rows = result.recordset;
    console.log(`📋 ${rows.length} registro(s) recebido(s) do SQL Server.`);

    let inseridos = 0, atualizados = 0, erros = 0;

    for (const row of rows) {
      try {
        const nome      = (row.NOME          || "").trim();
        const matricula = (row.CHAPA         || "").trim() || null;
        const coligada  = (row.NOME_COLIGADA || "").trim() || null;
        if (!nome) continue;

        const params = [
          nome,
          (row.CPF            || "").trim() || null,
          (row.CARTIDENTIDADE || "").trim() || null,
          (row.LOGRADOURO     || "").trim() || null,
          (row.NUMERO         || "").trim() || null,
          (row.COMPLEMENTO    || "").trim() || null,
          (row.BAIRRO         || "").trim() || null,
          (row.CIDADE         || "").trim() || null,
          (row.ESTADO         || "").trim() || null,
          (row.CEP            || "").trim() || null,
          (row.NOME_CENTRO_CUSTO || "").trim() || null,
          (row.NOME_FUNCAO       || "").trim() || null,
          matricula,
          coligada,
        ];

        // Tenta localizar pelo par matricula+coligada
        const check = await pool.query(
          "SELECT id FROM funcionarios WHERE matricula=$1 AND coligada=$2",
          [matricula, coligada]
        );

        if (check.rows.length > 0) {
          await pool.query(
            `UPDATE funcionarios SET
               nome=$1, cpf=$2, rg=$3,
               logradouro=$4, numero=$5, complemento=$6,
               bairro=$7, cidade=$8, estado=$9, cep=$10,
               centro_custo=$11, cargo=$12,
               matricula=$13, coligada=$14,
               situacao='Ativo', updated_at=NOW()
             WHERE id=$15`,
            [...params, check.rows[0].id]
          );
          atualizados++;
        } else {
          await pool.query(
            `INSERT INTO funcionarios
               (nome, cpf, rg, logradouro, numero, complemento,
                bairro, cidade, estado, cep, centro_custo, cargo,
                matricula, coligada, situacao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Ativo')`,
            params
          );
          inseridos++;
        }
      } catch (rowErr) {
        console.error("Erro ao processar linha:", row.NOME, rowErr.message);
        erros++;
      }
    }

    const resumo = { total: rows.length, inseridos, atualizados, erros };
    console.log(`✅ Sync concluído:`, resumo);
    return resumo;
  } finally {
    syncEmAndamento = false;
    if (conn) await conn.close().catch(() => {});
  }
}

// Endpoint para disparo manual (requer autenticação)
router.post("/funcionarios", auth, async (req, res) => {
  try {
    const result = await syncFuncionarios();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Erro no sync:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, syncFuncionarios };
