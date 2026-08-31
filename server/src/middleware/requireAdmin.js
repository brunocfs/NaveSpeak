// Exige que req.user (já preenchido por requireAuth) seja admin da
// APLICAÇÃO (users.is_admin) - distinto das roles por servidor
// (middleware/permissions.js). Usado só pelo painel de convites
// (routes/invites.routes.js). Sem bootstrap automático: is_admin nasce
// false para todo mundo, promovido manualmente no banco (ver comentário em
// database/schema-postgre.sql).
export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  return next();
}
