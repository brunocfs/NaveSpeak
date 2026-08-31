import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { userIdParamSchema } from '../validation/schemas.js';
import { findUserByPublicId } from '../db/users.repo.js';
import { isBlockedEitherDirection } from '../db/blocks.repo.js';
import { listConversation, clearConversation, markConversationRead } from '../db/privateMessages.repo.js';

// Montado em index.js como app.use('/api/dm/:userId', router) com
// mergeParams: true - :userId é o public_id do OUTRO usuário da conversa.
const router = Router({ mergeParams: true });
router.use(requireAuth);

// Valida o :userId e resolve o outro participante da conversa. Bloqueio em
// qualquer direção esconde a conversa por completo (mesmo 404 genérico de
// "não existe/você não pode ver") - não só impede novo envio.
async function loadPeer(req, res, next) {
  const parsed = userIdParamSchema.safeParse(req.params.userId);
  if (!parsed.success) return res.status(400).json({ error: 'ID de usuário inválido.' });

  const peer = await findUserByPublicId(parsed.data);
  if (!peer || peer.id === req.user.internalId) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  if (await isBlockedEitherDirection(req.user.internalId, peer.id)) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  req.peer = peer;
  return next();
}

router.use(loadPeer);

// Histórico paginado por cursor - o ENVIO de mensagens privadas acontece via
// WebSocket (sockets/dm.handler.js), mesmo padrão do chat de canal (ver
// routes/messages.routes.js).
router.get('/', async (req, res, next) => {
  try {
    const messages = await listConversation(req.user.internalId, req.peer.id, {
      limit: req.query.limit,
      beforeId: req.query.before,
    });
    return res.json({ messages });
  } catch (err) {
    return next(err);
  }
});

// Limpa o histórico só do lado de quem chama - não apaga nada nem afeta a
// visão do outro usuário (ver conversation_clears no schema).
router.delete('/', async (req, res, next) => {
  try {
    await clearConversation(req.user.internalId, req.peer.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Marca a conversa como lida (zera o badge de não lidas) - chamado ao abrir
// a conversa e, com ela já aberta, a cada mensagem nova recebida. Não
// esconde nenhuma mensagem, só avança o cursor de leitura.
router.post('/read', async (req, res, next) => {
  try {
    await markConversationRead(req.user.internalId, req.peer.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;
