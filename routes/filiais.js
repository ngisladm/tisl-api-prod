const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");
const { canAccess } = require("../middleware/canAccess");

// GET /filiais
router.get("/", auth, canAccess("s39"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active
         FROM network_filiais ORDER BY nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar filiais." }); }
});

// GET /filiais/basic — lista mínima para selects em outras telas
router.get("/basic", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active
         FROM network_filiais WHERE active=true ORDER BY nome`
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao buscar filiais." }); }
});

// POST /filiais
router.post("/", auth, canAccess("s39", "insert"), async (req, res) => {
  const { nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active = true } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      `INSERT INTO network_filiais (nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active`,
      [nome.trim(), logradouro?.trim()||null, numero?.trim()||null, bairro?.trim()||null,
       cidade?.trim()||null, estado?.trim()||null, cep?.trim()||null, complemento?.trim()||null, active]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao criar filial." }); }
});

// PUT /filiais/:id
router.put("/:id", auth, canAccess("s39", "edit"), async (req, res) => {
  const { nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
  try {
    const r = await pool.query(
      `UPDATE network_filiais
          SET nome=$1, logradouro=$2, numero=$3, bairro=$4, cidade=$5, estado=$6,
              cep=$7, complemento=$8, active=$9
        WHERE id=$10
       RETURNING id, nome, logradouro, numero, bairro, cidade, estado, cep, complemento, active`,
      [nome.trim(), logradouro?.trim()||null, numero?.trim()||null, bairro?.trim()||null,
       cidade?.trim()||null, estado?.trim()||null, cep?.trim()||null, complemento?.trim()||null,
       active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Filial não encontrada." });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erro ao atualizar filial." }); }
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
