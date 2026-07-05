require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const logger     = require("./utils/logger");

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
const modelosContratoRoutes   = require("./routes/modelos-contrato");
const { router: syncRoutes, syncFuncionarios } = require("./routes/sync");
const emailConfigRoutes = require("./routes/email-config");
const emailRoutes       = require("./routes/email");
const historicoMovimentacoesRoutes = require("./routes/historico-movimentacoes");
const feriasRoutes                 = require("./routes/ferias");
const cron                    = require("node-cron");

const pool = require("./db");
const app  = express();

const migrate = sql => pool.query(sql).catch(err => logger.error("[migration]", err.message));
const PORT = process.env.PORT || 3001;

// Informa ao Express que está atrás de um proxy reverso (GoCache/nginx)
app.set("trust proxy", 1);

// Helmet — headers de segurança (CSP desabilitado para compatibilidade React)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — restrito à origem do frontend
// Configure FRONTEND_URL no .env (ex: http://192.168.1.100:3000)
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map(s => s.trim())
  : ["http://localhost:3000"];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS: origin not allowed"));
  },
  credentials: true,
}));

// H4 — Body limit segmentado por rota
// ROLLBACK: se algum upload começar a falhar com 413, aumentar o global abaixo de volta para "5mb"
// Rotas que recebem arquivos grandes (base64): logo de empresa, PDF de contrato, anexos de ativos
const HIGH_LIMIT_ROUTES = ["/email/enviar-contrato", "/companies", "/controle-ativos"];
app.use((req, res, next) => {
  const isHighLimit = HIGH_LIMIT_ROUTES.some(p => req.path.startsWith(p));
  express.json({ limit: isHighLimit ? "50mb" : "2mb" })(req, res, next);
});

// Auto-migrate
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id, name, module) VALUES ('s15','Relatório de Escala','Relatórios') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s15\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's15')").catch(err => logger.error("[migration]", err.message));

// Telefonia
pool.query(`CREATE TABLE IF NOT EXISTS operadoras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS linhas_faturadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operadora_id UUID REFERENCES operadoras(id),
  mes_ano VARCHAR(7) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS itens_linhas_faturadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha_faturada_id UUID REFERENCES linhas_faturadas(id) ON DELETE CASCADE,
  numero_linha VARCHAR(50),
  plano VARCHAR(200),
  consumo_linha VARCHAR(100),
  valor_linha VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE linhas_faturadas ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id)").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id, name, module) VALUES ('s16','Operadoras','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id, name, module) VALUES ('s17','Linhas Faturadas','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s16\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's16')").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s17\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's17')").catch(err => logger.error("[migration]", err.message));

// Versão 4 — Tipo de Ativo, Linhas Disponíveis, Ativos, Controle de Ativos
pool.query(`CREATE TABLE IF NOT EXISTS tipo_ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS linhas_disponiveis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id),
  operadora_id  UUID REFERENCES operadoras(id),
  tipo_ativo_id UUID REFERENCES tipo_ativos(id),
  numero_linha  VARCHAR(50),
  status        VARCHAR(20) DEFAULT 'Em análise',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(200) NOT NULL,
  tipo_ativo_id UUID REFERENCES tipo_ativos(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS controle_ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_funcionario VARCHAR(200) NOT NULL,
  cpf VARCHAR(14),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
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
)`).catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s18','Tipo de Ativo','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s19','Linhas Disponíveis','Movimentações') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s20','Ativos','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s21','Controle de Ativos','Movimentações') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
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
].forEach(sql => pool.query(sql).catch(err => logger.error("[migration]", err.message)));

// Garante permissões completas para s18-s21 em todos os perfis
["s18","s19","s20","s21"].forEach(s=>{
  pool.query(`UPDATE profiles SET permissions = permissions || '{"${s}":{"view":true,"insert":true,"edit":true,"delete":true}}'::jsonb`).catch(err => logger.error("[migration]", err.message));
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
)`).catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s22','Funcionários','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s22\":{\"view\":true,\"insert\":true,\"edit\":true,\"delete\":true}}'::jsonb WHERE NOT (permissions ? 's22')").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE controle_ativos ADD COLUMN IF NOT EXISTS funcionario_id UUID REFERENCES funcionarios(id)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS coligada VARCHAR(200)").catch(err => logger.error("[migration]", err.message));
// Versão 6 — Campos extras em Empresas, Fornecedores, Operadoras; Apelido em Usuários
// Companies
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS razao_social VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS insc_estadual VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS insc_municipal VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS logradouro VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS numero VARCHAR(20)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS bairro VARCHAR(100)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS cep VARCHAR(10)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS cidade VARCHAR(100)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS estado VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS representante_legal VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
// Suppliers
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS razao_social VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS insc_estadual VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS insc_municipal VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS logradouro VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS numero VARCHAR(20)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bairro VARCHAR(100)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cep VARCHAR(10)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cidade VARCHAR(100)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS estado VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
// Operadoras
pool.query("ALTER TABLE operadoras ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE operadoras ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE operadoras ADD COLUMN IF NOT EXISTS contact_email VARCHAR(200)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE operadoras ADD COLUMN IF NOT EXISTS observacao TEXT").catch(err => logger.error("[migration]", err.message));
// Users — apelido
pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS apelido VARCHAR(100)").catch(err => logger.error("[migration]", err.message));

