const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

// GET /screens
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM screens ORDER BY module, name");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar telas." });
  }
});

module.exports = router;
