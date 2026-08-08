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
const syncEnabled = () => process.env.SYNC_FUNCIONARIOS_ENABLED === "true";

const cleanText = value => (value == null ? "" : String(value))
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\0/g, "")
  .normalize("NFKC")
  .replace(/\s+/g, " ")
  .trim();

const normalizeMatricula = value => {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) return cleaned.replace(/^0+(?=\d)/, "");
  return cleaned.toUpperCase();
};

const normalizeColigada = value => {
  const cleaned = cleanText(value);
  return cleaned ? cleaned.toUpperCase() : null;
};

const decodeBase64Text = value => {
  const encoded = cleanText(value).replace(/\s/g, "");
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const bytes = Buffer.from(encoded, "base64");
    const decoded = bytes.toString("utf8").normalize("NFC").trim();
    if (!decoded || decoded.includes("�")) return null;
    const printable = [...decoded].filter(ch => !/[\u0000-\u001F\u007F]/.test(ch)).length;
    if (printable / decoded.length < 0.95) return null;
    if (bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
    return decoded;
  } catch {
    return null;
  }
};

const normalizeCentroCusto = value => {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const separator = cleaned.indexOf(" - ");
  if (separator < 0) return cleaned.normalize("NFC");
  const code = cleaned.slice(0, separator).trim();
  const description = cleaned.slice(separator + 3).trim();
  const decoded = decodeBase64Text(description);
  return `${code} - ${decoded || description}`.normalize("NFC");
};

async function syncFuncionarios() {
  if (!syncEnabled()) {
    return { desabilitado: true, motivo: "Sincronização de funcionários desabilitada para manutenção." };
  }
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

    const records = rows
      .map(row => ({
        nome:                  cleanText(row.NOME),
        cpf:                   cleanText(row.CPF)               || null,
        rg:                    cleanText(row.CARTIDENTIDADE)     || null,
        logradouro:            cleanText(row.LOGRADOURO)         || null,
        numero:                cleanText(row.NUMERO)             || null,
        complemento:           cleanText(row.COMPLEMENTO)        || null,
        bairro:                cleanText(row.BAIRRO)              || null,
        cidade:                cleanText(row.CIDADE)              || null,
        estado:                cleanText(row.ESTADO)              || null,
        centro_custo:          normalizeCentroCusto(row.NOME_CENTRO_CUSTO),
        cargo:                 cleanText(row.NOME_FUNCAO)         || null,
        matricula:             cleanText(row.CHAPA)               || null,
        coligada:              cleanText(row.NOME_COLIGADA)       || null,
        matricula_normalizada: normalizeMatricula(row.CHAPA),
        coligada_normalizada:  normalizeColigada(row.NOME_COLIGADA),
      }))
      .filter(r => r.nome && r.matricula_normalizada && r.coligada_normalizada);

    // Deduplica pela chave canônica (mantém o último registro de cada par).
    const deduped = Object.values(
      records.reduce((acc, r) => {
        acc[`${r.matricula_normalizada}||${r.coligada_normalizada}`] = r;
        return acc;
      }, {})
    );

    // Bulk upsert em lotes
    let inseridos = 0;
    let atualizados = 0;
    for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
      const chunk = deduped.slice(i, i + CHUNK_SIZE);
      const params = [];
      const values = chunk.map((r, idx) => {
        const b = idx * 15;
        params.push(
          r.nome, r.cpf, r.rg, r.logradouro, r.numero, r.complemento,
          r.bairro, r.cidade, r.estado, r.centro_custo, r.cargo, r.matricula, r.coligada,
          r.matricula_normalizada, r.coligada_normalizada
        );
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},'Ativo',NOW())`;
      }).join(",");

      const saved = await pool.query(
        `INSERT INTO funcionarios
           (nome,cpf,rg,logradouro,numero,complemento,bairro,cidade,estado,centro_custo,cargo,
            matricula,coligada,matricula_normalizada,coligada_normalizada,situacao,updated_at)
         VALUES ${values}
         ON CONFLICT (matricula_normalizada, coligada_normalizada)
           WHERE matricula_normalizada IS NOT NULL AND coligada_normalizada IS NOT NULL
         DO UPDATE SET
           nome=EXCLUDED.nome, cpf=EXCLUDED.cpf, rg=EXCLUDED.rg,
           logradouro=EXCLUDED.logradouro, numero=EXCLUDED.numero, complemento=EXCLUDED.complemento,
           bairro=EXCLUDED.bairro, cidade=EXCLUDED.cidade, estado=EXCLUDED.estado,
           centro_custo=EXCLUDED.centro_custo, cargo=EXCLUDED.cargo,
           matricula=EXCLUDED.matricula, coligada=EXCLUDED.coligada,
           situacao='Ativo', updated_at=NOW()
         RETURNING (xmax=0) AS inserted`,
        params
      );
      inseridos += saved.rows.filter(row => row.inserted).length;
      atualizados += saved.rows.filter(row => !row.inserted).length;
    }

    const resumo = { total: rows.length, processados: deduped.length, inseridos, atualizados, erros: 0 };
    console.log(`✅ Sync concluído:`, resumo);
    return resumo;
  } finally {
    syncEmAndamento = false;
    if (conn) await conn.close().catch(() => {});
  }
}

// Endpoint para disparo manual (requer autenticação)
router.post("/funcionarios", auth, async (req, res) => {
  if (!syncEnabled()) {
    return res.status(503).json({ error: "Sincronização de funcionários temporariamente desabilitada para manutenção." });
  }
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

module.exports = {
  router,
  syncFuncionarios,
  normalizeMatricula,
  normalizeColigada,
  normalizeCentroCusto,
};
