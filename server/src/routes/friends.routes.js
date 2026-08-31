import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  userTagSchema,
  friendRequestIdParamSchema,
  userIdParamSchema,
} from '../validation/schemas.js';
import { findUserByTag, findUserByPublicId, findUserById } from '../db/users.repo.js';
import { parseTag, formatTag } from '../utils/discriminator.js';
import { getPublicStatus } from '../sockets/onlineStore.js';
import {
  sendFriendRequest,
  findFriendshipById,
  acceptFriendRequest,
  deleteFriendshipById,
  removeFriendBetween,
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
} from '../db/friends.repo.js';
import {
  blockUser,
  unblockUser,
  isBlockedEitherDirection,
  listBlockedUsers,
} from '../db/blocks.repo.js';
import { getUnreadCounts, getLastMessageTimestamps } from '../db/privateMessages.repo.js';

const router = Router();
router.use(requireAuth);

// Amigos offline aparecem igual aos online - só a ORDEM muda: online
// primeiro, dentro de cada grupo (online/offline) por conversa mais recente
// primeiro, e quem nunca trocou mensagem cai no fim de cada grupo (por data
// da amizade). Mesmo critério aplicado ao vivo no cliente (ver
// compareFriends em FriendsPanel.jsx) para a lista não desordenar sozinha
// entre um refetch e outro.
function compareFriends(a, b) {
  if (a.online !== b.online) return a.online ? -1 : 1;
  const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
  const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
  if (at !== bt) return bt - at;
  return new Date(b.since).getTime() - new Date(a.since).getTime();
}

router.get('/', async (req, res, next) => {
  try {
    const [friends, unread, lastMessages] = await Promise.all([
      listFriends(req.user.internalId),
      getUnreadCounts(req.user.internalId),
      getLastMessageTimestamps(req.user.internalId),
    ]);
    const unreadBySender = new Map(unread.map((r) => [r.senderId, r.count]));
    const lastMessageByPeer = new Map(lastMessages.map((r) => [r.peerId, r.lastMessageAt]));

    // Status é lido do Redis (sockets/onlineStore.js - já colapsa
    // 'invisible' pra 'offline'), não lidas vem do cursor de leitura
    // (conversation_clears) e a data da última mensagem, de
    // private_messages - os três são só o snapshot inicial; dali em diante o
    // cliente acompanha por presence:status e dm:message (ver
    // FriendsPanel.jsx).
    const withStatus = await Promise.all(
      friends.map(async (f) => {
        const status = await getPublicStatus(f.id);
        return {
          ...f,
          tag: formatTag(f.username, f.discriminator),
          status,
          online: status !== 'offline',
          unreadCount: unreadBySender.get(f.id) ?? 0,
          lastMessageAt: lastMessageByPeer.get(f.id) ?? null,
        };
      })
    );
    withStatus.sort(compareFriends);
    return res.json({ friends: withStatus });
  } catch (err) {
    return next(err);
  }
});

router.get('/requests', async (req, res, next) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      listIncomingRequests(req.user.internalId),
      listOutgoingRequests(req.user.internalId),
    ]);
    return res.json({ incoming, outgoing });
  } catch (err) {
    return next(err);
  }
});

router.get('/blocks', async (req, res, next) => {
  try {
    const blocked = await listBlockedUsers(req.user.internalId);
    return res.json({ blocked });
  } catch (err) {
    return next(err);
  }
});

// Envia uma solicitação de amizade pelo identificador público único
// "username#12345" (não por ID - o usuário comum não sabe o public_id de
// ninguém, e username sozinho pode pertencer a várias contas - ver
// discriminator em db/users.repo.js). A amizade só se concretiza quando o
// destinatário aceitar em /requests/:requestId/accept.
router.post('/requests', validateBody(userTagSchema), async (req, res, next) => {
  try {
    const { username, discriminator } = parseTag(req.body.tag);
    const target = await findUserByTag(username, discriminator);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.id === req.user.internalId) {
      return res.status(400).json({ error: 'Você não pode adicionar a si mesmo.' });
    }
    if (await isBlockedEitherDirection(req.user.internalId, target.id)) {
      return res.status(403).json({ error: 'Não foi possível enviar a solicitação.' });
    }

    const result = await sendFriendRequest(req.user.internalId, target.id);
    const io = req.app.get('io');

    if (result.alreadyFriends) {
      return res.status(409).json({ error: 'Vocês já são amigos.' });
    }
    if (result.alreadyPending) {
      return res.status(409).json({ error: 'Solicitação já enviada.' });
    }
    if (result.autoAccepted) {
      // O destinatário já tinha te chamado antes - virou amigo na hora.
      io?.to(`user:${target.publicId}`).emit('friend:accepted', {
        userId: req.user.id,
        username: req.user.username,
      });
      return res.status(200).json({ friendship: result.row, autoAccepted: true });
    }

    io?.to(`user:${target.publicId}`).emit('friend:request', {
      requestId: result.row.id,
      userId: req.user.id,
      username: req.user.username,
    });
    return res.status(201).json({ friendship: result.row });
  } catch (err) {
    return next(err);
  }
});

