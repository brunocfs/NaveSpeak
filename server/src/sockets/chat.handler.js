import { isRoomMember } from "../db/rooms.repo.js";
import { findChannelById } from "../db/channels.repo.js";
import { createMessage } from "../db/messages.repo.js";
import { redis } from "../config/redis.js";
import {
  channelIdParamSchema,
  messageContentSchema,
} from "../validation/schemas.js";

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

    const contentResult = messageContentSchema.safeParse(payload?.content);
    if (!contentResult.success) {
      return ack({
        error: contentResult.error.issues[0]?.message ?? "Mensagem inválida.",
      });
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

    try {
      const message = await createMessage({
        channelId: channelId,
        userId: user.internalId,
        content: contentResult.data,
      });
      io.to(channelId).emit("chat:message", message);
      return ack({ ok: true, message });
    } catch (err) {
      console.error(err);
      return ack({ error: "Não foi possível enviar a mensagem." });
    }
  });
}
