import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadRoomForMember } from './rooms.routes.js';
import { listMessagesForRoom } from '../db/messages.repo.js';

// Montado em index.js como app.use('/rooms/:roomId/messages', router) com
// mergeParams: true, então req.params.roomId chega aqui normalmente.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadRoomForMember);

// Histórico de mensagens (paginado por cursor). O envio de novas mensagens
// acontece via WebSocket (sockets/chat.handler.js) para entrega em tempo
// real; esta rota serve só para carregar o histórico ao entrar na sala.
router.get('/', async (req, res, next) => {
  try {
    const messages = await listMessagesForRoom(req.room.id, {
      limit: req.query.limit,
      beforeId: req.query.before,
    });
    return res.json({ messages });
  } catch (err) {
    return next(err);
  }
});

export default router;
