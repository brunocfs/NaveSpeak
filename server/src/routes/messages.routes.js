import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadChannelForMember } from './channels.routes.js';
import { listMessagesForChannel, markChannelRead } from '../db/messages.repo.js';

// Montado em index.js como app.use('/channels/:channelId/messages', router) com
// mergeParams: true, então req.params.channelId chega aqui normalmente.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadChannelForMember);

// Histórico de mensagens (paginado por cursor). O envio de novas mensagens
// acontece via WebSocket (sockets/chat.handler.js) para entrega em tempo
// real; esta rota serve só para carregar o histórico ao entrar no canal.
router.get('/', async (req, res, next) => {
  try {
    const messages = await listMessagesForChannel(req.channel.id, {
      limit: req.query.limit,
      beforeId: req.query.before,
    });
    return res.json({ messages });
  } catch (err) {
    return next(err);
  }
});

// Avança o cursor de leitura do canal para o usuário autenticado - chamado
// ao abrir o canal e, com ele já aberto, a cada mensagem nova (ver
// ChatPanel.jsx). Mesmo padrão de POST /dm/:userId/read.
router.post('/read', async (req, res, next) => {
  try {
    await markChannelRead(req.user.internalId, req.channel.id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
