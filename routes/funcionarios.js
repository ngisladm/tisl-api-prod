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

// GET /funcionarios/basic — lista mínima acessível por qualquer autenticado
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, cargo, centro_custo AS "centroCusto", situacao
         FROM funcionarios
        WHERE situacao = 'Ativo'
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
