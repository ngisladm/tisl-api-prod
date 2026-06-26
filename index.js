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
const operadorasRoutes        = require("./routes/operadoras");
const linhasFaturadasRoutes   = require("./routes/linhas-faturadas");
const tipoAtivosRoutes        = require("./routes/tipo-ativos");
const linhasDisponiveisRoutes = require("./routes/linhas-disponiveis");
const ativosRoutes            = require("./routes/ativos");
const controleAtivosRoutes    = require("./routes/controle-ativos");
const funcionariosRoutes      = require("./routes/funcionarios");
const { router: syncRoutes, syncFuncionarios } = require("./routes/sync");
const cron                    = require("node-cron");

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
pool.query("ALTER TABLE linhas_faturadas ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id)").catch(()=>{});
pool.query("INSERT INTO screens (id, name, module) VALUES ('s16','Operadoras','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("INSERT INTO screens (id, name, module) VALUES ('s17','Linhas Faturadas','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("UPDATE profiles SET permissions = permissions || '{\"s16\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's16')").catch(()=>{});
pool.query("UPDATE profiles SET permissions = permissions || '{\"s17\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's17')").catch(()=>{});

// Versão 4 — Tipo de Ativo, Linhas Disponíveis, Ativos, Controle de Ativos
pool.query(`CREATE TABLE IF NOT EXISTS tipo_ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query(`CREATE TABLE IF NOT EXISTS linhas_disponiveis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id),
  operadora_id  UUID REFERENCES operadoras(id),
  tipo_ativo_id UUID REFERENCES tipo_ativos(id),
  numero_linha  VARCHAR(50),
  status        VARCHAR(20) DEFAULT 'Em análise',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query(`CREATE TABLE IF NOT EXISTS ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(200) NOT NULL,
  tipo_ativo_id UUID REFERENCES tipo_ativos(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query(`CREATE TABLE IF NOT EXISTS controle_ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_funcionario VARCHAR(200) NOT NULL,
  cpf VARCHAR(14),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query(`CREATE TABLE IF NOT EXISTS itens_controle_ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  controle_ativo_id UUID REFERENCES controle_ativos(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES companies(id),
  tipo_ativo_id UUID REFERENCES tipo_ativos(id),
  operadora_id  UUID REFERENCES operadoras(id),
  linha_id      UUID REFERENCES linhas_disponiveis(id),
  imei          VARCHAR(100),
  ativo_id      UUID REFERENCES ativos(id),
  numero_serie  VARCHAR(100),
  numero_documento VARCHAR(100),
  attachments   JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query("INSERT INTO screens (id,name,module) VALUES ('s18','Tipo de Ativo','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("INSERT INTO screens (id,name,module) VALUES ('s19','Linhas Disponíveis','Movimentações') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("INSERT INTO screens (id,name,module) VALUES ('s20','Ativos','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("INSERT INTO screens (id,name,module) VALUES ('s21','Controle de Ativos','Movimentações') ON CONFLICT DO NOTHING").catch(()=>{});
// Migração colunas itens_controle_ativos v4.1
[
  "ALTER TABLE itens_controle_ativos RENAME COLUMN imei TO imei_slot1",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS acesso VARCHAR(200)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS estrutura VARCHAR(200)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS iccid VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS tipo_pacote VARCHAR(50)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS marca VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS modelo VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS imei_slot2 VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS sistema_operacional VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS versao VARCHAR(50)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS processador VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS memoria VARCHAR(50)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS hd VARCHAR(50)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS patrimonio VARCHAR(100)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS valor NUMERIC(12,2)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS data_aquisicao DATE",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS condicao VARCHAR(20)",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS acessorios TEXT",
  "ALTER TABLE itens_controle_ativos ADD COLUMN IF NOT EXISTS status_ativo VARCHAR(20)",
].forEach(sql => pool.query(sql).catch(() => {}));

// Garante permissões completas para s18-s21 em todos os perfis
["s18","s19","s20","s21"].forEach(s=>{
  pool.query(`UPDATE profiles SET permissions = permissions || '{"${s}":{"view":true,"insert":true,"edit":true,"delete":true}}'::jsonb`).catch(()=>{});
});

// Versão 5 — Funcionários (s22)
pool.query(`CREATE TABLE IF NOT EXISTS funcionarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(200) NOT NULL,
  matricula VARCHAR(50),
  centro_custo VARCHAR(100),
  cargo VARCHAR(100),
  rg VARCHAR(20),
  cpf VARCHAR(14),
  logradouro VARCHAR(200),
  numero VARCHAR(20),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  estado VARCHAR(2),
  cep VARCHAR(9),
  complemento VARCHAR(100),
  email VARCHAR(200),
  fone VARCHAR(20),
  observacao TEXT,
  situacao VARCHAR(10) DEFAULT 'Ativo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(()=>{});
pool.query("INSERT INTO screens (id,name,module) VALUES ('s22','Funcionários','Cadastros') ON CONFLICT DO NOTHING").catch(()=>{});
pool.query("UPDATE profiles SET permissions = permissions || '{\"s22\":{\"view\":true,\"insert\":true,\"edit\":true,\"delete\":true}}'::jsonb WHERE NOT (permissions ? 's22')").catch(()=>{});
pool.query("ALTER TABLE controle_ativos ADD COLUMN IF NOT EXISTS funcionario_id UUID REFERENCES funcionarios(id)").catch(()=>{});
pool.query("ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS coligada VARCHAR(200)").catch(()=>{});

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
app.use("/operadoras",         operadorasRoutes);
app.use("/linhas-faturadas",  linhasFaturadasRoutes);
app.use("/tipo-ativos",       tipoAtivosRoutes);
app.use("/linhas-disponiveis",linhasDisponiveisRoutes);
app.use("/ativos",            ativosRoutes);
app.use("/controle-ativos",   controleAtivosRoutes);
app.use("/funcionarios",      funcionariosRoutes);
app.use("/sync",              syncRoutes);

app.get("/", (req, res) => res.json({ status: "ok", app: "SL TI API" }));

app.listen(PORT, () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});

// Sync automático de funcionários: 06:00 e 18:00 todos os dias
cron.schedule("0 6,18 * * *", () => {
  console.log("⏰ Sync agendado de funcionários iniciado...");
  syncFuncionarios().catch(err => console.error("Erro no sync agendado:", err.message));
}, { timezone: "America/Sao_Paulo" });
// test auto-deploy