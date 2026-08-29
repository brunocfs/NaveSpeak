// Fábrica de "presença em salas" no Redis, reaproveitada tanto pela presença
// de canal (quem está com o canal aberto, presenceStore.js) quanto pelo
// roster de voz (quem está na chamada, voicePresence.js). As duas têm
// exatamente a mesma forma:
//
//   Hash  {namespace}:{roomId}  ->  field userId  ->  JSON { username, socketIds: [] }
//   Set   sock:{socketId}:{namespace}  ->  roomIds que esse socket entrou nesse namespace
//
// Um usuário pode ter vários sockets (várias abas/janelas) - só consideramos
// "saiu da sala" quando o ÚLTIMO socket dele sai. A atomicidade do add/remove
// de socketIds é garantida pelos scripts Lua presenceAdd/presenceRemove (ver
// config/redis.js), que são genéricos - não sabem se a chave é de presença de
// canal, roster de voz ou outra coisa. Isso é o que permite reaproveitar a
// mesma lógica em vez de duplicar um "voice roster store" do zero.
import { redis } from '../config/redis.js';

export function createRoomPresenceStore(namespace, roomKey) {
  const socketRoomsKey = (socketId) => `sock:${socketId}:${namespace}`;

  async function add(roomId, user, socketId) {
    try {
      await redis.presenceAdd(roomKey(roomId), user.id, socketId, user.username);
      await redis.sadd(socketRoomsKey(socketId), roomId);
    } catch {
      // Fail-open: sem Redis, a presença fica desativada mas o join no socket
      // (e o chat/voz) continuam funcionando.
    }
  }

  // Retorna true se o usuário ficou totalmente fora dessa sala (nesse namespace).
  async function remove(roomId, userId, socketId) {
    try {
      const left = await redis.presenceRemove(roomKey(roomId), userId, socketId);
      await redis.srem(socketRoomsKey(socketId), roomId);
      return left === 1;
    } catch {
      return false;
    }
  }

  // Chamado no disconnect. Descobre, para cada sala que o socket participava
  // nesse namespace, qual userId possuía aquele socketId e remove
  // atomicamente. Retorna as salas cujo usuário ficou totalmente de fora
  // (para notificar os outros membros).
  async function removeSocketFromAll(socketId) {
    try {
      const affectedRooms = [];
      const roomIds = await redis.smembers(socketRoomsKey(socketId));

      for (const roomId of roomIds) {
        const hash = await redis.hgetall(roomKey(roomId));
        for (const [userId, raw] of Object.entries(hash)) {
          let entry;
          try {
            entry = JSON.parse(raw);
          } catch {
            continue;
          }
          if (Array.isArray(entry.socketIds) && entry.socketIds.includes(socketId)) {
            const left = await redis.presenceRemove(roomKey(roomId), userId, socketId);
            if (left === 1) affectedRooms.push(roomId);
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

  async function list(roomId) {
    try {
      const hash = await redis.hgetall(roomKey(roomId));
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

  return { add, remove, removeSocketFromAll, list };
}
