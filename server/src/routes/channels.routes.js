import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  channelCreateSchema,
  channelUpdateSchema,
  channelIdParamSchema,
} from '../validation/schemas.js';
import { loadRoomForMember } from './rooms.routes.js';
import { isRoomMember, findRoomById } from '../db/rooms.repo.js';
import {
  listChannelsForServer,
  findChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../db/channels.repo.js';
import { listRoleIdsForUser, getUserPermissionBitmask, assertRolesBelongToServer } from '../db/roles.repo.js';
import { PERMISSIONS, canAccessChannel } from '../utils/permissions.js';

const router = Router({ mergeParams: true });
// loadRoomForMember valida o :roomId (servidor) e que o usuário é membro
// dele; o :channelId é validado/autorizado em loadChannelForMember.
router.use(requireAuth, loadRoomForMember);

router.get('/', async (req, res, next) => {
  try {
    const channels = await listChannelsForServer(req.room.id);
    const [bitmask, roleIds] = await Promise.all([
      getUserPermissionBitmask(req.room.id, req.user.internalId),
      listRoleIdsForUser(req.room.id, req.user.internalId),
    ]);
    const visible = channels.filter((channel) =>
      canAccessChannel({ channel, room: req.room, user: req.user, bitmask, roleIds, action: 'view' })
    );
    return res.json({ channels: visible });
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/',
  requirePermission(PERMISSIONS.MANAGE_CHANNELS),
  validateBody(channelCreateSchema),
  async (req, res, next) => {
    try {
      const roleIds = [req.body.viewRoleId, req.body.sendRoleId, req.body.shareRoleId];
      if (!(await assertRolesBelongToServer(roleIds, req.room.id))) {
        return res.status(400).json({ error: 'Role inválida para este servidor.' });
      }
      const channel = await createChannel({
        serverId: req.room.id,
        type: req.body.type,
        name: req.body.name,
        topic: req.body.topic ?? null,
        viewRoleId: req.body.viewRoleId ?? null,
        sendRoleId: req.body.sendRoleId ?? null,
        shareRoleId: req.body.shareRoleId ?? null,
      });
      return res.status(201).json({ channel });
    } catch (err) {
      return next(err);
    }
  }
);

// Middleware reutilizado por messages.routes (montado em /channels/:channelId):
// valida o :channelId, confirma que pertence ao servidor informado (quando
// houver req.room) e que o usuário é membro do servidor E pode VER o canal
// (canAccessChannel action:'view' - dono/admin sempre passam, sem role
// exigida sempre passa, senão precisa ter a role). A autorização real é
// sempre por membership + acesso, nunca só pelo formato do ID.
export async function loadChannelForMember(req, res, next) {
  const parsedId = channelIdParamSchema.safeParse(req.params.channelId);
  if (!parsedId.success) {
    return res.status(400).json({ error: 'ID de canal inválido.' });
  }

  const channel = await findChannelById(parsedId.data);
  if (!channel) {
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  // Se vier de /rooms/:roomId/channels, garante que o canal é deste servidor.
  if (req.room && channel.server_id !== req.room.id) {
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  const member = await isRoomMember(channel.server_id, req.user.internalId);
  if (!member) {
    // 404 (não 403) para não confirmar a um não-membro que o canal existe.
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  const room = req.room ?? (await findRoomById(channel.server_id));
  const [bitmask, roleIds] = await Promise.all([
    getUserPermissionBitmask(channel.server_id, req.user.internalId),
    listRoleIdsForUser(channel.server_id, req.user.internalId),
  ]);
  const canView = canAccessChannel({ channel, room, user: req.user, bitmask, roleIds, action: 'view' });
  if (!canView) {
    // Mesmo raciocínio: 404 em vez de 403, não confirma que o canal existe
    // pra quem não tem a role exigida.
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  req.channel = channel;
  req.channelPermissions = { bitmask, roleIds };
  return next();
}

router.patch(
  '/:channelId',
  requirePermission(PERMISSIONS.MANAGE_CHANNELS),
  async (req, res, next) => {
    try {
      const parsedId = channelIdParamSchema.safeParse(req.params.channelId);
      if (!parsedId.success) return res.status(400).json({ error: 'ID de canal inválido.' });
      const existing = await findChannelById(parsedId.data);
      if (!existing || existing.server_id !== req.room.id) {
        return res.status(404).json({ error: 'Canal não encontrado.' });
      }
      const result = channelUpdateSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Dados inválidos.',
          details: result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
        });
      }
      const roleIds = [result.data.viewRoleId, result.data.sendRoleId, result.data.shareRoleId];
      if (!(await assertRolesBelongToServer(roleIds, req.room.id))) {
        return res.status(400).json({ error: 'Role inválida para este servidor.' });
      }
      const channel = await updateChannel(existing.id, result.data);
      return res.json({ channel });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete(
  '/:channelId',
  requirePermission(PERMISSIONS.MANAGE_CHANNELS),
  async (req, res, next) => {
    try {
      const parsedId = channelIdParamSchema.safeParse(req.params.channelId);
      if (!parsedId.success) return res.status(400).json({ error: 'ID de canal inválido.' });
      const existing = await findChannelById(parsedId.data);
      if (!existing || existing.server_id !== req.room.id) {
        return res.status(404).json({ error: 'Canal não encontrado.' });
      }
      await deleteChannel(existing.id);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
