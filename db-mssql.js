const sql = require("mssql");
require("dotenv").config();

const config = {
  user:     process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server:   process.env.MSSQL_HOST,
  port:     parseInt(process.env.MSSQL_PORT) || 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 10000,
  requestTimeout:    15000,
};

let pool = null;

async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}

module.exports = { getPool, sql };
