const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, ...args) {
  if (LEVELS[level] > current) return;
  const ts = new Date().toISOString();
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

module.exports = {
  info:  (...a) => log("info",  ...a),
  warn:  (...a) => log("warn",  ...a),
  error: (...a) => log("error", ...a),
  debug: (...a) => log("debug", ...a),
};
