import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { requirePermission } from '../middleware/permissions.js';
import { loadRoomForMember } from './rooms.routes.js';
import { isRoomMember } from '../db/rooms.repo.js';
import {
  roleCreateSchema,
  roleUpdateSchema,
  roleIdParamSchema,
  userIdParamSchema,
} from '../validation/schemas.js';
import {
  createRole,
  listRolesForServer,
  findRoleById,
  updateRole,
  deleteRole,
  assignRole,
  unassignRole,
} from '../db/roles.repo.js';
import { findUserByPublicId } from '../db/users.repo.js';
import { PERMISSIONS } from '../utils/permissions.js';

const router = Router({ mergeParams: true });
// loadRoomForMember valida o :roomId (servidor) e que o usuário é membro dele.
router.use(requireAuth, loadRoomForMember);

// Carrega e autoriza :roleId - garante que a role pertence a ESTE servidor
// (nunca só pelo formato do UUID), igual ao padrão de loadChannelForMember.
async function loadRole(req, res, next) {
  const parsedId = roleIdParamSchema.safeParse(req.params.roleId);
  if (!parsedId.success) return res.status(400).json({ error: 'ID de role inválido.' });

  const role = await findRoleById(parsedId.data);
  if (!role || role.server_id !== req.room.id) {
    return res.status(404).json({ error: 'Role não encontrada.' });
  }
  req.role = role;
  return next();
}

// GET é aberto a qualquer membro - o client precisa da lista de roles pra
// montar a lista de membros agrupada e os seletores de canal, mesmo sem
// poder editar nada.
router.get('/', async (req, res, next) => {
  try {
    const roles = await listRolesForServer(req.room.id);
    return res.json({ roles });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.ADMINISTRATOR), validateBody(roleCreateSchema), async (req, res, next) => {
  try {
    const role = await createRole({ serverId: req.room.id, ...req.body });
    return res.status(201).json({ role });
  } catch (err) {
    return next(err);
  }
});

router.patch(
  '/:roleId',
  requirePermission(PERMISSIONS.ADMINISTRATOR),
  loadRole,
  validateBody(roleUpdateSchema),
  async (req, res, next) => {
    try {
      const role = await updateRole(req.role.id, req.body);
      return res.json({ role });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/:roleId', requirePermission(PERMISSIONS.ADMINISTRATOR), loadRole, async (req, res, next) => {
  try {
    await deleteRole(req.role.id);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

// Carrega e autoriza :userId (public_id) - precisa ser membro DESTE servidor
// pra poder ganhar/perder uma role dele.
async function loadTargetMember(req, res, next) {
  const parsedId = userIdParamSchema.safeParse(req.params.userId);
  if (!parsedId.success) return res.status(400).json({ error: 'ID de usuário inválido.' });

  const target = await findUserByPublicId(parsedId.data);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const member = await isRoomMember(req.room.id, target.id);
  if (!member) return res.status(404).json({ error: 'Usuário não é membro deste servidor.' });

  req.targetUser = target;
  return next();
}

router.post(
  '/:roleId/members/:userId',
  requirePermission(PERMISSIONS.ADMINISTRATOR),
  loadRole,
  loadTargetMember,
  async (req, res, next) => {
    try {
      await assignRole(req.role.id, req.targetUser.id);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

router.delete(
  '/:roleId/members/:userId',
  requirePermission(PERMISSIONS.ADMINISTRATOR),
  loadRole,
  loadTargetMember,
  async (req, res, next) => {
    try {
      await unassignRole(req.role.id, req.targetUser.id);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
