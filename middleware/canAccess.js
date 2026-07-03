const pool = require("../db");

// Cache simples em memória: { profileId: { permissions, cachedAt } }
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getPermissions(profileId) {
  const cached = cache[profileId];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.permissions;

  const r = await pool.query("SELECT permissions FROM profiles WHERE id=$1", [profileId]);
  const permissions = r.rows[0]?.permissions || {};
  cache[profileId] = { permissions, cachedAt: Date.now() };
  return permissions;
}

// Invalida cache quando perfil é alterado (chamar no PUT /profiles/:id)
function invalidateCache(profileId) {
  delete cache[profileId];
}

// Middleware: canAccess("s19") — verifica view
//             canAccess("s19","edit") — verifica edit/insert/delete
function canAccess(screenId, action = "view") {
  return async (req, res, next) => {
    try {
      // Usuário Master tem acesso total
      if (req.user.isMaster) return next();

      const permissions = await getPermissions(req.user.profileId);
      const screen = permissions[screenId];

      if (!screen?.view) {
        return res.status(403).json({ error: "Acesso negado a esta funcionalidade." });
      }

      if (action === "edit" && !screen.edit && !screen.insert && !screen.delete) {
        return res.status(403).json({ error: "Você não tem permissão para esta operação." });
      }

      next();
    } catch (err) {
      console.error("[canAccess]", err.message);
      res.status(500).json({ error: "Erro ao verificar permissões." });
    }
  };
}

module.exports = { canAccess, invalidateCache };
