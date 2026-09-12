import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { validateBody } from "../middleware/validate.js";
import { adminBroadcastCreateSchema } from "../validation/schemas.js";
import { parseTag, formatTag } from "../utils/discriminator.js";
import { findUserByPublicId, findUserByTag } from "../db/users.repo.js";
import { createPrivateMessage, createSystemBroadcast } from "../db/privateMessages.repo.js";
import { createBroadcastRecord, listBroadcasts } from "../db/systemBroadcasts.repo.js";
import { SYSTEM_PUBLIC_ID } from "../config/systemUser.js";
import { resolveAttachments } from "../utils/resolveAttachments.js";
import { logError } from "../observability/errors.js";

// Painel admin de comunicados oficiais ("Zeno, o Astronauta") - único lugar
// do backend que consegue mandar mensagem COMO a conta de sistema (dm:send
// de socket normal recusa qualquer mensagem PRA ela, ver dm.handler.js, e
// nunca deixou de recusar mensagem DELA porque isso nunca passa por lá - a
// gravação é direta via privateMessages.repo.js). Tudo atrás de
// requireAdmin.
const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/", async (req, res, next) => {
  try {
    const broadcasts = await listBroadcasts();
    return res.json({
      broadcasts: broadcasts.map((b) => ({
        ...b,
        createdByTag: formatTag(b.createdByUsername, b.createdByDiscriminator),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/", validateBody(adminBroadcastCreateSchema), async (req, res, next) => {
  try {
    const { target, content } = req.body;
    const system = await findUserByPublicId(SYSTEM_PUBLIC_ID);
    if (!system) {
      return res.status(500).json({ error: "Conta do sistema não encontrada. Rode a migração." });
    }

    let attachments = [];
    if (req.body.attachments.length > 0) {
      const resolved = await resolveAttachments(req.body.attachments);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      attachments = resolved.attachments;
    }

    const io = req.app.get("io");

    if (target === "all") {
      const rows = await createSystemBroadcast({ senderId: system.id, content, attachments });
      for (const row of rows) {
        io.to(`user:${row.recipientPublicId}`).emit("dm:message", {
          id: row.id,
          content,
          created_at: row.createdAt,
          sender_id: SYSTEM_PUBLIC_ID,
          // Lido do banco (não da constante SYSTEM_USERNAME) - reflete na
          // hora um nome/foto trocados pelo painel de perfil do Zeno
          // (adminSystemUser.routes.js), sem precisar editar código.
          sender_username: system.username,
          senderAvatarPath: system.avatarPath,
          senderIsSystem: true,
          senderNameStyle: system.nameStyle,
          recipient_id: row.recipientPublicId,
          attachments,
        });
      }

      const record = await createBroadcastRecord({
        content,
        target: "all",
        recipientCount: rows.length,
        attachments,
        createdBy: req.user.internalId,
      });
      return res.json({ broadcast: record, recipientCount: rows.length });
    }

    // target === 'user'
    const parsed = parseTag(req.body.tag);
    if (!parsed) return res.status(400).json({ error: "Formato esperado: usuario#12345." });
    const recipient = await findUserByTag(parsed.username, parsed.discriminator);
    if (!recipient || recipient.isSystem) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    const message = await createPrivateMessage({
      senderId: system.id,
      recipientId: recipient.id,
      content,
      attachments,
    });
    io.to(`user:${recipient.publicId}`).emit("dm:message", message);

    const record = await createBroadcastRecord({
      content,
      target: "user",
      recipientPublicId: recipient.publicId,
      recipientCount: 1,
      attachments,
      createdBy: req.user.internalId,
    });
    return res.json({ broadcast: record, recipientCount: 1 });
  } catch (err) {
    logError("system_broadcast_failed", err, {}, "System broadcast could not be sent");
    return next(err);
  }
});

export default router;
