// Status ONLINE global por usuário, independente de canal/servidor: um único
// Hash em vez de um por sala. Reaproveita os mesmos scripts Lua
// presenceAdd/presenceRemove (config/redis.js) que já garantem atomicidade
// entre múltiplos sockets (abas) do mesmo usuário - a forma do dado é
// idêntica à presença por sala (username + socketIds[]), só que com uma
// única chave fixa em vez de uma por roomId/channelId.
import { redis } from '../config/redis.js';

const ONLINE_KEY = 'presence:online:members';

export async function markOnline(user, socketId) {
  try {
    await redis.presenceAdd(ONLINE_KEY, user.id, socketId, user.username);
  } catch {
    // Fail-open: sem Redis, o status online fica desativado.
  }
}

// Retorna true se esse era o último socket do usuário (ele ficou offline).
export async function markOffline(userId, socketId) {
  try {
    return (await redis.presenceRemove(ONLINE_KEY, userId, socketId)) === 1;
  } catch {
    return false;
  }
}

export async function isOnline(userId) {
  try {
    return (await redis.hexists(ONLINE_KEY, userId)) === 1;
  } catch {
    return false;
  }
}

export async function listOnlineUserIds() {
  try {
    return await redis.hkeys(ONLINE_KEY);
  } catch {
    return [];
  }
}
