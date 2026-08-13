const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

const HEADER_FIELDS = `
  ci.id,
  ci.mes_ano AS "mesAno",
  ci.supplier_id AS "supplierId",
  s.name AS "supplierName",
  ci.created_at AS "createdAt"
`;

const ITEM_FIELDS = `
  i.id, i.consumo_impressao_id AS "consumoImpressaoId",
  i.ativo_id AS "ativoId",
  a.nome AS "nomeAtivo",
  a.numero_serie AS "numeroSerie",
  ta.name AS "tipoAtivo",
  a.marca, a.modelo,
  c.name AS "empresa",
  i.qtde_anterior AS "qtdeAnterior",
  i.qtde_atual AS "qtdeAtual",
  (i.qtde_atual - i.qtde_anterior) AS "impressoes",
  i.categoria
`;

const ITEM_JOINS = `
  FROM itens_consumo_impressao i
  LEFT JOIN ativos a ON a.id = i.ativo_id
  LEFT JOIN tipo_ativos ta ON ta.id = a.tipo_ativo_id
  LEFT JOIN companies c ON c.id = a.company_id
`;

// GET /consumo-impressao
router.get("/", auth, canAccess("s70"), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ${HEADER_FIELDS}
        FROM consumo_impressao ci
        LEFT JOIN suppliers s ON s.id = ci.supplier_id
       ORDER BY ci.mes_ano DESC, s.name`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar registros." }); }
});

// POST /consumo-impressao
router.post("/", auth, canAccess("s70","insert"), async (req, res) => {
  const { mesAno, supplierId } = req.body;
  if (!mesAno?.trim()) return res.status(400).json({ error: "Mês/Ano é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO consumo_impressao (mes_ano, supplier_id) VALUES ($1,$2) RETURNING id`,
      [mesAno.trim(), supplierId||null]
    );
    const full = await pool.query(
      `SELECT ${HEADER_FIELDS} FROM consumo_impressao ci LEFT JOIN suppliers s ON s.id=ci.supplier_id WHERE ci.id=$1`,
      [r.rows[0].id]
    );
    res.status(201).json(full.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar registro." }); }
});

