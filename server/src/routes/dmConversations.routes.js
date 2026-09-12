import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listConversationPeers, getUnreadCounts } from "../db/privateMessages.repo.js";
import { getPublicStatus } from "../sockets/onlineStore.js";
import { formatTag } from "../utils/discriminator.js";

// Montado em index.js como app.use('/api/dm', router) - à parte de
// dm.routes.js (que é app.use('/api/dm/:userId', ...), mergeParams) porque
// aqui não há peer nenhum pra resolver: é a lista de TODAS as conversas do
// usuário logado, amigo ou não (ver listConversationPeers).
const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const [peers, unread] = await Promise.all([
      listConversationPeers(req.user.internalId),
      getUnreadCounts(req.user.internalId),
    ]);
    const unreadByPeer = new Map(unread.map((r) => [r.senderId, r.count]));

    const conversations = await Promise.all(
      peers.map(async (p) => {
        const status = await getPublicStatus(p.id);
        return {
          ...p,
          tag: formatTag(p.username, p.discriminator),
          status,
          online: status !== "offline",
          unreadCount: unreadByPeer.get(p.id) ?? 0,
        };
      }),
    );

    return res.json({ conversations });
  } catch (err) {
    return next(err);
  }
});

export default router;
