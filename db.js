const { Pool } = require("pg");
require("dotenv").config();

// DB_SSL=false  → sem SSL (padrão Docker interno)
// DB_SSL=true   → SSL com certificado autoassinado aceito (C4)
const sslConfig = process.env.DB_SSL === "true"
  ? { rejectUnauthorized: false }
  : false;

const poolConfig = {
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pool = process.env.DATABASE_URL
  ? new Pool({
      ...poolConfig,
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
    })
  : new Pool({
      ...poolConfig,
      host:     process.env.DB_HOST,
      port:     process.env.DB_PORT,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS,
    });

pool.on("connect", () => console.log("✅ Conectado ao PostgreSQL"));
pool.on("error",   (err) => console.error("❌ Erro:", err));

module.exports = pool;
