import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  channelCreateSchema,
  channelIdParamSchema,
} from '../validation/schemas.js';
import { loadRoomForMember } from './rooms.routes.js';
import { isRoomMember } from '../db/rooms.repo.js';
import { listChannelsForServer, findChannelById, createChannel } from '../db/channels.repo.js';

const router = Router({ mergeParams: true });
// loadRoomForMember valida o :roomId (servidor) e que o usuário é membro
// dele; o :channelId é validado/autorizado em loadChannelForMember.
router.use(requireAuth, loadRoomForMember);

router.get('/', async (req, res, next) => {
  try {
    const channels = await listChannelsForServer(req.room.id);
    return res.json({ channels });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(channelCreateSchema), async (req, res, next) => {
  try {
    const channel = await createChannel({
      serverId: req.room.id,
      type: req.body.type,
      name: req.body.name,
      topic: req.body.topic ?? null,
    });
    return res.status(201).json({ channel });
  } catch (err) {
    return next(err);
  }
});

// Middleware reutilizado por messages.routes (montado em /channels/:channelId):
// valida o :channelId, confirma que pertence ao servidor informado (quando
// houver req.room) e que o usuário é membro do servidor. A autorização real é
// sempre por membership no servidor - nunca só pelo formato do ID.
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

  req.channel = channel;
  return next();
}

export default router;
