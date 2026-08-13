const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const FILIAL_FIELDS = `
  nf.id, nf.nome, nf.logradouro, nf.numero, nf.bairro, nf.cidade, nf.estado, nf.cep, nf.complemento, nf.observacao, nf.active,
  nf.empresa_id AS "empresaId", c.name AS "empresaNome",
  nf.centro_custo_id AS "centroCustoId",
  cc.centro_custo AS "centroCustoLabel",
  nf.responsavel_id AS "responsavelId", fn.nome AS "responsavelNome"
`;

// GET /filiais
router.get("/", auth, canAccess("s39"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${FILIAL_FIELDS}
         FROM network_filiais nf
         LEFT JOIN companies c ON c.id = nf.empresa_id
         LEFT JOIN consumo_ccusto cc ON cc.id = nf.centro_custo_id
         LEFT JOIN funcionarios fn ON fn.id = nf.responsavel_id
         ORDER BY nf.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar filiais." }); }
});

// GET /filiais/basic — lista mínima para selects em outras telas
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${FILIAL_FIELDS}
         FROM network_filiais nf
         LEFT JOIN companies c ON c.id = nf.empresa_id
         LEFT JOIN consumo_ccusto cc ON cc.id = nf.centro_custo_id
         LEFT JOIN funcionarios fn ON fn.id = nf.responsavel_id
         WHERE nf.active=true ORDER BY nf.nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar filiais." }); }
});

// POST /filiais
router.post("/", auth, canAccess("s39", "insert"), async (req, res) => {
  const { nome, logradouro, numero, bairro, cidade, estado, cep, complemento, observacao, active = true, empresaId, centroCustoId, responsavelId } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO network_filiais (nome, logradouro, numero, bairro, cidade, estado, cep, complemento, observacao, active, empresa_id, centro_custo_id, responsavel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [nome.trim(), logradouro?.trim()||null, numero?.trim()||null, bairro?.trim()||null,
       cidade?.trim()||null, estado?.trim()||null, cep?.trim()||null, complemento?.trim()||null,
       observacao?.trim()||null, active, empresaId||null, centroCustoId||null, responsavelId||null]
    );
    const full = await pool.query(`SELECT ${FILIAL_FIELDS} FROM network_filiais nf LEFT JOIN companies c ON c.id=nf.empresa_id LEFT JOIN consumo_ccusto cc ON cc.id=nf.centro_custo_id LEFT JOIN funcionarios fn ON fn.id=nf.responsavel_id WHERE nf.id=$1`, [r.rows[0].id]);
    res.status(201).json(full.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar filial." }); }
});

// PUT /filiais/:id
router.put("/:id", auth, canAccess("s39", "edit"), async (req, res) => {
  const { nome, logradouro, numero, bairro, cidade, estado, cep, complemento, observacao, active, empresaId, centroCustoId, responsavelId } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    await pool.query(
      `UPDATE network_filiais
          SET nome=$1, logradouro=$2, numero=$3, bairro=$4, cidade=$5, estado=$6,
              cep=$7, complemento=$8, observacao=$9, active=$10, empresa_id=$11, centro_custo_id=$12, responsavel_id=$13
        WHERE id=$14`,
      [nome.trim(), logradouro?.trim()||null, numero?.trim()||null, bairro?.trim()||null,
       cidade?.trim()||null, estado?.trim()||null, cep?.trim()||null, complemento?.trim()||null,
       observacao?.trim()||null, active, empresaId||null, centroCustoId||null, responsavelId||null, req.params.id]
    );
    const full = await pool.query(`SELECT ${FILIAL_FIELDS} FROM network_filiais nf LEFT JOIN companies c ON c.id=nf.empresa_id LEFT JOIN consumo_ccusto cc ON cc.id=nf.centro_custo_id LEFT JOIN funcionarios fn ON fn.id=nf.responsavel_id WHERE nf.id=$1`, [req.params.id]);
    if (!full.rows[0]) return res.status(404).json({ error: "Filial não encontrada." });
    res.json(full.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar filial." }); }
});

// POST /filiais/importar
router.post("/importar", auth, canAccess("s39","insert"), async (req, res) => {
  const { linhas } = req.body;
  if (!Array.isArray(linhas) || linhas.length === 0)
    return res.status(400).json({ error: "Nenhuma linha para importar." });

  const col = (row, ...keys) => {
    for (const k of keys) { const v = (row[k] || "").trim(); if (v) return v; }
    return "";
  };

  let inseridos = 0, duplicados = 0;
  const erros = [];

  for (let idx = 0; idx < linhas.length; idx++) {
    const l = linhas[idx];
    const nome        = col(l, "Nome");
    const empresa     = col(l, "Empresa");
    const logradouro  = col(l, "Logradouro");
    const centroCusto = col(l, "Centro de Custo");
    const observacao  = col(l, "Observações", "Observacoes");

    if (!nome) { erros.push(`Linha ${idx + 1}: campo "Nome" é obrigatório.`); continue; }

    // Verifica duplicata pelo Nome
    const dup = await pool.query("SELECT id FROM network_filiais WHERE LOWER(nome)=LOWER($1) LIMIT 1", [nome]);
    if (dup.rows[0]) { duplicados++; continue; }

    try {
      // Resolve Empresa pelo campo fantasia (name)
      let empresaId = null;
      if (empresa) {
        const empRes = await pool.query(
          "SELECT id FROM companies WHERE LOWER(name)=LOWER($1) LIMIT 1",
          [empresa]
        );
        empresaId = empRes.rows[0]?.id || null;
      }

      // Resolve Centro de Custo pelo campo centro_custo
      let centroCustoId = null;
      if (centroCusto) {
        const ccRes = await pool.query(
          "SELECT id FROM consumo_ccusto WHERE LOWER(centro_custo)=LOWER($1) LIMIT 1",
          [centroCusto]
        );
        centroCustoId = ccRes.rows[0]?.id || null;
      }

      await pool.query(
        `INSERT INTO network_filiais (nome, empresa_id, logradouro, observacao, centro_custo_id, active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [nome, empresaId, logradouro||null, observacao||null, centroCustoId]
      );
      inseridos++;
    } catch (e) {
      console.error("[importar-filiais]", e.message);
      erros.push(`Linha ${idx + 1} (${nome}): ${e.message}`);
    }
  }

  res.json({ success: true, inseridos, duplicados, erros: erros.slice(0, 20) });
});

// DELETE /filiais/:id
router.delete("/:id", auth, canAccess("s39", "delete"), async (req, res) => {
  try {
    const used = await pool.query(
      "SELECT id FROM network_ranges WHERE filial_id=$1 LIMIT 1", [req.params.id]
    );
    if (used.rows.length) return res.status(400).json({ error: "Não é possível excluir uma filial com faixas de rede cadastradas." });
    const used2 = await pool.query("SELECT id FROM links WHERE filial_id=$1 LIMIT 1", [req.params.id]);
    if (used2.rows.length) return res.status(400).json({ error: "Não é possível excluir uma filial com links cadastrados." });
    await pool.query("DELETE FROM network_filiais WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir filial." }); }
});

module.exports = router;
