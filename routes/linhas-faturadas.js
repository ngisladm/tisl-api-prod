const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const multer  = require("multer");
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ── Detecção de formato ──────────────────────────────────────────────────────
function detectarOperadora(linhas) {
  const primeira = linhas[0] || "";
  // TIM: separado por ; com cabeçalho NumAcs
  if (primeira.split(";").length > 5 && primeira.includes("NumAcs")) return "TIM";
  // Claro FEBRABAN V3: primeira linha começa com 0, longa e contém V3R ou CLARO
  if (primeira[0] === "0" && primeira.length >= 300 && (primeira.includes("V3R") || primeira.includes("CLARO"))) return "CLARO";
  // Vivo: tem registros 110D com telefone no formato XX-XXXXX-XXXX
  const amostra = linhas.slice(0, 500).join("\n");
  if (/110D\s+\d{2}-\d{5}-\d{4}/.test(amostra)) return "VIVO";
  return null;
}

// ── Parser TIM ───────────────────────────────────────────────────────────────
function parsearTIM(linhas) {
  const valores = {}, planos = {}, consumo = {};
  for (const l of linhas) {
    const cols = l.split(";");
    if (cols.length < 15) continue;
    const numAcs = cols[3].trim(), tpserv = cols[6].trim(), valor = cols[14].trim();
    if (!numAcs) continue;
    if (tpserv.startsWith("Total de Mensalidades e Franquias")) {
      valores[numAcs] = valor;
      planos[numAcs]  = cols[4].trim();
      if (!(numAcs in consumo)) consumo[numAcs] = "";
    }
  }
  for (const l of linhas) {
    const cols = l.split(";");
    if (cols.length < 15) continue;
    const numAcs = cols[3].trim(), durStr = cols[13].trim();
    if (!numAcs || !(numAcs in consumo)) continue;
    if (durStr && durStr !== "-" && durStr !== "N/R") consumo[numAcs] = durStr;
  }
  return Object.keys(valores).sort().map(n => ({
    numeroLinha: n, plano: planos[n]||"", consumoLinha: consumo[n]||"", valorLinha: valores[n]||"",
  }));
}

// ── Parser Claro (FEBRABAN V3) ───────────────────────────────────────────────
function parsearClaro(linhas) {
  const valores = {}, planos = {}, consumoMB = {};
  for (const l of linhas) {
    if (l.length < 152 || l[0] !== "1") continue;
    const ph = l.substring(53, 64).trim();
    if (!/^\d{11}$/.test(ph)) continue;
    const valStr = l.substring(135, 152);
    if (/^\d+$/.test(valStr)) valores[ph] = (parseInt(valStr, 10) / 100).toFixed(2);
    if (!(ph in consumoMB)) consumoMB[ph] = 0;
    if (!(ph in planos))    planos[ph]    = "";
  }
  for (const l of linhas) {
    if (l.length < 216 || l[0] !== "6") continue;
    const ph = l.substring(53, 64).trim();
    if (!(ph in planos) || planos[ph]) continue;
    const p = l.substring(191, 216).trim();
    if (p && !p.startsWith("PLANO VOZ")) planos[ph] = p;
  }
  for (const l of linhas) {
    if (l.length < 145 || l[0] !== "4") continue;
    const ph = l.substring(53, 64).trim();
    if (!(ph in consumoMB)) continue;
    const m = l.match(/(\d{6})(MB|KB|GB)/);
    if (m) {
      const qty = parseInt(m[1], 10);
      if      (m[2] === "KB") consumoMB[ph] += qty / 1024;
      else if (m[2] === "MB") consumoMB[ph] += qty;
      else                    consumoMB[ph] += qty * 1024;
    }
  }
  return Object.keys(valores).sort().map(ph => ({
    numeroLinha: ph, plano: planos[ph]||"",
    consumoLinha: Math.round(consumoMB[ph] * 100) / 100 + "MB",
    valorLinha: valores[ph]||"",
  }));
}

// ── Parser Vivo ──────────────────────────────────────────────────────────────
function parsearVivo(linhas) {
  const valores = {}, planos = {}, consumoMB = {};
  for (const l of linhas) {
    if (!l.includes("110D")) continue;
    const m = l.match(/110D\s+(\d{2}-\d{5}-\d{4})\s{5,}(.+?)\s{5,}([\d.]+)A/);
    if (m) {
      const ph = m[1].replace(/-/g, "");
      valores[ph]   = parseFloat(m[3]).toFixed(2);
      planos[ph]    = m[2].trim();
      consumoMB[ph] = 0;
    }
  }
  for (const l of linhas) {
    if (!l.includes("282D00")) continue;
    const mPh = l.match(/^(\d{10})\s+\d{10}\s+(\d{11})\s/);
    if (!mPh) continue;
    const ph = mPh[2];
    if (!(ph in consumoMB)) continue;
    const mC = l.match(/282D00.+?([\d]+\.[\d]+)\s+(KB|MB|GB)/);
    if (mC) {
      const qty = parseFloat(mC[1]);
      if      (mC[2] === "KB") consumoMB[ph] += qty / 1024;
      else if (mC[2] === "MB") consumoMB[ph] += qty;
      else                     consumoMB[ph] += qty * 1024;
    }
  }
  return Object.keys(valores).sort().map(ph => ({
    numeroLinha: ph, plano: planos[ph]||"",
    consumoLinha: Math.round(consumoMB[ph] * 100) / 100 + "MB",
    valorLinha: valores[ph]||"",
  }));
}