// Carrega e autoriza uma solicitação PENDENTE em que o usuário autenticado é
// uma das partes (remetente ou destinatário) - nunca confia só no formato do
// :requestId.
async function loadOwnPendingRequest(req, res, next) {
  const parsed = friendRequestIdParamSchema.safeParse(req.params.requestId);
  if (!parsed.success) return res.status(400).json({ error: 'ID de solicitação inválido.' });

  const request = await findFriendshipById(parsed.data);
  if (
    !request ||
    request.status !== 'pending' ||
    (request.requester_id !== req.user.internalId && request.addressee_id !== req.user.internalId)
  ) {
    // 404 genérico também para "existe mas não é sua" - não confirma a
    // existência da solicitação a quem não é parte dela.
    return res.status(404).json({ error: 'Solicitação não encontrada.' });
  }
  req.friendRequest = request;
  return next();
}

router.post('/requests/:requestId/accept', loadOwnPendingRequest, async (req, res, next) => {
  try {
    if (req.friendRequest.addressee_id !== req.user.internalId) {
      return res.status(403).json({ error: 'Só o destinatário pode aceitar a solicitação.' });
    }
    const friendship = await acceptFriendRequest(req.friendRequest.id);
    const requester = await findUserById(req.friendRequest.requester_id);

    const io = req.app.get('io');
    io?.to(`user:${requester.publicId}`).emit('friend:accepted', {
      userId: req.user.id,
      username: req.user.username,
    });

    return res.json({
      friendship,
      friend: { id: requester.publicId, username: requester.username },
    });
  } catch (err) {
    return next(err);
  }
});

// Recusar uma solicitação recebida e cancelar uma enviada são a mesma
// operação (apagar a linha pendente) - qualquer uma das partes pode fazer.
router.post('/requests/:requestId/decline', loadOwnPendingRequest, async (req, res, next) => {
  try {
    await deleteFriendshipById(req.friendRequest.id);

    const otherPartyInternalId =
      req.friendRequest.requester_id === req.user.internalId
        ? req.friendRequest.addressee_id
        : req.friendRequest.requester_id;
    const otherParty = await findUserById(otherPartyInternalId);

    const io = req.app.get('io');
    if (otherParty) {
      io?.to(`user:${otherParty.publicId}`).emit('friend:request_closed', {
        requestId: req.friendRequest.id,
      });
    }

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.delete('/:friendId', async (req, res, next) => {
  try {
    const parsed = userIdParamSchema.safeParse(req.params.friendId);
    if (!parsed.success) return res.status(400).json({ error: 'ID de usuário inválido.' });

    const friend = await findUserByPublicId(parsed.data);
    if (!friend) return res.status(404).json({ error: 'Usuário não encontrado.' });

    await removeFriendBetween(req.user.internalId, friend.id);

    const io = req.app.get('io');
    io?.to(`user:${friend.publicId}`).emit('friend:removed', { userId: req.user.id });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Bloquear por tag, igual ao pedido de amizade - remove a amizade existente
// entre os dois (se houver) e passa a impedir nova solicitação e nova
// mensagem privada nos dois sentidos.
router.post('/blocks', validateBody(userTagSchema), async (req, res, next) => {
  try {
    const { username, discriminator } = parseTag(req.body.tag);
    const target = await findUserByTag(username, discriminator);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.id === req.user.internalId) {
      return res.status(400).json({ error: 'Você não pode bloquear a si mesmo.' });
    }

    await blockUser(req.user.internalId, target.id);

    const io = req.app.get('io');
    io?.to(`user:${target.publicId}`).emit('friend:removed', { userId: req.user.id });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.delete('/blocks/:userId', async (req, res, next) => {
  try {
    const parsed = userIdParamSchema.safeParse(req.params.userId);
    if (!parsed.success) return res.status(400).json({ error: 'ID de usuário inválido.' });

    const target = await findUserByPublicId(parsed.data);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    await unblockUser(req.user.internalId, target.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;