// Versão 6 — Logo de empresas e Modelos de Contrato
pool.query("ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo TEXT").catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS modelos_contrato (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(200) NOT NULL,
  tipo_ativo_id UUID REFERENCES tipo_ativos(id),
  conteudo TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s23','Modelos de Contrato','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s23\":{\"view\":true,\"insert\":true,\"edit\":true,\"delete\":true}}'::jsonb WHERE NOT (permissions ? 's23')").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE modelos_contrato ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES companies(id)").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s24','Relatório de Análise de Linhas','Relatórios') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s24\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's24')").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s25','Relatório de Resumo de Linhas','Relatórios') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s25\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's25')").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s26','Resumo de Ativos','Relatórios') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s26\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's26')").catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s27','Inventário de Ativos','Relatórios') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s27\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's27')").catch(err => logger.error("[migration]", err.message));
pool.query(`CREATE TABLE IF NOT EXISTS email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host VARCHAR(255), port INTEGER DEFAULT 587, secure BOOLEAN DEFAULT false,
  user_email VARCHAR(255), password VARCHAR(500),
  from_name VARCHAR(255), from_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
)`).catch(err => logger.error("[migration]", err.message));
pool.query("INSERT INTO screens (id,name,module) VALUES ('s28','Configuração de E-mail','Cadastros') ON CONFLICT DO NOTHING").catch(err => logger.error("[migration]", err.message));
pool.query("UPDATE profiles SET permissions = permissions || '{\"s28\":{\"view\":true,\"insert\":true,\"edit\":true,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's28')").catch(err => logger.error("[migration]", err.message));

