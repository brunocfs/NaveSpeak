import { findUserByPublicId } from "../db/users.repo.js";
import { areFriends } from "../db/friends.repo.js";
import { isBlockedEitherDirection } from "../db/blocks.repo.js";
import { createPrivateMessage } from "../db/privateMessages.repo.js";
import { redis } from "../config/redis.js";
import { userIdParamSchema, messageContentSchema, attachmentsArraySchema } from "../validation/schemas.js";
import { resolveAttachments } from "../utils/resolveAttachments.js";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 15;

// Mesma contenção de flood do chat de canal (chat.handler.js), chave própria
// para não compartilhar o mesmo orçamento de 15 mensagens/10s.
async function isRateLimited(socket) {
  const key = `ratelimit:dm:socket:${socket.id}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
    return count > RATE_LIMIT_MAX_MESSAGES;
  } catch {
    return false;
  }
}

export function registerDmHandlers(io, socket) {
  const user = socket.data.user;

  // Indicador de "está digitando" na DM - mesmo repasse efêmero de
  // chat.handler.js, mas entregue só na room pessoal do destinatário
  // (user:<publicId>, ver online.handler.js): nunca ecoa pra própria room do
  // remetente, então não precisa filtrar client-side por "sou eu mesmo".
  // Mesma checagem de bloqueio/amizade do dm:send - conversa pode ter sido
  // desfeita desde que o campo de texto foi aberto.
  socket.on("dm:typing", async (payload) => {
    const peerIdResult = userIdParamSchema.safeParse(payload?.userId);
    if (!peerIdResult.success) return;
    const typing = Boolean(payload?.typing);

    const peer = await findUserByPublicId(peerIdResult.data);
    if (!peer || peer.id === user.internalId) return;
    if (await isBlockedEitherDirection(user.internalId, peer.id)) return;
    if (!(await areFriends(user.internalId, peer.id))) return;

    io.to(`user:${peer.publicId}`).emit("dm:typing", {
      userId: user.id,
      username: user.username,
      typing,
    });
  });

  socket.on("dm:send", async (payload, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};

    if (await isRateLimited(socket)) {
      return ack({
        error: "Você está enviando mensagens rápido demais. Aguarde um pouco.",
      });
    }

    const peerIdResult = userIdParamSchema.safeParse(payload?.userId);
    if (!peerIdResult.success) return ack({ error: "ID de usuário inválido." });

    const attachmentsResult = attachmentsArraySchema.safeParse(payload?.attachments ?? []);
    if (!attachmentsResult.success) {
      return ack({ error: attachmentsResult.error.issues[0]?.message ?? "Anexo inválido." });
    }
    const hasAttachments = attachmentsResult.data.length > 0;

    // Mesma regra de chat.handler.js: conteúdo só é obrigatório se não
    // houver anexo nenhum.
    const rawContent = typeof payload?.content === "string" ? payload.content : "";
    let content = "";
    if (rawContent.trim().length > 0) {
      const contentResult = messageContentSchema.safeParse(rawContent);
      if (!contentResult.success) {
        return ack({
          error: contentResult.error.issues[0]?.message ?? "Mensagem inválida.",
        });
      }
      content = contentResult.data;
    } else if (!hasAttachments) {
      return ack({ error: "Mensagem vazia." });
    }

    const peer = await findUserByPublicId(peerIdResult.data);
    if (!peer || peer.id === user.internalId) {
      return ack({ error: "Usuário não encontrado." });
    }

    // Bloqueio em qualquer direção e "não são amigos" são checados a cada
    // envio (nunca só uma vez no client) - amizade pode ter sido desfeita ou
    // um bloqueio pode ter acontecido depois que a conversa foi aberta.
    if (await isBlockedEitherDirection(user.internalId, peer.id)) {
      return ack({ error: "Não é possível enviar mensagem para este usuário." });
    }
    if (!(await areFriends(user.internalId, peer.id))) {
      return ack({ error: "Vocês precisam ser amigos para conversar." });
    }

    let attachments = [];
    if (hasAttachments) {
      const resolved = await resolveAttachments(attachmentsResult.data);
      if (resolved.error) return ack({ error: resolved.error });
      attachments = resolved.attachments;
    }

    try {
      const message = await createPrivateMessage({
        senderId: user.internalId,
        recipientId: peer.id,
        content,
        attachments,
      });
      // Entrega para as duas "rooms pessoais" (user:<publicId>, ver
      // online.handler.js) - cobre todas as abas/janelas de ambos os lados.
      io.to(`user:${user.id}`).to(`user:${peer.publicId}`).emit("dm:message", message);
      return ack({ ok: true, message });
    } catch (err) {
      console.error(err);
      return ack({ error: "Não foi possível enviar a mensagem." });
    }
  });
}
