import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  roomNameSchema,
  inviteCodeSchema,
  roomIdParamSchema,
  roomUpdateSchema,
  serverSettingsUpdateSchema,
  userIdParamSchema,
} from '../validation/schemas.js';
import {
  createRoom,
  findRoomById,
  findRoomByInviteCode,
  listRoomsForUser,
  isRoomMember,
  addRoomMember,
  removeRoomMember,
  updateRoomProfile,
  regenerateInviteCode,
} from '../db/rooms.repo.js';
import { listChannelsForServer } from '../db/channels.repo.js';
import {
  listRolesForServer,
  listRoleIdsForUser,
  getUserPermissionBitmask,
  listMembersWithRoles,
} from '../db/roles.repo.js';
import { getServerSettings, updateServerSettings } from '../db/serverSettings.repo.js';
import { getUnreadCountsForServer, getUnreadCountsByServer } from '../db/messages.repo.js';
import { banUser, unbanUser, isBanned, listBans } from '../db/serverBans.repo.js';
import { findUserByPublicId } from '../db/users.repo.js';
import { decodeImageDataUrl } from '../utils/imageUpload.js';
import { PERMISSIONS, canAccessChannel, permissionKeysFor, isServerOwner } from '../utils/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const SERVER_ICON_DIR = path.join(UPLOADS_DIR, 'servers');
const MAX_ICON_BYTES = 2 * 1024 * 1024; // 2MB, já decodificado

const router = Router();
router.use(requireAuth);

