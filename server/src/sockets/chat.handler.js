import { isRoomMember, findRoomById } from "../db/rooms.repo.js";
import { findChannelById } from "../db/channels.repo.js";
import { createMessage } from "../db/messages.repo.js";
import { redis } from "../config/redis.js";
import { listRoleIdsForUser, getUserPermissionBitmask } from "../db/roles.repo.js";
import { canAccessChannel } from "../utils/permissions.js";
import {
  channelIdParamSchema,
  messageContentSchema,
  attachmentsArraySchema,
} from "../validation/schemas.js";
import { resolveAttachments } from "../utils/resolveAttachments.js";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 15;

// Contenção de flood por socket, compartilhada no Redis (funciona igual em
// várias instâncias). Contador com janela deslizante simples: INCR + EXPIRE
// no primeiro hit. Fail-open: se o Redis falhar, deixa passar (não trava o chat).
async function isRateLimited(socket) {
  const key = `ratelimit:socket:${socket.id}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
    return count > RATE_LIMIT_MAX_MESSAGES;
  } catch {
    return false;
  }
}

export function registerChatHandlers(io, socket) {
  const user = socket.data.user;

  socket.on("chat:send", async (payload, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};

    if (await isRateLimited(socket)) {
      return ack({
        error: "Você está enviando mensagens rápido demais. Aguarde um pouco.",
      });
    }

    const channelIdResult = channelIdParamSchema.safeParse(payload?.channelId);
    if (!channelIdResult.success) return ack({ error: "ID de canal inválido." });

    const attachmentsResult = attachmentsArraySchema.safeParse(payload?.attachments ?? []);
    if (!attachmentsResult.success) {
      return ack({ error: attachmentsResult.error.issues[0]?.message ?? "Anexo inválido." });
    }
    const hasAttachments = attachmentsResult.data.length > 0;

    // Conteúdo é opcional SE houver ao menos um anexo (mensagem só com
    // arquivo, sem texto) - senão continua obrigatório, mesma regra de
    // sempre.
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

    const channelId = channelIdResult.data;

    // O canal precisa existir, ser do tipo 'text' e o usuário precisa ser
    // membro do servidor dono do canal - tudo checado no banco a cada envio.
    const channel = await findChannelById(channelId);
    if (!channel) return ack({ error: "Canal não encontrado." });
    if (channel.type !== "text") {
      return ack({ error: "Este canal não aceita mensagens." });
    }
    const member = await isRoomMember(channel.server_id, user.internalId);
    if (!member) return ack({ error: "Você não é membro desse servidor." });

    const room = await findRoomById(channel.server_id);
    const [bitmask, roleIds] = await Promise.all([
      getUserPermissionBitmask(channel.server_id, user.internalId),
      listRoleIdsForUser(channel.server_id, user.internalId),
    ]);
    const canSend = canAccessChannel({ channel, room, user, bitmask, roleIds, action: "send" });
    if (!canSend) return ack({ error: "Você não tem permissão para enviar mensagens neste canal." });

    let attachments = [];
    if (hasAttachments) {
      const resolved = await resolveAttachments(attachmentsResult.data);
      if (resolved.error) return ack({ error: resolved.error });
      attachments = resolved.attachments;
    }

    try {
      const message = await createMessage({
        channelId: channelId,
        userId: user.internalId,
        content,
        attachments,
      });
      // Emite tanto para a room do CANAL (quem tem ele aberto agora, ver
      // presence.handler.js/channel:join) quanto para a room do SERVIDOR
      // (channel.server_id - todo socket já entra nela sozinho ao conectar,
      // ver online.handler.js) - é o que permite notificação desktop de
      // mensagem em canal que a pessoa não está olhando no momento
      // (NotificationContext.jsx), sem precisar "espiar" todo canal de todo
      // servidor sozinho. socket.io deduplica: quem está nas duas rooms
      // recebe o evento uma vez só. `serverId` vai junto no payload (a
      // mensagem em si não carrega isso) para o clique da notificação saber
      // pra qual /rooms/:roomId navegar.
      io.to(channelId).to(channel.server_id).emit("chat:message", { ...message, serverId: channel.server_id });
      return ack({ ok: true, message });
    } catch (err) {
      console.error(err);
      return ack({ error: "Não foi possível enviar a mensagem." });
    }
  });
}
