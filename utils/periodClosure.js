const pool = require("../db");

const SCREEN_KEYS = {
  ESCALAS: "SOBREAVISO_EXTRA",
  EXTRA_AVULSO: "EXTRA_AVULSO",
  REGISTRO_KM: "REGISTRO_KM",
  FOLGAS: "CONTROLE_FOLGAS",
  INDICADORES: "LANCAMENTO_INDICADOR",
};

const CLOSED_MESSAGE = "Não é possível realizar esta operação porque o período está fechado.";

async function isDateClosed(screenKey, date) {
  const r = await pool.query(
    `SELECT 1 FROM period_closures
      WHERE screen_key=$1 AND $2::date BETWEEN date_start AND date_end
      LIMIT 1`,
    [screenKey, date]
  );
  return r.rowCount > 0;
}

async function isEscalaClosed(escalaId) {
  const r = await pool.query(
    "SELECT 1 FROM period_closures WHERE screen_key=$1 AND escala_id=$2 LIMIT 1",
    [SCREEN_KEYS.ESCALAS, escalaId]
  );
  return r.rowCount > 0;
}

async function hasClosedEscalaForTeamsAndPeriod(teamIds, dateStart, dateEnd, excludeEscalaId = null) {
  const r = await pool.query(
    `SELECT 1
       FROM period_closures pc
       JOIN escalas e ON e.id=pc.escala_id
       JOIN escala_equipes ee ON ee.escala_id=e.id
      WHERE pc.screen_key=$1
        AND e.data_inicio=$2::date AND e.data_fim=$3::date
        AND ee.team_id=ANY($4::uuid[])
        AND ($5::uuid IS NULL OR e.id<>$5::uuid)
      LIMIT 1`,
    [SCREEN_KEYS.ESCALAS, dateStart, dateEnd, teamIds, excludeEscalaId]
  );
  return r.rowCount > 0;
}

module.exports = { SCREEN_KEYS, CLOSED_MESSAGE, isDateClosed, isEscalaClosed, hasClosedEscalaForTeamsAndPeriod };
