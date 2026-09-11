// Middleware de autorização por permissão de servidor - usado DEPOIS de
// loadRoomForMember (rooms.routes.js), que já garante req.room e que
// req.user é membro. Guarda o bitmask calculado em req.serverPermissions
// para rotas que precisam dele além do check (ex.: GET /:roomId monta
// myPermissions a partir dele sem recalcular).
import { getUserPermissionBitmask } from '../db/roles.repo.js';
import { checkPermission, PERMISSIONS } from '../utils/permissions.js';

export const permissionName = (flag) => Object.keys(PERMISSIONS).find((key) => PERMISSIONS[key] === flag) ?? 'unknown';

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
        res.locals.log = {
          event: 'authorization_denied',
          reason_code: 'missing_permission',
          permission: permissionName(flag),
          room_id: req.room.id,
          level: 'warn',
          security_relevant: true,
        };
        return res.status(403).json({ error: 'Você não tem permissão para isso.' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
