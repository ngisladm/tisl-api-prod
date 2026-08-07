const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const { canAccessAnyScreen, canAccessExact } = require("../middleware/canAccess");

function createCatalogRouter({ table, assetColumn, screenId, label, duplicateMessage }) {
  const router = express.Router();

  // A lista também alimenta a tela Ativos, mesmo quando o usuário não possui
  // permissão para manter este cadastro.
  router.get("/", auth, canAccessAnyScreen([screenId, "s20"]), async (req, res) => {
    try {
      const r = await pool.query(`SELECT id, name FROM ${table} ORDER BY name`);
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Erro ao buscar ${label.toLowerCase()}.` });
    }
  });

  router.post("/", auth, canAccessExact(screenId, "insert"), async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: `${label} é obrigatório.` });
    try {
      const r = await pool.query(
        `INSERT INTO ${table} (name) VALUES ($1) RETURNING id, name`,
        [name]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === "23505") return res.status(400).json({ error: duplicateMessage });
      console.error(err);
      res.status(500).json({ error: `Erro ao criar ${label.toLowerCase()}.` });
    }
  });

  router.put("/:id", auth, canAccessExact(screenId, "edit"), async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: `${label} é obrigatório.` });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(`SELECT name FROM ${table} WHERE id=$1 FOR UPDATE`, [req.params.id]);
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Registro não encontrado." });
      }
      const oldName = current.rows[0].name;
      const updated = await client.query(
        `UPDATE ${table} SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING id, name`,
        [name, req.params.id]
      );
      await client.query(
        `UPDATE ativos SET ${assetColumn}=$1, updated_at=NOW() WHERE LOWER(BTRIM(${assetColumn}))=LOWER(BTRIM($2))`,
        [name, oldName]
      );
      await client.query("COMMIT");
      res.json(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") return res.status(400).json({ error: duplicateMessage });
      console.error(err);
      res.status(500).json({ error: `Erro ao atualizar ${label.toLowerCase()}.` });
    } finally {
      client.release();
    }
  });

  router.delete("/:id", auth, canAccessExact(screenId, "delete"), async (req, res) => {
    try {
      const current = await pool.query(`SELECT name FROM ${table} WHERE id=$1`, [req.params.id]);
      if (!current.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
      const inUse = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM ativos WHERE LOWER(BTRIM(${assetColumn}))=LOWER(BTRIM($1))) AS used`,
        [current.rows[0].name]
      );
      if (inUse.rows[0].used) {
        return res.status(400).json({ error: `${label} está sendo utilizado na tela Ativos e não pode ser excluído.` });
      }
      await pool.query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Erro ao excluir ${label.toLowerCase()}.` });
    }
  });

  return router;
}

const assetNamesRouter = createCatalogRouter({
  table: "asset_names",
  assetColumn: "nome",
  screenId: "s67",
  label: "Nome do Ativo",
  duplicateMessage: "Nome do ativo já cadastrado."
});

const assetBrandsRouter = createCatalogRouter({
  table: "asset_brands",
  assetColumn: "marca",
  screenId: "s68",
  label: "Marca",
  duplicateMessage: "Marca já cadastrada."
});

module.exports = { assetNamesRouter, assetBrandsRouter };
