const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /linhas-disponiveis
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ld.id, ld.numero_linha AS "numeroLinha", ld.status,
              ld.company_id    AS "companyId",    c.name AS "companyName",
              ld.operadora_id  AS "operadoraId",  o.name AS "operadoraName",
              ld.tipo_ativo_id AS "tipoAtivoId",  ta.name AS "tipoAtivoName"
         FROM linhas_disponiveis ld
         LEFT JOIN companies  c  ON c.id  = ld.company_id
         LEFT JOIN operadoras o  ON o.id  = ld.operadora_id
         LEFT JOIN tipo_ativos ta ON ta.id = ld.tipo_ativo_id
        ORDER BY o.name, ld.numero_linha`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar linhas disponíveis." }); }
});

// POST /linhas-disponiveis
router.post("/", auth, async (req, res) => {
  const { companyId, operadoraId, tipoAtivoId, numeroLinha, status } = req.body;
  if (!numeroLinha?.trim()) return res.status(400).json({ error: "Número da linha é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO linhas_disponiveis (company_id, operadora_id, tipo_ativo_id, numero_linha, status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, company_id AS "companyId", operadora_id AS "operadoraId",
                 tipo_ativo_id AS "tipoAtivoId", numero_linha AS "numeroLinha", status`,
      [companyId||null, operadoraId||null, tipoAtivoId||null, numeroLinha.trim(), status||"Em análise"]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar linha disponível." }); }
});

// PUT /linhas-disponiveis/:id
router.put("/:id", auth, async (req, res) => {
  const { companyId, operadoraId, tipoAtivoId, numeroLinha, status } = req.body;
  if (!numeroLinha?.trim()) return res.status(400).json({ error: "Número da linha é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE linhas_disponiveis
          SET company_id=$1, operadora_id=$2, tipo_ativo_id=$3, numero_linha=$4, status=$5, updated_at=NOW()
        WHERE id=$6
       RETURNING id, company_id AS "companyId", operadora_id AS "operadoraId",
                 tipo_ativo_id AS "tipoAtivoId", numero_linha AS "numeroLinha", status`,
      [companyId||null, operadoraId||null, tipoAtivoId||null, numeroLinha.trim(), status||"Em análise", req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Linha não encontrada." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar linha disponível." }); }
});

// DELETE /linhas-disponiveis/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM linhas_disponiveis WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir linha disponível." }); }
});

module.exports = router;
