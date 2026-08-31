// Middleware de autorização por permissão de servidor - usado DEPOIS de
// loadRoomForMember (rooms.routes.js), que já garante req.room e que
// req.user é membro. Guarda o bitmask calculado em req.serverPermissions
// para rotas que precisam dele além do check (ex.: GET /:roomId monta
// myPermissions a partir dele sem recalcular).
import { getUserPermissionBitmask } from '../db/roles.repo.js';
import { checkPermission } from '../utils/permissions.js';

export function requirePermission(flag) {
  return async (req, res, next) => {
    try {
      if (req.serverPermissions === undefined) {
        req.serverPermissions = await getUserPermissionBitmask(req.room.id, req.user.internalId);
      }
      const allowed = checkPermission({
        room: req.room,
        user: req.user,
        bitmask: req.serverPermissions,
        flag,
      });
      if (!allowed) {
        return res.status(403).json({ error: 'Você não tem permissão para isso.' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
