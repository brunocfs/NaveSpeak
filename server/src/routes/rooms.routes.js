import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { roomNameSchema, inviteCodeSchema, roomIdParamSchema } from '../validation/schemas.js';
import {
  createRoom,
  findRoomById,
  findRoomByInviteCode,
  listRoomsForUser,
  isRoomMember,
  addRoomMember,
  listRoomMembers,
} from '../db/rooms.repo.js';

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

  const member = await isRoomMember(room.id, req.user.id);
  if (!member) {
    // 404 (não 403) para não confirmar a um não-membro que a sala existe.
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  req.room = room;
  return next();
}

router.get('/', async (req, res, next) => {
  try {
    const rooms = await listRoomsForUser(req.user.id);
    return res.json({ rooms });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(roomNameSchema), async (req, res, next) => {
  try {
    const room = await createRoom({ name: req.body.name, createdBy: req.user.id });
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
    await addRoomMember({ roomId: room.id, userId: req.user.id });
    return res.status(200).json({ room });
  } catch (err) {
    return next(err);
  }
});

router.get('/:roomId', loadRoomForMember, async (req, res, next) => {
  try {
    const members = await listRoomMembers(req.room.id);
    return res.json({ room: req.room, members });
  } catch (err) {
    return next(err);
  }
});

export { loadRoomForMember };
export default router;
