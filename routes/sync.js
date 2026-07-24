const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const sql     = require("mssql");

// C2: credenciais exclusivamente via variáveis de ambiente (sem fallback hardcoded)
// ROLLBACK: restaurar valores a partir do gerenciador de segredos ou .env do servidor
const mssqlConfig = {
  user:     process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server:   process.env.MSSQL_HOST,
  // MSSQL_DATABASE: deixe vazio para usar o banco padrão do usuário,
  // ou defina no .env com o nome correto (ex: CORP, TOTVS, RM, etc.)
  ...(process.env.MSSQL_DATABASE ? { database: process.env.MSSQL_DATABASE } : {}),
  port: parseInt(process.env.MSSQL_PORT || "1433"),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
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
    cc.CODCCUSTO COLLATE DATABASE_DEFAULT + ' - ' + cc.NOME COLLATE DATABASE_DEFAULT AS NOME_CENTRO_CUSTO,
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
WHERE f.CODSITUACAO <> 'D'
  AND (
        f.CODCOLIGADA <> 4
        OR NOT EXISTS (
            SELECT 1
            FROM Rm_fato_funcionarios f2
            WHERE f2.NOME COLLATE DATABASE_DEFAULT = f.NOME COLLATE DATABASE_DEFAULT
              AND f2.CODSITUACAO <> 'D'
              AND f2.CODCOLIGADA <> 4
        )
      )
`;

let syncEmAndamento = false;

const CHUNK_SIZE = 500;

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

    const str = v => (v == null ? "" : String(v)).replace(/\0/g, "").trim();

    const records = rows
      .map(row => ({
        nome:         str(row.NOME),
        cpf:          str(row.CPF)               || null,
        rg:           str(row.CARTIDENTIDADE)     || null,
        logradouro:   str(row.LOGRADOURO)         || null,
        numero:       str(row.NUMERO)             || null,
        complemento:  str(row.COMPLEMENTO)        || null,
        bairro:       str(row.BAIRRO)             || null,
        cidade:       str(row.CIDADE)             || null,
        estado:       str(row.ESTADO)             || null,
        centro_custo: str(row.NOME_CENTRO_CUSTO)  || null,
        cargo:        str(row.NOME_FUNCAO)         || null,
        matricula:    str(row.CHAPA)              || null,
        coligada:     str(row.NOME_COLIGADA)      || null,
      }))
      .filter(r => r.nome && r.matricula && r.coligada);

    // Bulk upsert em lotes
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const params = [];
      const values = chunk.map((r, idx) => {
        const b = idx * 13;
        params.push(
          r.nome, r.cpf, r.rg, r.logradouro, r.numero, r.complemento,
          r.bairro, r.cidade, r.estado, r.centro_custo, r.cargo, r.matricula, r.coligada
        );
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},'Ativo',NOW())`;
      }).join(",");

      await pool.query(
        `INSERT INTO funcionarios
           (nome,cpf,rg,logradouro,numero,complemento,bairro,cidade,estado,centro_custo,cargo,matricula,coligada,situacao,updated_at)
         VALUES ${values}
         ON CONFLICT (matricula, coligada) WHERE matricula IS NOT NULL AND coligada IS NOT NULL
         DO UPDATE SET
           nome=EXCLUDED.nome, cpf=EXCLUDED.cpf, rg=EXCLUDED.rg,
           logradouro=EXCLUDED.logradouro, numero=EXCLUDED.numero, complemento=EXCLUDED.complemento,
           bairro=EXCLUDED.bairro, cidade=EXCLUDED.cidade, estado=EXCLUDED.estado,
           centro_custo=EXCLUDED.centro_custo, cargo=EXCLUDED.cargo,
           situacao='Ativo', updated_at=NOW()`,
        params
      );
    }

    const resumo = { total: rows.length, processados: records.length, erros: 0 };
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
    const detail = err.originalError?.message || err.message;
    console.error("Erro no sync:", detail);
    res.status(500).json({ error: detail });
  }
});

// Endpoint de debug: mostra os 3 primeiros registros do SQL Server (tipos e valores)
router.get("/debug", auth, async (req, res) => {
  let conn;
  try {
    conn = await new sql.ConnectionPool(mssqlConfig).connect();
    const r = await conn.request().query(QUERY_SQL + " ORDER BY f.NOME OFFSET 0 ROWS FETCH NEXT 3 ROWS ONLY");
    const rows = r.recordset.slice(0, 3).map(row =>
      Object.fromEntries(Object.entries(row).map(([k,v]) => [k, { valor: v, tipo: typeof v }]))
    );
    res.json({ ok: true, amostra: rows });
  } catch (err) {
    const detail = err.originalError?.message || err.message;
    res.status(500).json({ ok: false, erro: detail });
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
});

// Endpoint de teste de conexão (não faz sync, só valida credenciais)
router.get("/teste", auth, async (req, res) => {
  let conn;
  try {
    conn = await new sql.ConnectionPool(mssqlConfig).connect();
    const r = await conn.request().query("SELECT @@VERSION AS versao, DB_NAME() AS banco");
    res.json({ ok: true, versao: r.recordset[0].versao, banco: r.recordset[0].banco });
  } catch (err) {
    const detail = err.originalError?.message || err.message;
    res.status(500).json({ ok: false, erro: detail, config: { server: mssqlConfig.server, user: mssqlConfig.user, database: mssqlConfig.database || "(padrão do usuário)" } });
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
});

module.exports = { router, syncFuncionarios };
