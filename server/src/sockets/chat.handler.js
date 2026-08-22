import { isRoomMember } from "../db/rooms.repo.js";
import { createMessage } from "../db/messages.repo.js";
import { redis } from "../config/redis.js";
import {
  roomIdParamSchema,
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

    const roomIdResult = roomIdParamSchema.safeParse(payload?.roomId);
    if (!roomIdResult.success) return ack({ error: "ID de sala inválido." });

    const contentResult = messageContentSchema.safeParse(payload?.content);
    if (!contentResult.success) {
      return ack({
        error: contentResult.error.issues[0]?.message ?? "Mensagem inválida.",
      });
    }

    const roomId = roomIdResult.data;

    // Checagem de membership no banco a cada envio - independe de o socket
    // "achar" que já entrou na sala (isso mata a rota de dados vazando por ID
    // também no transporte de socket, não só no REST).
    const member = await isRoomMember(roomId, user.internalId);
    if (!member) return ack({ error: "Você não é membro dessa sala." });

    try {
      const message = await createMessage({
        roomId: roomId,
        userId: user.internalId,
        content: contentResult.data,
      });
      io.to(roomId).emit("chat:message", message);
      return ack({ ok: true, message });
    } catch (err) {
      console.error(err);
      return ack({ error: "Não foi possível enviar a mensagem." });
    }
  });
}
