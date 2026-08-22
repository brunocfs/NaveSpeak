import { Redis } from 'ioredis';
import { env } from './env.js';

// Cliente Redis compartilhado. `maxRetriesPerRequest: null` é exigido pelo
// @socket.io/redis-adapter (sem ele o adapter reclama). `lazyConnect` evita
// abrir conexão no import - a primeira chamada (ou o adapter) conecta sob
// demanda. Se o REDIS_URL não estiver acessível, os comandos vão falhar e os
// chamadores (rate limit, presença, cache) tratam o erro sem derrubar o server.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  // Não deixamos o processo crashar por erro de Redis - o app precisa continuar
  // operando (degradado) se o Redis cair.
  console.error('[redis] erro de conexão:', err.message);
});

// ---- Presença: scripts Lua para atomicidade ----
// Várias abas/janelas do mesmo usuário geram vários socketIds na mesma sala.
// "offline" só ocorre quando o ÚLTIMO socket do usuário sai. Precisamos de
// atomicidade entre ler/adicionar/remover socketIds, por isso usamos Lua.

// KEYS[1] = presence:{roomId}
// ARGV[1] = userId, ARGV[2] = socketId, ARGV[3] = username
redis.defineCommand('presenceAdd', {
  numberOfKeys: 1,
  lua: `
    local key = KEYS[1]
    local field = ARGV[1]
    local socketId = ARGV[2]
    local username = ARGV[3]
    local raw = redis.call('HGET', key, field)
    local entry
    if raw then
      entry = cjson.decode(raw)
    else
      entry = { username = username, socketIds = {} }
    end
    local found = false
    for i = 1, #entry.socketIds do
      if entry.socketIds[i] == socketId then found = true end
    end
    if not found then
      table.insert(entry.socketIds, socketId)
    end
    entry.username = username
    redis.call('HSET', key, field, cjson.encode(entry))
    return 1
  `,
});

// KEYS[1] = presence:{roomId}
// ARGV[1] = userId, ARGV[2] = socketId
// Retorna 1 se o usuário ficou totalmente offline (último socket saiu), 0 caso contrário.
redis.defineCommand('presenceRemove', {
  numberOfKeys: 1,
  lua: `
    local key = KEYS[1]
    local field = ARGV[1]
    local socketId = ARGV[2]
    local raw = redis.call('HGET', key, field)
    if not raw then return 0 end
    local entry = cjson.decode(raw)
    local newSockets = {}
    for i = 1, #entry.socketIds do
      if entry.socketIds[i] ~= socketId then
        table.insert(newSockets, entry.socketIds[i])
      end
    end
    local becameOffline = false
    if #newSockets == 0 then
      redis.call('HDEL', key, field)
      becameOffline = true
    else
      entry.socketIds = newSockets
      redis.call('HSET', key, field, cjson.encode(entry))
    end
    if redis.call('HLEN', key) == 0 then
      redis.call('DEL', key)
    end
    return becameOffline and 1 or 0
  `,
});
