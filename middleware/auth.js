const jwt = require("jsonwebtoken");

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ error: "Token não informado." });

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token inválido." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, name, email, profileId, companyId }
    next();
  } catch {
    return res.status(401).json({ error: "Token expirado ou inválido." });
  }
};
