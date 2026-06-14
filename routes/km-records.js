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

const BASE_SELECT = `
  SELECT kr.id,
         TO_CHAR(kr.data,'DD/MM/YYYY') AS "data",
         kr.data                        AS "dataRaw",
         kr.company_id                 AS "companyId",
         kr.team_id                    AS "teamId",
         kr.user_id                    AS "userId",
         kr.vehicle_type_id            AS "vehicleTypeId",
         kr.total_km                   AS "totalKm",
         kr.valor_km                   AS "valorKm",
         kr.valor_total_km             AS "valorTotalKm",
         kr.justificativa,
         c.name AS "companyName",
         t.name AS "teamName",
         u.name AS "userName",
         vt.name AS "vehicleTypeName"
    FROM km_records kr
    JOIN companies    c  ON c.id  = kr.company_id
    JOIN teams        t  ON t.id  = kr.team_id
    JOIN users        u  ON u.id  = kr.user_id
    JOIN vehicle_types vt ON vt.id = kr.vehicle_type_id
`;

// GET /km-records/report  (must come before /:id)
router.get("/report", auth, async (req, res) => {
  const { dateFrom, dateTo, companyId, teamId, userId, vehicleTypeId } = req.query;
  const params = [];
  const where  = [];

  if (dateFrom) { params.push(parseDate(dateFrom)); where.push(`kr.data >= $${params.length}::date`); }
  if (dateTo)   { params.push(parseDate(dateTo));   where.push(`kr.data <= $${params.length}::date`); }
  if (companyId)     { params.push(companyId);     where.push(`kr.company_id = $${params.length}::uuid`); }
  if (teamId)        { params.push(teamId);        where.push(`kr.team_id   = $${params.length}::uuid`); }
  if (userId)        { params.push(userId);        where.push(`kr.user_id   = $${params.length}::uuid`); }
  if (vehicleTypeId) { params.push(vehicleTypeId); where.push(`kr.vehicle_type_id = $${params.length}::uuid`); }

  const sql = `${BASE_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.name, kr.data`;

  try {
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar relatório." });
  }
});

// GET /km-records
router.get("/", auth, async (req, res) => {
  try {
    const r = await pool.query(`${BASE_SELECT} ORDER BY kr.data DESC, u.name`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar registros de km." });
  }
});

// POST /km-records
router.post("/", auth, async (req, res) => {
  const { data, companyId, teamId, userId, vehicleTypeId, totalKm, justificativa } = req.body;
  if (!data || !companyId || !teamId || !userId || !vehicleTypeId || totalKm == null)
    return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });

  const reqUser2 = await pool.query("SELECT is_master FROM users WHERE id=$1", [req.user.id]);
  const isMaster2 = reqUser2.rows[0]?.is_master;
  if (!isMaster2 && userId !== req.user.id)
    return res.status(403).json({ error: "Você não pode inserir lançamentos para outro usuário." });

  const dt = parseDate(data);
  const tk = parseFloat(totalKm);

  const vkr = await pool.query(
    `SELECT valor_km FROM km_values
      WHERE vehicle_type_id=$1 AND data_inicio<=$2::date AND data_fim>=$2::date
      LIMIT 1`,
    [vehicleTypeId, dt]
  );
  const valorKm      = parseFloat(vkr.rows[0]?.valor_km || 0);
  const valorTotalKm = parseFloat((tk * valorKm).toFixed(2));

  try {
    const r = await pool.query(
      `INSERT INTO km_records
         (data, company_id, team_id, user_id, vehicle_type_id, km_inicial, km_final, total_km, valor_km, valor_total_km, justificativa)
       VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,$8,$9)
       RETURNING id`,
      [dt, companyId, teamId, userId, vehicleTypeId, tk, valorKm, valorTotalKm, justificativa||null]
    );
    const row = await pool.query(`${BASE_SELECT} WHERE kr.id=$1`, [r.rows[0].id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar registro de km." });
  }
});

// PUT /km-records/:id
router.put("/:id", auth, async (req, res) => {
  const reqUser = await pool.query("SELECT is_master FROM users WHERE id=$1", [req.user.id]);
  const isMaster = reqUser.rows[0]?.is_master;
  if (!isMaster) {
    const rec = await pool.query("SELECT user_id FROM km_records WHERE id=$1", [req.params.id]);
    if (!rec.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    if (rec.rows[0].user_id !== req.user.id)
      return res.status(403).json({ error: "Você só pode editar seus próprios lançamentos." });
  }

  const { data, companyId, teamId, userId, vehicleTypeId, totalKm, justificativa } = req.body;
  if (!data || !companyId || !teamId || !userId || !vehicleTypeId || totalKm == null)
    return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });

  const dt = parseDate(data);
  const tk = parseFloat(totalKm);

  const vkr = await pool.query(
    `SELECT valor_km FROM km_values
      WHERE vehicle_type_id=$1 AND data_inicio<=$2::date AND data_fim>=$2::date
      LIMIT 1`,
    [vehicleTypeId, dt]
  );
  const valorKm      = parseFloat(vkr.rows[0]?.valor_km || 0);
  const valorTotalKm = parseFloat((tk * valorKm).toFixed(2));

  try {
    const r = await pool.query(
      `UPDATE km_records
          SET data=$1, company_id=$2, team_id=$3, user_id=$4, vehicle_type_id=$5,
              total_km=$6, valor_km=$7, valor_total_km=$8, justificativa=$9, updated_at=NOW()
        WHERE id=$10`,
      [dt, companyId, teamId, userId, vehicleTypeId, tk, valorKm, valorTotalKm, justificativa||null, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Registro não encontrado." });
    const row = await pool.query(`${BASE_SELECT} WHERE kr.id=$1`, [req.params.id]);
    res.json(row.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar registro de km." });
  }
});

// DELETE /km-records/:id
router.delete("/:id", auth, async (req, res) => {
  const reqUser = await pool.query("SELECT is_master FROM users WHERE id=$1", [req.user.id]);
  const isMaster = reqUser.rows[0]?.is_master;
  if (!isMaster) {
    const rec = await pool.query("SELECT user_id FROM km_records WHERE id=$1", [req.params.id]);
    if (!rec.rows[0]) return res.status(404).json({ error: "Registro não encontrado." });
    if (rec.rows[0].user_id !== req.user.id)
      return res.status(403).json({ error: "Você só pode excluir seus próprios lançamentos." });
  }
  try {
    await pool.query("DELETE FROM km_records WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao excluir registro de km." });
  }
});

module.exports = router;
