const { Pool } = require("pg");
require("dotenv").config();

// DB_SSL=false  → sem SSL (conexão interna Docker)
// DB_SSL=true   → SSL sem verificar certificado (Render, cloud)
const useSsl = process.env.DB_SSL !== "false";

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host:     process.env.DB_HOST,
      port:     process.env.DB_PORT,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS,
    });

pool.on("connect", () => console.log("✅ Conectado ao PostgreSQL"));
pool.on("error",   (err) => console.error("❌ Erro:", err));

module.exports = pool;