// V11 — Ativos expandido, Linhas Disponíveis extras, Histórico de Movimentações
[
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS marca VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS modelo VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS numero_serie VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS sistema_operacional VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS versao VARCHAR(50)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS processador VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS memoria VARCHAR(50)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS hd VARCHAR(50)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS patrimonio VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS valor NUMERIC(12,2)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS data_aquisicao DATE",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS condicao VARCHAR(20)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS acessorios TEXT",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS imei_slot1 VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS imei_slot2 VARCHAR(100)",
  "ALTER TABLE ativos ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Em Estoque'",
  "ALTER TABLE linhas_disponiveis ADD COLUMN IF NOT EXISTS acesso VARCHAR(200)",
  "ALTER TABLE linhas_disponiveis ADD COLUMN IF NOT EXISTS estrutura VARCHAR(200)",
  "ALTER TABLE linhas_disponiveis ADD COLUMN IF NOT EXISTS iccid VARCHAR(100)",
  "ALTER TABLE linhas_disponiveis ADD COLUMN IF NOT EXISTS tipo_pacote VARCHAR(50)",
  "ALTER TABLE linhas_faturadas ADD COLUMN IF NOT EXISTS fatura VARCHAR(200)",
].forEach(sql => migrate(sql));
migrate(`CREATE TABLE IF NOT EXISTS historico_movimentacoes_ativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID,
  funcionario_nome VARCHAR(200),
  funcionario_cpf VARCHAR(30),
  tipo_movimentacao VARCHAR(50),
  usuario_nome VARCHAR(200),
  company_name VARCHAR(200),
  tipo_ativo_name VARCHAR(200),
  ativo_nome VARCHAR(200),
  marca VARCHAR(100),
  modelo VARCHAR(100),
  imei_slot1 VARCHAR(100),
  imei_slot2 VARCHAR(100),
  numero_serie VARCHAR(100),
  numero_linha VARCHAR(50),
  operadora_name VARCHAR(200),
  iccid VARCHAR(100),
  acesso VARCHAR(200),
  estrutura VARCHAR(200),
  tipo_pacote VARCHAR(50),
  sistema_operacional VARCHAR(100),
  versao VARCHAR(50),
  processador VARCHAR(100),
  memoria VARCHAR(50),
  hd VARCHAR(50),
  patrimonio VARCHAR(100),
  numero_documento VARCHAR(100),
  valor NUMERIC(12,2),
  data_aquisicao DATE,
  condicao VARCHAR(20),
  acessorios TEXT,
  status_ativo VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
)`);
migrate("ALTER TABLE historico_movimentacoes_ativos ADD COLUMN IF NOT EXISTS funcionario_destino_nome VARCHAR(200)");
migrate("INSERT INTO screens (id,name,module) VALUES ('s29','Histórico de Movimentações de Ativos','Movimentações') ON CONFLICT DO NOTHING");
migrate("UPDATE profiles SET permissions = permissions || '{\"s29\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's29')");

// Férias (s30)
migrate(`CREATE TABLE IF NOT EXISTS ferias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  team_id    UUID REFERENCES teams(id),
  ano        INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`);
migrate(`CREATE TABLE IF NOT EXISTS ferias_equipe (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ferias_id      UUID REFERENCES ferias(id) ON DELETE CASCADE,
  funcionario_id UUID REFERENCES funcionarios(id),
  data_limite    DATE,
  total_dias     INTEGER NOT NULL DEFAULT 30,
  dias_vendidos  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
)`);
migrate(`CREATE TABLE IF NOT EXISTS periodos_ferias (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ferias_equipe_id UUID REFERENCES ferias_equipe(id) ON DELETE CASCADE,
  data_inicial     DATE,
  data_final       DATE,
  qtde_dias        INTEGER NOT NULL DEFAULT 0,
  status           VARCHAR(20) NOT NULL DEFAULT 'Pendente',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
)`);
migrate("ALTER TABLE ferias_equipe ADD COLUMN IF NOT EXISTS data_ferias DATE");
migrate("ALTER TABLE ferias_equipe ADD COLUMN IF NOT EXISTS dt_final_fer DATE");
migrate("ALTER TABLE ferias_equipe ADD COLUMN IF NOT EXISTS chamado VARCHAR(200)");
migrate("INSERT INTO screens (id,name,module) VALUES ('s30','Férias','Movimentações') ON CONFLICT DO NOTHING");
migrate("INSERT INTO screens (id,name,module) VALUES ('s31','Relatório de Férias','Relatórios') ON CONFLICT DO NOTHING");
migrate("UPDATE profiles SET permissions = permissions || '{\"s31\":{\"view\":true,\"insert\":false,\"edit\":false,\"delete\":false}}'::jsonb WHERE NOT (permissions ? 's31')");

