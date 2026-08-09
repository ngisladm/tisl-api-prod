const express = require("express");
const router = express.Router();
const pool = require("../db");
const auth = require("../middleware/auth");
const { canAccess, canAccessExact } = require("../middleware/canAccess");
const { SCREEN_KEYS } = require("../utils/periodClosure");

const LABELS = {
  [SCREEN_KEYS.ESCALAS]: "Sobreaviso/Extra",
  [SCREEN_KEYS.EXTRA_AVULSO]: "Extra Avulso",
  [SCREEN_KEYS.REGISTRO_KM]: "Registro de Km",
  [SCREEN_KEYS.FOLGAS]: "Controle de Folgas",
  [SCREEN_KEYS.INDICADORES]: "Lançamento de Indicador",
};
const DATE_SCREENS = Object.keys(LABELS).filter(key => key !== SCREEN_KEYS.ESCALAS);
const parseDate = value => {
  if (!value) return null;
  if (!value.includes("/")) return value;
  const [d,m,y] = value.split("/");
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
};

const SELECT = `SELECT pc.id, pc.screen_key AS "screenKey",
  TO_CHAR(pc.date_start,'DD/MM/YYYY') AS "dateStart",
  TO_CHAR(pc.date_end,'DD/MM/YYYY') AS "dateEnd",
  pc.escala_id AS "escalaId", pc.created_at AS "createdAt",
  e.company_id AS "companyId", c.name AS "companyName",
  TO_CHAR(e.data_inicio,'DD/MM/YYYY') AS "escalaDataInicio",
  TO_CHAR(e.data_fim,'DD/MM/YYYY') AS "escalaDataFim",
  COALESCE((SELECT STRING_AGG(t.name, ', ' ORDER BY t.name)
    FROM escala_equipes ee JOIN teams t ON t.id=ee.team_id WHERE ee.escala_id=e.id),'') AS "escalaEquipes"
  FROM period_closures pc
  LEFT JOIN escalas e ON e.id=pc.escala_id
  LEFT JOIN companies c ON c.id=e.company_id`;

router.get("/", auth, canAccess("s66"), async (req,res) => {
  try {
    const r = await pool.query(`${SELECT} ORDER BY pc.created_at DESC`);
    res.json(r.rows.map(row => ({...row, screenName:LABELS[row.screenKey]})));
  } catch (err) { console.error(err); res.status(500).json({error:"Erro ao buscar fechamentos de período."}); }
});

router.get("/escalas-options", auth, canAccess("s66"), async (req,res) => {
  try {
    const r = await pool.query(`SELECT e.id,
      TO_CHAR(e.data_inicio,'DD/MM/YYYY') AS "dataInicio", TO_CHAR(e.data_fim,'DD/MM/YYYY') AS "dataFim",
      COALESCE(STRING_AGG(t.name, ', ' ORDER BY t.name),'') AS "teamNamesStr",
      EXISTS(SELECT 1 FROM period_closures pc
        WHERE pc.screen_key=$1 AND pc.escala_id=e.id) AS "periodoFechado"
      FROM escalas e LEFT JOIN escala_equipes ee ON ee.escala_id=e.id LEFT JOIN teams t ON t.id=ee.team_id
      GROUP BY e.id ORDER BY e.data_inicio DESC, "teamNamesStr"`, [SCREEN_KEYS.ESCALAS]);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({error:"Erro ao buscar escalas."}); }
});

async function validate(body, currentId = null) {
  const { screenKey, dateStart, dateEnd, escalaId } = body;
  if (!LABELS[screenKey]) return "Tela inválida.";
  if (screenKey === SCREEN_KEYS.ESCALAS) {
    if (!escalaId) return "A escala é obrigatória.";
    const exists = await pool.query("SELECT 1 FROM escalas WHERE id=$1", [escalaId]);
    if (!exists.rowCount) return "Escala não encontrada.";
    const duplicate = await pool.query("SELECT 1 FROM period_closures WHERE screen_key=$1 AND escala_id=$2 AND ($3::uuid IS NULL OR id<>$3::uuid)", [screenKey, escalaId, currentId]);
    if (duplicate.rowCount) return "Esta escala já possui um fechamento de período.";
    return null;
  }
  if (!DATE_SCREENS.includes(screenKey) || !dateStart || !dateEnd) return "Data Inicial e Data Final são obrigatórias.";
  if (parseDate(dateStart) > parseDate(dateEnd)) return "A Data Inicial não pode ser maior que a Data Final.";
  return null;
}

router.post("/", auth, canAccessExact("s66","insert"), async (req,res) => {
  try {
    const error = await validate(req.body);
    if (error) return res.status(400).json({error});
    const {screenKey,dateStart,dateEnd,escalaId} = req.body;
    const r = await pool.query(`INSERT INTO period_closures(screen_key,date_start,date_end,escala_id,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [screenKey, screenKey===SCREEN_KEYS.ESCALAS?null:parseDate(dateStart), screenKey===SCREEN_KEYS.ESCALAS?null:parseDate(dateEnd), screenKey===SCREEN_KEYS.ESCALAS?escalaId:null, req.user.id]);
    const row = await pool.query(`${SELECT} WHERE pc.id=$1`, [r.rows[0].id]);
    res.status(201).json({...row.rows[0],screenName:LABELS[screenKey]});
  } catch(err) { console.error(err); res.status(500).json({error:"Erro ao criar fechamento de período."}); }
});

router.put("/:id", auth, canAccessExact("s66","edit"), async (req,res) => {
  try {
    const error = await validate(req.body, req.params.id);
    if (error) return res.status(400).json({error});
    const {screenKey,dateStart,dateEnd,escalaId} = req.body;
    const r = await pool.query(`UPDATE period_closures SET screen_key=$1,date_start=$2,date_end=$3,escala_id=$4,updated_at=NOW() WHERE id=$5 RETURNING id`,
      [screenKey,screenKey===SCREEN_KEYS.ESCALAS?null:parseDate(dateStart),screenKey===SCREEN_KEYS.ESCALAS?null:parseDate(dateEnd),screenKey===SCREEN_KEYS.ESCALAS?escalaId:null,req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:"Fechamento não encontrado."});
    const row = await pool.query(`${SELECT} WHERE pc.id=$1`, [req.params.id]);
    res.json({...row.rows[0],screenName:LABELS[screenKey]});
  } catch(err) { console.error(err); res.status(500).json({error:"Erro ao atualizar fechamento de período."}); }
});

router.delete("/:id", auth, canAccessExact("s66","delete"), async (req,res) => {
  try { await pool.query("DELETE FROM period_closures WHERE id=$1",[req.params.id]); res.json({success:true}); }
  catch(err) { console.error(err); res.status(500).json({error:"Erro ao excluir fechamento de período."}); }
});

module.exports = router;
