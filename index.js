require("dotenv").config();
const express    = require("express");
const cors       = require("cors");

const authRoutes         = require("./routes/auth");
const usersRoutes        = require("./routes/users");
const profilesRoutes     = require("./routes/profiles");
const companiesRoutes    = require("./routes/companies");
const screensRoutes      = require("./routes/screens");
const teamsRoutes        = require("./routes/teams");
const escalasRoutes      = require("./routes/escalas");
const extraAvulsoRoutes  = require("./routes/extra-avulso");
const vehicleTypesRoutes = require("./routes/vehicle-types");
const kmValuesRoutes     = require("./routes/km-values");
const kmRecordsRoutes    = require("./routes/km-records");
const suppliersRoutes      = require("./routes/suppliers");
const contractsRoutes      = require("./routes/contracts");
const operadorasRoutes     = require("./routes/operadoras");
const linhasFaturadasRoutes= require("./routes/linhas-faturadas");

const pool = require("./db");
const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

// Auto-migrate
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT").catch(() => {});
pool.query("INSERT INTO screens (id, name, module) VALUES ('s15','Relatório de Escala','Relatórios') ON CONFLICT DO NOTHING").catch(() => {});
pool.query("UPDATE profiles SET permissions = permissions || '{\"s15\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's15')").catch(() => {});

// Telefonia
pool.query(`CREATE TABLE IF NOT EXISTS operadoras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query(`CREATE TABLE IF NOT EXISTS linhas_faturadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operadora_id UUID REFERENCES operadoras(id),
  mes_ano VARCHAR(7) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query(`CREATE TABLE IF NOT EXISTS itens_linhas_faturadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha_faturada_id UUID REFERENCES linhas_faturadas(id) ON DELETE CASCADE,
  numero_linha VARCHAR(50),
  plano VARCHAR(200),
  consumo_linha VARCHAR(100),
  valor_linha VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query("INSERT INTO screens (id, name, module) VALUES ('s16','Operadoras','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("INSERT INTO screens (id, name, module) VALUES ('s17','Linhas Faturadas','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("UPDATE profiles SET permissions = permissions || '{\"s16\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's16')").catch(()=>{});
pool.query("UPDATE profiles SET permissions = permissions || '{\"s17\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's17')").catch(()=>{});

app.use("/auth",          authRoutes);
app.use("/users",         usersRoutes);
app.use("/profiles",      profilesRoutes);
app.use("/companies",     companiesRoutes);
app.use("/screens",       screensRoutes);
app.use("/teams",         teamsRoutes);
app.use("/escalas",       escalasRoutes);
app.use("/extra-avulso",  extraAvulsoRoutes);
app.use("/vehicle-types", vehicleTypesRoutes);
app.use("/km-values",     kmValuesRoutes);
app.use("/km-records",    kmRecordsRoutes);
app.use("/suppliers",        suppliersRoutes);
app.use("/contracts",        contractsRoutes);
app.use("/operadoras",       operadorasRoutes);
app.use("/linhas-faturadas", linhasFaturadasRoutes);

app.get("/", (req, res) => res.json({ status: "ok", app: "SL TI API" }));

app.listen(PORT, () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});
// test auto-deploy