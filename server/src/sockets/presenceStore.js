// Estado de presença no Redis (compartilhado entre instâncias do servidor).
//
// Modelo:
//   Hash  presence:{roomId}  ->  field userId  ->  JSON { username, socketIds: [] }
//   Set   sock:{socketId}:rooms  ->  roomIds que esse socket entrou
//
// Um usuário pode ter vários sockets (várias abas/janelas) - só consideramos
// "offline" quando o ÚLTIMO socket dele sai da sala. A atomicidade do
// add/remove de socketIds é garantida por scripts Lua (ver config/redis.js).
import { redis } from '../config/redis.js';

const presenceKey = (roomId) => `presence:${roomId}`;
const socketRoomsKey = (socketId) => `sock:${socketId}:rooms`;

export async function addPresence(roomId, user, socketId) {
  try {
    await redis.presenceAdd(presenceKey(roomId), user.id, socketId, user.username);
    await redis.sadd(socketRoomsKey(socketId), roomId);
  } catch {
    // Fail-open: sem Redis, a presença fica desativada mas o join no socket
    // (e o chat) continuam funcionando.
  }
}

// Retorna true se o usuário ficou totalmente offline nessa sala.
export async function removePresence(roomId, userId, socketId) {
  try {
    const offline = await redis.presenceRemove(presenceKey(roomId), userId, socketId);
    await redis.srem(socketRoomsKey(socketId), roomId);
    return offline === 1;
  } catch {
    return false;
  }
}

// Chamado no disconnect. Descobre, para cada sala que o socket participava,
// qual userId possuía aquele socketId e remove atomicamente. Retorna as salas
// cujo usuário ficou offline (para notificar os outros membros).
export async function removeSocketFromAllRooms(socketId) {
  try {
    const affectedRooms = [];
    const roomIds = await redis.smembers(socketRoomsKey(socketId));

    for (const roomId of roomIds) {
      const hash = await redis.hgetall(presenceKey(roomId));
      for (const [userId, raw] of Object.entries(hash)) {
        let entry;
        try {
          entry = JSON.parse(raw);
        } catch {
          continue;
        }
        if (Array.isArray(entry.socketIds) && entry.socketIds.includes(socketId)) {
          const offline = await redis.presenceRemove(presenceKey(roomId), userId, socketId);
          if (offline === 1) affectedRooms.push(roomId);
          break; // um socket só pertence a um usuário por sala
        }
      }
    }

    await redis.del(socketRoomsKey(socketId));
    return affectedRooms;
  } catch {
    return [];
  }
}

export async function listPresence(roomId) {
  try {
    const hash = await redis.hgetall(presenceKey(roomId));
    return Object.entries(hash).map(([userId, raw]) => {
      let username = userId;
      try {
        username = JSON.parse(raw).username ?? userId;
      } catch {
        /* mantém userId como fallback */
      }
      return { userId, username };
    });
  } catch {
    return [];
  }
}