// Itens de Equipe
migrate(`CREATE TABLE IF NOT EXISTS equipe_itens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  funcionario_id UUID NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, funcionario_id)
)`);
// Funcionário vinculado ao usuário (1:1)
migrate("ALTER TABLE users ADD COLUMN IF NOT EXISTS funcionario_id UUID UNIQUE REFERENCES funcionarios(id) ON DELETE SET NULL");
// Trocar user_id por funcionario_id nas tabelas de lançamento
migrate("ALTER TABLE extra_avulso ADD COLUMN IF NOT EXISTS funcionario_id UUID REFERENCES funcionarios(id)");
migrate("ALTER TABLE extra_avulso DROP COLUMN IF EXISTS user_id");
migrate("ALTER TABLE km_records ADD COLUMN IF NOT EXISTS funcionario_id UUID REFERENCES funcionarios(id)");
migrate("ALTER TABLE km_records DROP COLUMN IF EXISTS user_id");
migrate("ALTER TABLE escala_turnos ADD COLUMN IF NOT EXISTS funcionario_id UUID REFERENCES funcionarios(id)");
migrate("ALTER TABLE escala_turnos DROP COLUMN IF EXISTS user_id");
// Tabela de equipes vinculadas a uma escala (many-to-many)
migrate(`CREATE TABLE IF NOT EXISTS escala_equipes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id UUID NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  team_id   UUID NOT NULL REFERENCES teams(id),
  UNIQUE(escala_id, team_id)
)`);
// Migrar team_id existente para escala_equipes (só se a coluna ainda existir)
migrate(`DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='escalas' AND column_name='team_id') THEN
    INSERT INTO escala_equipes (escala_id, team_id)
    SELECT id, team_id FROM escalas WHERE team_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$`);
migrate("ALTER TABLE escalas DROP COLUMN IF EXISTS team_id");
// Um funcionário só pode estar em uma equipe
migrate(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipe_itens_funcionario_unique') THEN
    ALTER TABLE equipe_itens ADD CONSTRAINT equipe_itens_funcionario_unique UNIQUE (funcionario_id);
  END IF;
END $$`);

// Ampliar colunas para comportar dados do SQL Server externo
pool.query("ALTER TABLE funcionarios ALTER COLUMN estado TYPE VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ALTER COLUMN rg TYPE VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ALTER COLUMN cpf TYPE VARCHAR(30)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ALTER COLUMN centro_custo TYPE VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ALTER COLUMN cargo TYPE VARCHAR(300)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ALTER COLUMN numero TYPE VARCHAR(50)").catch(err => logger.error("[migration]", err.message));
pool.query("ALTER TABLE funcionarios ALTER COLUMN complemento TYPE VARCHAR(300)").catch(err => logger.error("[migration]", err.message));

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
app.use("/modelos-contrato",  modelosContratoRoutes);
app.use("/email-config",      emailConfigRoutes);
app.use("/historico-movimentacoes", historicoMovimentacoesRoutes);
app.use("/ferias",                 feriasRoutes);
app.use("/email",             emailRoutes);
app.use("/sync",              syncRoutes);

app.get("/health", (req, res) => res.json({ status: "ok", app: "SL TI API", ts: new Date().toISOString() }));
app.get("/", (req, res) => res.json({ status: "ok", app: "SL TI API" }));

app.listen(PORT, () => {
  logger.info(`API rodando em http://localhost:${PORT}`);
});

// Sync automático de funcionários: 06:00 e 18:00 todos os dias
cron.schedule("0 6,18 * * *", () => {
  logger.info("Sync agendado de funcionários iniciado...");
  syncFuncionarios().catch(err => logger.error("Erro no sync agendado:", err.message));
}, { timezone: "America/Sao_Paulo" });
// test auto-deploy