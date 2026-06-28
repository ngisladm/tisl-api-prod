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

// POST /linhas-disponiveis/carga-inicial
// CSV cols: 1=Operadora, 2=NumeroLinha, 3=Empresa, 4=TipoAtivo, 5=Status
router.post("/carga-inicial", auth, async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: "Nenhuma linha recebida." });

  let inseridos = 0, ignorados = 0;
  const erros = [];

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i];
    const [operadoraNome, numeroLinha, empresaNome, tipoAtivoNome, statusVal] = cols;
    const linhaNum = i + 1;

    if (!operadoraNome?.trim() || !numeroLinha?.trim()) {
      erros.push({ linha: linhaNum, msg: "Operadora e Número da Linha são obrigatórios." });
      continue;
    }

    try {
      // Resolve IDs por nome
      const [opRes, coRes, taRes] = await Promise.all([
        pool.query("SELECT id FROM operadoras WHERE LOWER(name)=LOWER($1) LIMIT 1", [operadoraNome.trim()]),
        empresaNome?.trim() ? pool.query("SELECT id FROM companies WHERE LOWER(name)=LOWER($1) AND active=true LIMIT 1", [empresaNome.trim()]) : { rows: [] },
        tipoAtivoNome?.trim() ? pool.query("SELECT id FROM tipo_ativos WHERE LOWER(name)=LOWER($1) LIMIT 1", [tipoAtivoNome.trim()]) : { rows: [] },
      ]);

      const operadoraId = opRes.rows[0]?.id || null;
      const companyId   = coRes.rows[0]?.id || null;
      const tipoAtivoId = taRes.rows[0]?.id || null;

      // Verifica duplicata: mesma operadora + mesmo numero_linha
      const dup = await pool.query(
        `SELECT id FROM linhas_disponiveis WHERE numero_linha=$1 AND operadora_id IS NOT DISTINCT FROM $2 LIMIT 1`,
        [numeroLinha.trim(), operadoraId]
      );
      if (dup.rows.length > 0) { ignorados++; continue; }

      await pool.query(
        `INSERT INTO linhas_disponiveis (company_id, operadora_id, tipo_ativo_id, numero_linha, status)
         VALUES ($1,$2,$3,$4,$5)`,
        [companyId, operadoraId, tipoAtivoId, numeroLinha.trim(), statusVal?.trim() || "Em análise"]
      );
      inseridos++;
    } catch (e) {
      erros.push({ linha: linhaNum, msg: e.message });
    }
  }

  res.json({ inseridos, ignorados, erros });
});

// DELETE /linhas-disponiveis/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM linhas_disponiveis WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir linha disponível." }); }
});

module.exports = router;
