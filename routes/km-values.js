const express = require("express");
const router  = express.Router();
const pool    = require("../db");
const auth    = require("../middleware/auth");

const parseDate = (str) => {
  if (!str) return null;
  if (str.includes("/")) {
    const [d, m, y] = str.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return str;
};

// GET /km-values/lookup?vehicleTypeId=X&date=DD/MM/YYYY
router.get("/lookup", auth, async (req, res) => {
  const { vehicleTypeId, date } = req.query;
  if (!vehicleTypeId || !date) return res.json({ valorKm: 0 });
  try {
    const d = parseDate(date);
    const r = await pool.query(
      `SELECT valor_km AS "valorKm"
         FROM km_values
        WHERE vehicle_type_id=$1 AND data_inicio<=$2 AND data_fim>=$2
        LIMIT 1`,
      [vehicleTypeId, d]
    );
    res.json({ valorKm: r.rows[0]?.valorKm || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar valor do km." });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT kv.id,
             kv.vehicle_type_id           AS "vehicleTypeId",
             vt.name                      AS "vehicleTypeName",
             TO_CHAR(kv.data_inicio,'DD/MM/YYYY') AS "dataInicio",
             TO_CHAR(kv.data_fim,   'DD/MM/YYYY') AS "dataFim",
             kv.valor_km                  AS "valorKm"
        FROM km_values kv
        JOIN vehicle_types vt ON vt.id = kv.vehicle_type_id
       ORDER BY vt.name, kv.data_inicio DESC`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar valores de km." });
  }
});

router.post("/", auth, async (req, res) => {
  const { vehicleTypeId, dataInicio, dataFim, valorKm } = req.body;
  if (!vehicleTypeId || !dataInicio || !dataFim || valorKm == null)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });

  const di = parseDate(dataInicio);
  const df = parseDate(dataFim);
  if (di > df) return res.status(400).json({ error: "Data Inicial não pode ser maior que Data Final." });

  try {
    const overlap = await pool.query(
      `SELECT id FROM km_values
        WHERE vehicle_type_id=$1
          AND NOT (data_fim < $2::date OR data_inicio > $3::date)`,
      [vehicleTypeId, di, df]
    );
    if (overlap.rows.length > 0)
      return res.status(400).json({ error: "Já existe um registro para este Tipo de Veículo no mesmo período." });

    const r = await pool.query(
      `INSERT INTO km_values (vehicle_type_id, data_inicio, data_fim, valor_km)
       VALUES ($1,$2,$3,$4)
       RETURNING id,
                 vehicle_type_id              AS "vehicleTypeId",
                 TO_CHAR(data_inicio,'DD/MM/YYYY') AS "dataInicio",
                 TO_CHAR(data_fim,   'DD/MM/YYYY') AS "dataFim",
                 valor_km                     AS "valorKm"`,
      [vehicleTypeId, di, df, valorKm]
    );
    const row = r.rows[0];
    const vt = await pool.query("SELECT name FROM vehicle_types WHERE id=$1", [vehicleTypeId]);
    row.vehicleTypeName = vt.rows[0]?.name;
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar valor de km." });
  }
});

router.put("/:id", auth, async (req, res) => {
  const { vehicleTypeId, dataInicio, dataFim, valorKm } = req.body;
  if (!vehicleTypeId || !dataInicio || !dataFim || valorKm == null)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });

  const di = parseDate(dataInicio);
  const df = parseDate(dataFim);
  if (di > df) return res.status(400).json({ error: "Data Inicial não pode ser maior que Data Final." });

  try {
    const overlap = await pool.query(
      `SELECT id FROM km_values
        WHERE vehicle_type_id=$1 AND id<>$2
          AND NOT (data_fim < $3::date OR data_inicio > $4::date)`,
      [vehicleTypeId, req.params.id, di, df]
    );
    if (overlap.rows.length > 0)
      return res.status(400).json({ error: "Já existe um registro para este Tipo de Veículo no mesmo período." });

    const r = await pool.query(
      `UPDATE km_values
          SET vehicle_type_id=$1, data_inicio=$2, data_fim=$3, valor_km=$4, updated_at=NOW()
        WHERE id=$5
       RETURNING id,
                 vehicle_type_id              AS "vehicleTypeId",
                 TO_CHAR(data_inicio,'DD/MM/YYYY') AS "dataInicio",
                 TO_CHAR(data_fim,   'DD/MM/YYYY') AS "dataFim",
                 valor_km                     AS "valorKm"`,
      [vehicleTypeId, di, df, valorKm, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Não encontrado." });
    const row = r.rows[0];
    const vt = await pool.query("SELECT name FROM vehicle_types WHERE id=$1", [vehicleTypeId]);
    row.vehicleTypeName = vt.rows[0]?.name;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar valor de km." });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM km_values WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir valor de km." });
  }
});

module.exports = router;