// GET /linhas-faturadas
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT lf.id, lf.mes_ano AS "mesAno", lf.fatura,
              lf.operadora_id AS "operadoraId", o.name AS "operadoraName",
              lf.company_id   AS "companyId",   c.name AS "companyName",
              COUNT(i.id)::int AS "totalItens",
              lf.created_at AS "createdAt"
         FROM linhas_faturadas lf
         LEFT JOIN operadoras  o ON o.id = lf.operadora_id
         LEFT JOIN companies   c ON c.id = lf.company_id
         LEFT JOIN itens_linhas_faturadas i ON i.linha_faturada_id = lf.id
        GROUP BY lf.id, o.name, c.name
        ORDER BY lf.mes_ano DESC, o.name`
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar linhas faturadas." });
  }
});

// POST /linhas-faturadas
router.post("/", auth, async (req, res) => {
  const { operadoraId, companyId, mesAno, fatura } = req.body;
  if (!operadoraId || !mesAno?.trim())
    return res.status(400).json({ error: "Operadora e Mês/Ano são obrigatórios." });
  try {
    const r = await pool.query(
      `INSERT INTO linhas_faturadas (operadora_id, company_id, mes_ano, fatura)
       VALUES ($1, $2, $3, $4)
       RETURNING id, operadora_id AS "operadoraId", company_id AS "companyId", mes_ano AS "mesAno", fatura`,
      [operadoraId, companyId||null, mesAno.trim(), fatura||null]
    );
    const row = r.rows[0];
    const op = await pool.query("SELECT name FROM operadoras WHERE id=$1", [operadoraId]);
    const co = companyId ? await pool.query("SELECT name FROM companies WHERE id=$1", [companyId]) : null;
    row.operadoraName = op.rows[0]?.name;
    row.companyName   = co?.rows[0]?.name || null;
    row.totalItens = 0;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar linha faturada." });
  }
});

// PUT /linhas-faturadas/:id
router.put("/:id", auth, async (req, res) => {
  const { operadoraId, companyId, mesAno, fatura } = req.body;
  if (!operadoraId || !mesAno?.trim())
    return res.status(400).json({ error: "Operadora e Mês/Ano são obrigatórios." });
  try {
    const r = await pool.query(
      `UPDATE linhas_faturadas SET operadora_id=$1, company_id=$2, mes_ano=$3, fatura=$4, updated_at=NOW()
        WHERE id=$5
       RETURNING id, operadora_id AS "operadoraId", company_id AS "companyId", mes_ano AS "mesAno", fatura`,
      [operadoraId, companyId||null, mesAno.trim(), fatura||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Linha não encontrada." });
    const row = r.rows[0];
    const op = await pool.query("SELECT name FROM operadoras WHERE id=$1", [operadoraId]);
    const co = companyId ? await pool.query("SELECT name FROM companies WHERE id=$1", [companyId]) : null;
    row.operadoraName = op.rows[0]?.name;
    row.companyName   = co?.rows[0]?.name || null;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar linha faturada." });
  }
});

// DELETE /linhas-faturadas/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM itens_linhas_faturadas WHERE linha_faturada_id=$1", [req.params.id]);
    await pool.query("DELETE FROM linhas_faturadas WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir linha faturada." });
  }
});

// GET /linhas-faturadas/relatorio — todos os itens com info completa para relatórios
router.get("/relatorio", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.numero_linha AS "numeroLinha", i.plano,
              i.consumo_linha AS "consumoLinha", i.valor_linha AS "valorLinha",
              lf.mes_ano AS "mesAno",
              lf.operadora_id AS "operadoraId", o.name AS "operadoraName",
              lf.company_id AS "companyId", c.name AS "companyName"
         FROM itens_linhas_faturadas i
         JOIN linhas_faturadas lf ON lf.id = i.linha_faturada_id
         JOIN operadoras o ON o.id = lf.operadora_id
         LEFT JOIN companies c ON c.id = lf.company_id
        ORDER BY c.name, o.name, lf.mes_ano, i.numero_linha`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar dados." }); }
});