// PUT /consumo-impressao/:id
router.put("/:id", auth, canAccess("s70","edit"), async (req, res) => {
  const { mesAno, supplierId } = req.body;
  if (!mesAno?.trim()) return res.status(400).json({ error: "Mês/Ano é obrigatório." });
  try {
    await pool.query(
      `UPDATE consumo_impressao SET mes_ano=$1, supplier_id=$2, updated_at=NOW() WHERE id=$3`,
      [mesAno.trim(), supplierId||null, req.params.id]
    );
    const full = await pool.query(
      `SELECT ${HEADER_FIELDS} FROM consumo_impressao ci LEFT JOIN suppliers s ON s.id=ci.supplier_id WHERE ci.id=$1`,
      [req.params.id]
    );
    res.json(full.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar registro." }); }
});

// DELETE /consumo-impressao/:id
router.delete("/:id", auth, canAccess("s70","delete"), async (req, res) => {
  try {
    await pool.query("DELETE FROM consumo_impressao WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir registro." }); }
});

// GET /consumo-impressao/:id/itens
router.get("/:id/itens", auth, canAccess("s70"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${ITEM_FIELDS} ${ITEM_JOINS} WHERE i.consumo_impressao_id=$1 ORDER BY a.nome`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// POST /consumo-impressao/:id/itens
router.post("/:id/itens", auth, canAccess("s70","insert"), async (req, res) => {
  const { ativoId, qtdeAnterior, qtdeAtual, categoria } = req.body;
  if (!ativoId) return res.status(400).json({ error: "Selecione um ativo." });
  try {
    const r = await pool.query(
      `INSERT INTO itens_consumo_impressao (consumo_impressao_id, ativo_id, qtde_anterior, qtde_atual, categoria)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.params.id, ativoId, qtdeAnterior||0, qtdeAtual||0, categoria||null]
    );
    const full = await pool.query(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS} WHERE i.id=$1`, [r.rows[0].id]);
    res.status(201).json(full.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar item." }); }
});

// PUT /consumo-impressao/:id/itens/:itemId
router.put("/:id/itens/:itemId", auth, canAccess("s70","edit"), async (req, res) => {
  const { ativoId, qtdeAnterior, qtdeAtual, categoria } = req.body;
  if (!ativoId) return res.status(400).json({ error: "Selecione um ativo." });
  try {
    await pool.query(
      `UPDATE itens_consumo_impressao SET ativo_id=$1, qtde_anterior=$2, qtde_atual=$3, categoria=$4, updated_at=NOW() WHERE id=$5`,
      [ativoId, qtdeAnterior||0, qtdeAtual||0, categoria||null, req.params.itemId]
    );
    const full = await pool.query(`SELECT ${ITEM_FIELDS} ${ITEM_JOINS} WHERE i.id=$1`, [req.params.itemId]);
    res.json(full.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar item." }); }
});

// DELETE /consumo-impressao/:id/itens/:itemId
router.delete("/:id/itens/:itemId", auth, canAccess("s70","delete"), async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_consumo_impressao WHERE id=$1", [req.params.itemId]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao excluir item." }); }
});

// POST /consumo-impressao/:id/itens/importar
router.post("/:id/itens/importar", auth, canAccess("s70","insert"), async (req, res) => {
  const { linhas } = req.body;
  if (!Array.isArray(linhas) || !linhas.length)
    return res.status(400).json({ error: "Nenhuma linha recebida." });

  // Pré-carrega ativos terceirizados por número de série
  const tipoRes = await pool.query("SELECT id FROM tipo_ativos WHERE LOWER(name)='terceirizado' LIMIT 1");
  const tipoId  = tipoRes.rows[0]?.id;
  const ativosRes = await pool.query(
    "SELECT id, numero_serie FROM ativos WHERE tipo_ativo_id=$1 AND numero_serie IS NOT NULL",
    [tipoId]
  );
  const ativoBySerial = new Map(ativosRes.rows.map(a => [a.numero_serie.trim().toLowerCase(), a.id]));

  let inseridos = 0, ignorados = 0;
  const erros = [];

  for (let i = 0; i < linhas.length; i++) {
    const row = linhas[i];
    // Colunas: Nº de Série, Categoria, Qtde Anterior, Qtde Atual
    const numeroSerie = (row["Nº de Série"] || row["Numero de Serie"] || row["nro_serie"] || "").trim();
    const categoria   = (row["Categoria"] || "").trim() || null;
    const qtdeAnt     = parseFloat((row["Qtde Anterior"] || "0").toString().replace(",",".")) || 0;
    const qtdeAtual   = parseFloat((row["Qtde Atual"] || "0").toString().replace(",",".")) || 0;

    if (!numeroSerie) { erros.push({ linha: i+1, msg: "Nº de Série em branco." }); continue; }
    const ativoId = ativoBySerial.get(numeroSerie.toLowerCase());
    if (!ativoId) { erros.push({ linha: i+1, msg: `Ativo com Nº de Série "${numeroSerie}" não encontrado.` }); ignorados++; continue; }

    try {
      await pool.query(
        `INSERT INTO itens_consumo_impressao (consumo_impressao_id, ativo_id, qtde_anterior, qtde_atual, categoria)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [req.params.id, ativoId, qtdeAnt, qtdeAtual, categoria]
      );
      inseridos++;
    } catch (e) {
      erros.push({ linha: i+1, msg: e.message });
    }
  }
  res.json({ inseridos, ignorados, erros });
});

// GET /consumo-impressao/ativos-terceirizados — lista ativos terceirizados com nº série para selects
router.get("/ativos-terceirizados", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.id, a.nome, a.numero_serie AS "numeroSerie", a.marca, a.modelo,
             ta.name AS "tipoAtivo", c.name AS "empresa"
        FROM ativos a
        LEFT JOIN tipo_ativos ta ON ta.id = a.tipo_ativo_id
        LEFT JOIN companies c ON c.id = a.company_id
       WHERE LOWER(ta.name) = 'terceirizado' AND a.numero_serie IS NOT NULL AND a.numero_serie <> ''
       ORDER BY a.numero_serie`);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar ativos." }); }
});

module.exports = router;