// Middleware de rota: valida o :roomId como UUID e, mais importante, checa
// que o usuário autenticado é membro da sala ANTES de deixar qualquer rota
// abaixo responder com dados dela. É essa checagem - não o formato do ID -
// que impede a rota de "entregar dados pelo ID" para quem não deveria ver.
async function loadRoomForMember(req, res, next) {
  const parsedId = roomIdParamSchema.safeParse(req.params.roomId);
  if (!parsedId.success) {
    return res.status(400).json({ error: 'ID de sala inválido.' });
  }

  const room = await findRoomById(parsedId.data);
  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  const member = await isRoomMember(room.id, req.user.internalId);
  if (!member) {
    // 404 (não 403) para não confirmar a um não-membro que a sala existe.
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  req.room = room;
  return next();
}

router.get('/', async (req, res, next) => {
  try {
    const [rooms, unread] = await Promise.all([
      listRoomsForUser(req.user.internalId),
      getUnreadCountsByServer(req.user.internalId),
    ]);
    // unreadCount = total de mensagens não lidas do servidor (soma de todos
    // os canais de texto) - badge da lista de servidores na tela inicial.
    const unreadByServer = new Map(unread.map((r) => [r.serverId, r.count]));
    const roomsWithUnread = rooms.map((room) => ({
      ...room,
      unreadCount: unreadByServer.get(room.id) ?? 0,
    }));
    return res.json({ rooms: roomsWithUnread });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(roomNameSchema), async (req, res, next) => {
  try {
    // createdBy usa a PK interna (req.user.internalId); a resposta expõe o
    // public_id do criador (req.user.id) no campo created_by.
    const room = await createRoom({ name: req.body.name, createdBy: req.user.internalId });
    room.created_by = req.user.id;
    return res.status(201).json({ room });
  } catch (err) {
    return next(err);
  }
});

router.post('/join', validateBody(inviteCodeSchema), async (req, res, next) => {
  try {
    const room = await findRoomByInviteCode(req.body.inviteCode);
    if (!room) {
      return res.status(404).json({ error: 'Código de convite inválido.' });
    }
    if (await isBanned(room.id, req.user.internalId)) {
      return res.status(403).json({ error: 'Você foi banido deste servidor.' });
    }
    await addRoomMember({ roomId: room.id, userId: req.user.internalId });
    return res.status(200).json({ room });
  } catch (err) {
    return next(err);
  }
});

router.get('/:roomId', loadRoomForMember, async (req, res, next) => {
  try {
    const [members, channels, roles, settings, bitmask, roleIds, unread] = await Promise.all([
      listMembersWithRoles(req.room.id),
      listChannelsForServer(req.room.id),
      listRolesForServer(req.room.id),
      getServerSettings(req.room.id),
      getUserPermissionBitmask(req.room.id, req.user.internalId),
      listRoleIdsForUser(req.room.id, req.user.internalId),
      getUnreadCountsForServer(req.user.internalId, req.room.id),
    ]);

    // Só devolve canais que o usuário pode VER - dono/ADMINISTRATOR veem
    // todos (inclusive restritos, pra poder configurá-los). A checagem real
    // de acesso (mensagem/voz) é sempre refeita no servidor a cada ação -
    // isto aqui é só o que aparece na sidebar.
    const unreadByChannel = new Map(unread.map((r) => [r.channelId, r.count]));
    const visibleChannels = channels
      .filter((channel) =>
        canAccessChannel({ channel, room: req.room, user: req.user, bitmask, roleIds, action: 'view' })
      )
      .map((channel) => ({ ...channel, unreadCount: unreadByChannel.get(channel.id) ?? 0 }));

    return res.json({
      room: req.room,
      members,
      channels: visibleChannels,
      roles,
      settings,
      isOwner: isServerOwner(req.room, req.user),
      myPermissions: permissionKeysFor({ room: req.room, user: req.user, bitmask }),
    });
  } catch (err) {
    return next(err);
  }
});

router.patch(
  '/:roomId',
  loadRoomForMember,
  requirePermission(PERMISSIONS.MANAGE_SERVER),
  validateBody(roomUpdateSchema),
  async (req, res, next) => {
    try {
      const { name, icon } = req.body;
      let iconPath;

      if (icon !== undefined) {
        if (icon === null) {
          if (req.room.icon_path) {
            await fs.unlink(path.join(UPLOADS_DIR, req.room.icon_path)).catch(() => {});
          }
          iconPath = null;
        } else {
          const decoded = decodeImageDataUrl(icon, { maxBytes: MAX_ICON_BYTES });
          if (decoded.error) return res.status(400).json({ error: decoded.error });
          const relativePath = `servers/${req.room.id}.${decoded.ext}`;
          await fs.mkdir(SERVER_ICON_DIR, { recursive: true });
          await fs.writeFile(path.join(UPLOADS_DIR, relativePath), decoded.buffer);
          if (req.room.icon_path && req.room.icon_path !== relativePath) {
            await fs.unlink(path.join(UPLOADS_DIR, req.room.icon_path)).catch(() => {});
          }
          iconPath = relativePath;
        }
      }

      const room = await updateRoomProfile(req.room.id, { name, iconPath });
      return res.json({ room });
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  '/:roomId/settings',
  loadRoomForMember,
  requirePermission(PERMISSIONS.MANAGE_SERVER),
  validateBody(serverSettingsUpdateSchema),
  async (req, res, next) => {
    try {
      const settings = await updateServerSettings(req.room.id, req.body);
      return res.json({ settings });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/:roomId/invite/regenerate',
  loadRoomForMember,
  requirePermission(PERMISSIONS.CREATE_INVITE),
  async (req, res, next) => {
    try {
      const room = await regenerateInviteCode(req.room.id);
      return res.json({ room });
    } catch (err) {
      return next(err);
    }
  }
);

// Carrega e autoriza :userId (public_id) alvo de kick/ban - precisa existir
// como usuário (não precisa ser membro: banir alguém que já saiu também é
// válido, pra impedir reentrada).
async function loadTargetUser(req, res, next) {
  const parsedId = userIdParamSchema.safeParse(req.params.userId);
  if (!parsedId.success) return res.status(400).json({ error: 'ID de usuário inválido.' });
  const target = await findUserByPublicId(parsedId.data);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  req.targetUser = target;
  return next();
}

// Expulsar: só remove a membership atual - o convite antigo continua
// funcionando (distinto de banir, ver server_bans.repo.js).
router.delete(
  '/:roomId/members/:userId',
  loadRoomForMember,
  requirePermission(PERMISSIONS.BAN_MEMBERS),
  loadTargetUser,
  async (req, res, next) => {
    try {
      if (isServerOwner(req.room, { id: req.targetUser.publicId })) {
        return res.status(403).json({ error: 'Não é possível expulsar o criador do servidor.' });
      }
      await removeRoomMember(req.room.id, req.targetUser.id);
      req.app.get('io')?.to(`user:${req.targetUser.publicId}`).emit('server:removed', {
        roomId: req.room.id,
        reason: 'kick',
      });
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/:roomId/bans', loadRoomForMember, requirePermission(PERMISSIONS.BAN_MEMBERS), async (req, res, next) => {
  try {
    const bans = await listBans(req.room.id);
    return res.json({ bans });
  } catch (err) {
    return next(err);
  }
});

router.post(
  '/:roomId/bans/:userId',
  loadRoomForMember,
  requirePermission(PERMISSIONS.BAN_MEMBERS),
  loadTargetUser,
  async (req, res, next) => {
    try {
      if (isServerOwner(req.room, { id: req.targetUser.publicId })) {
        return res.status(403).json({ error: 'Não é possível banir o criador do servidor.' });
      }
      const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      await banUser({
        serverId: req.room.id,
        userId: req.targetUser.id,
        bannedBy: req.user.internalId,
        reason: rawReason ? rawReason.slice(0, 255) : null,
      });
      req.app.get('io')?.to(`user:${req.targetUser.publicId}`).emit('server:removed', {
        roomId: req.room.id,
        reason: 'ban',
      });
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

router.delete(
  '/:roomId/bans/:userId',
  loadRoomForMember,
  requirePermission(PERMISSIONS.BAN_MEMBERS),
  loadTargetUser,
  async (req, res, next) => {
    try {
      await unbanUser(req.room.id, req.targetUser.id);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

export { loadRoomForMember };
export default router;
