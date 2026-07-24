const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const RETURNING = `
  RETURNING id, nome, matricula, centro_custo AS "centroCusto", cargo,
            rg, cpf, logradouro, numero, bairro, cidade, estado, cep,
            complemento, email, fone, observacao, situacao, coligada,
            created_at AS "createdAt"`;

// GET /funcionarios/basic — lista acessível por qualquer autenticado
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, matricula, cargo,
              centro_custo AS "centroCusto",
              email, fone, situacao, coligada, cpf
         FROM funcionarios
        ORDER BY nome`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar funcionários." });
  }
});

router.get("/", auth, canAccess("s22"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, matricula, centro_custo AS "centroCusto", cargo,
              rg, cpf, logradouro, numero, bairro, cidade, estado, cep,
              complemento, email, fone, observacao, situacao, coligada,
              created_at AS "createdAt"
         FROM funcionarios
        ORDER BY nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar funcionários." }); }
});

router.post("/importacao", auth, canAccess("s22","insert"), async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Formato inválido." });

  const str = v => (v == null ? "" : String(v)).trim();
  const situacoesValidas = ["Ativo","Inativo","Afastado","Férias","Demitido"];

  let inseridos = 0, ignorados = 0;
  const erros = [];
  const seenKeys = new Set();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nome      = str(r["Nome do Funcionário"]);
    const matricula = str(r["Matrícula"])      || null;
    const cpf       = str(r["CPF"])            || null;

    if (!nome) { ignorados++; continue; }

    // Deduplica dentro do próprio arquivo pela combinação cpf+matricula
    const key = `${cpf||""}||${matricula||""}`;
    if ((cpf || matricula) && seenKeys.has(key)) {
      ignorados++;
      erros.push({ linha: i + 2, msg: `Duplicata ignorada (CPF+Matrícula já apareceu antes no arquivo)` });
      continue;
    }
    seenKeys.add(key);

    const situacao = situacoesValidas.includes(str(r["Situação"])) ? str(r["Situação"]) : "Ativo";

    try {
      await pool.query(
        `INSERT INTO funcionarios
           (nome, matricula, centro_custo, cargo, cpf, rg, email, fone,
            logradouro, numero, complemento, bairro, cidade, cep, estado,
            situacao, coligada, observacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          nome,
          matricula,
          str(r["Centro de Custo"]) || null,
          str(r["Cargo"])           || null,
          cpf,
          str(r["RG"])              || null,
          str(r["E-mail"])          || null,
          str(r["Fone"])            || null,
          str(r["Logradouro"])      || null,
          str(r["Número"])          || null,
          str(r["Complemento"])     || null,
          str(r["Bairro"])          || null,
          str(r["Cidade"])          || null,
          str(r["CEP"])             || null,
          str(r["Estado"])          || null,
          situacao,
          str(r["Coligada"])        || null,
          str(r["Observação"])      || null,
        ]
      );
      inseridos++;
    } catch (e) {
      erros.push({ linha: i + 2, msg: e.message });
    }
  }

  res.json({ inseridos, ignorados, erros });
});

router.post("/", auth, canAccess("s22","edit"), async (req, res) => {
  const f = req.body;
  if (!f.nome?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO funcionarios
         (nome, matricula, centro_custo, cargo, rg, cpf, logradouro, numero,
          bairro, cidade, estado, cep, complemento, email, fone, observacao, situacao, coligada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ${RETURNING}`,
      [f.nome.trim(), f.matricula||null, f.centroCusto||null, f.cargo||null,
       f.rg||null, f.cpf||null, f.logradouro||null, f.numero||null,
       f.bairro||null, f.cidade||null, f.estado||null, f.cep||null,
       f.complemento||null, f.email||null, f.fone||null, f.observacao||null,
       f.situacao||"Ativo", f.coligada||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar funcionário." }); }
});

router.put("/:id", auth, canAccess("s22","edit"), async (req, res) => {
  const f = req.body;
  if (!f.nome?.trim()) return res.status(400).json({ error: "Nome do funcionário é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE funcionarios SET
         nome=$1, matricula=$2, centro_custo=$3, cargo=$4, rg=$5, cpf=$6,
         logradouro=$7, numero=$8, bairro=$9, cidade=$10, estado=$11, cep=$12,
         complemento=$13, email=$14, fone=$15, observacao=$16, situacao=$17, coligada=$18,
         updated_at=NOW()
       WHERE id=$19
       ${RETURNING}`,
      [f.nome.trim(), f.matricula||null, f.centroCusto||null, f.cargo||null,
       f.rg||null, f.cpf||null, f.logradouro||null, f.numero||null,
       f.bairro||null, f.cidade||null, f.estado||null, f.cep||null,
       f.complemento||null, f.email||null, f.fone||null, f.observacao||null,
       f.situacao||"Ativo", f.coligada||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Funcionário não encontrado." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar funcionário." }); }
});

router.delete("/:id", auth, canAccess("s22","edit"), async (req, res) => {
  try {
    await pool.query("DELETE FROM funcionarios WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir funcionário." }); }
});

module.exports = router;