// GET /linhas-faturadas/itens/all — resumo de todos os itens para filtros na tela principal
router.get("/itens/all", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.linha_faturada_id AS "linhaFaturadaId", i.numero_linha AS "numeroLinha"
         FROM itens_linhas_faturadas i
        WHERE i.numero_linha IS NOT NULL AND i.numero_linha <> ''`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar itens." }); }
});

// GET /linhas-faturadas/:id/itens
router.get("/:id/itens", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.numero_linha AS "numeroLinha", i.plano,
              i.consumo_linha AS "consumoLinha", i.valor_linha AS "valorLinha",
              lf.mes_ano AS "mesAno",
              o.name AS "operadoraName",
              c.name AS "companyName"
         FROM itens_linhas_faturadas i
         JOIN linhas_faturadas lf ON lf.id = i.linha_faturada_id
         JOIN operadoras  o ON o.id = lf.operadora_id
         LEFT JOIN companies c ON c.id = lf.company_id
        WHERE i.linha_faturada_id=$1
        ORDER BY i.numero_linha`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar itens." });
  }
});

// POST /linhas-faturadas/:id/itens/parsear-arquivo — parse arquivo bruto TIM/Claro/Vivo, retorna itens para preview
router.post("/:id/itens/parsear-arquivo", auth, upload.single("arquivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  try {
    const texto  = req.file.buffer.toString("utf8");
    const linhas = texto.split(/\r?\n/).filter(l => l.trim());
    const operadora = detectarOperadora(linhas);
    if (!operadora)
      return res.status(400).json({ error: "Formato não reconhecido. Envie um arquivo TIM (.txt), Claro (FEBRABAN V3) ou Vivo (SL_VIVO)." });
    let itens;
    if      (operadora === "TIM")   itens = parsearTIM(linhas);
    else if (operadora === "CLARO") itens = parsearClaro(linhas);
    else                            itens = parsearVivo(linhas);
    if (itens.length === 0)
      return res.status(400).json({ error: "Nenhum item encontrado no arquivo." });
    res.json({ operadoraDetectada: operadora, total: itens.length, itens });
  } catch (err) {
    console.error("[parsear-arquivo]", err);
    res.status(500).json({ error: "Erro ao processar o arquivo." });
  }
});

// POST /linhas-faturadas/:id/itens/importar
router.post("/:id/itens/importar", auth, async (req, res) => {
  const { itens } = req.body;
  if (!Array.isArray(itens) || itens.length === 0)
    return res.status(400).json({ error: "Nenhum item para importar." });
  try {
    await pool.query("DELETE FROM itens_linhas_faturadas WHERE linha_faturada_id=$1", [req.params.id]);
    for (const item of itens) {
      await pool.query(
        `INSERT INTO itens_linhas_faturadas (linha_faturada_id, numero_linha, plano, consumo_linha, valor_linha)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, item.numeroLinha||null, item.plano||null, item.consumoLinha||null, item.valorLinha||null]
      );
    }
    res.json({ success: true, total: itens.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao importar itens." });
  }
});

// POST /linhas-faturadas/:id/gerar-linhas-disponiveis
router.post("/:id/gerar-linhas-disponiveis", auth, async (req, res) => {
  try {
    // Busca a linha faturada com operadora e empresa
    const lfResult = await pool.query(
      `SELECT lf.operadora_id, lf.company_id, o.name AS "operadoraName"
         FROM linhas_faturadas lf
         LEFT JOIN operadoras o ON o.id = lf.operadora_id
        WHERE lf.id=$1`, [req.params.id]
    );
    if (!lfResult.rows[0]) return res.status(404).json({ error: "Linha faturada não encontrada." });
    const { operadora_id, company_id } = lfResult.rows[0];

    // Verifica se existe tipo_ativo "Telefonia"
    const taResult = await pool.query(
      "SELECT id FROM tipo_ativos WHERE LOWER(name)='telefonia' LIMIT 1"
    );
    if (!taResult.rows[0])
      return res.status(400).json({ error: "É necessário cadastrar um Tipo de Ativo chamado 'Telefonia' antes de gerar as linhas disponíveis." });
    const tipoAtivoId = taResult.rows[0].id;

    // Busca itens da linha faturada
    const itensResult = await pool.query(
      "SELECT numero_linha FROM itens_linhas_faturadas WHERE linha_faturada_id=$1 AND numero_linha IS NOT NULL",
      [req.params.id]
    );

    let inseridos = 0, ignorados = 0;
    for (const item of itensResult.rows) {
      // Verifica duplicidade por operadora + numero_linha
      const existe = await pool.query(
        "SELECT id FROM linhas_disponiveis WHERE operadora_id=$1 AND numero_linha=$2",
        [operadora_id, item.numero_linha]
      );
      if (existe.rows.length > 0) { ignorados++; continue; }
      await pool.query(
        `INSERT INTO linhas_disponiveis (company_id, operadora_id, tipo_ativo_id, numero_linha, status)
         VALUES ($1,$2,$3,$4,'Em análise')`,
        [company_id, operadora_id, tipoAtivoId, item.numero_linha]
      );
      inseridos++;
    }
    res.json({ success: true, inseridos, ignorados, total: itensResult.rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao gerar linhas disponíveis." }); }
});

module.exports = router;
