import { isRoomMember } from '../db/rooms.repo.js';
import { createMessage } from '../db/messages.repo.js';
import { roomIdParamSchema, messageContentSchema } from '../validation/schemas.js';

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 15;

// Contenção simples de flood por socket (não substitui, mas complementa o
// rate limit HTTP - aqui é sobre volume de eventos em tempo real).
const sendTimestamps = new WeakMap();

function isRateLimited(socket) {
  const now = Date.now();
  const timestamps = (sendTimestamps.get(socket) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  sendTimestamps.set(socket, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_MESSAGES;
}

export function registerChatHandlers(io, socket) {
  const user = socket.data.user;

  socket.on('chat:send', async (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};

    if (isRateLimited(socket)) {
      return ack({ error: 'Você está enviando mensagens rápido demais. Aguarde um pouco.' });
    }

    const roomIdResult = roomIdParamSchema.safeParse(payload?.roomId);
    if (!roomIdResult.success) return ack({ error: 'ID de sala inválido.' });

    const contentResult = messageContentSchema.safeParse(payload?.content);
    if (!contentResult.success) {
      return ack({ error: contentResult.error.issues[0]?.message ?? 'Mensagem inválida.' });
    }

    const roomId = roomIdResult.data;

    // Checagem de membership no banco a cada envio - independe de o socket
    // "achar" que já entrou na sala (isso mata a rota de dados vazando por ID
    // também no transporte de socket, não só no REST).
    const member = await isRoomMember(roomId, user.id);
    if (!member) return ack({ error: 'Você não é membro dessa sala.' });

    try {
      const message = await createMessage({ roomId, userId: user.id, content: contentResult.data });
      io.to(roomId).emit('chat:message', message);
      return ack({ ok: true, message });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Não foi possível enviar a mensagem.' });
    }
  });
}
