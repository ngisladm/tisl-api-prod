const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
});

pool.on("connect", () => console.log("✅ Conectado ao PostgreSQL"));
pool.on("error",   (err) => console.error("❌ Erro no pool PostgreSQL:", err));

module.exports = pool;
