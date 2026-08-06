const pool = require("../db");
const { mergePermissions } = require("../utils/permissions");

// Cache simples em memória por conjunto de perfis.
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getPermissions(profileIds) {
  const ids = [...new Set((Array.isArray(profileIds) ? profileIds : [profileIds]).filter(Boolean))].sort();
  const cacheKey = ids.join("|");
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.permissions;

  if (!ids.length) return {};
  const r = await pool.query("SELECT permissions FROM profiles WHERE id=ANY($1::uuid[])", [ids]);
  const permissions = mergePermissions(r.rows.map(row => row.permissions));
  cache[cacheKey] = { permissions, cachedAt: Date.now() };
  return permissions;
}

// Invalida cache quando perfil é alterado (chamar no PUT /profiles/:id)
function invalidateCache(profileId) {
  for (const key of Object.keys(cache)) {
    if (key.split("|").includes(profileId)) delete cache[key];
  }
}

const tokenProfileIds = user => user.profileIds?.length ? user.profileIds : [user.profileId].filter(Boolean);

// Middleware: canAccess("s19") — verifica view
//             canAccess("s19","edit") — verifica edit/insert/delete
function canAccess(screenId, action = "view") {
  return async (req, res, next) => {
    try {
      // Usuário Master tem acesso total
      if (req.user.isMaster) return next();

      const permissions = await getPermissions(tokenProfileIds(req.user));
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

// Verifica uma permissão específica. Mantida separada de canAccess para não
// alterar o comportamento legado das rotas que usam "edit" como permissão
// genérica de escrita.
function canAccessExact(screenId, action) {
  return async (req, res, next) => {
    try {
      if (req.user.isMaster) return next();

      const permissions = await getPermissions(tokenProfileIds(req.user));
      const screen = permissions[screenId];
      if (!screen?.view || !screen?.[action]) {
        return res.status(403).json({ error: "Você não tem permissão para esta operação." });
      }
      next();
    } catch (err) {
      console.error("[canAccessExact]", err.message);
      res.status(500).json({ error: "Erro ao verificar permissões." });
    }
  };
}

function canAccessAny(screenId, actions) {
  return async (req, res, next) => {
    try {
      if (req.user.isMaster) return next();

      const permissions = await getPermissions(tokenProfileIds(req.user));
      const screen = permissions[screenId];
      if (!screen?.view || !actions.some(action => screen?.[action])) {
        return res.status(403).json({ error: "Você não tem permissão para esta operação." });
      }
      next();
    } catch (err) {
      console.error("[canAccessAny]", err.message);
      res.status(500).json({ error: "Erro ao verificar permissões." });
    }
  };
}

// Permite leitura quando o usuário pode visualizar ao menos uma das telas
// informadas. Útil para consultas compartilhadas por telas operacionais e
// relatórios, sem conceder acesso às operações de cadastro.
function canAccessAnyScreen(screenIds) {
  return async (req, res, next) => {
    try {
      if (req.user.isMaster) return next();

      const permissions = await getPermissions(tokenProfileIds(req.user));
      if (!screenIds.some(screenId => permissions[screenId]?.view)) {
        return res.status(403).json({ error: "Acesso negado a esta funcionalidade." });
      }
      next();
    } catch (err) {
      console.error("[canAccessAnyScreen]", err.message);
      res.status(500).json({ error: "Erro ao verificar permissões." });
    }
  };
}

module.exports = { canAccess, canAccessExact, canAccessAny, canAccessAnyScreen, invalidateCache };
