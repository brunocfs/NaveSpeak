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

// ---- Reconciliação no boot: limpa presença "fantasma" ----
//
// presence:*, voice:channel:*:members e sock:*:* guardam socketIds de
// conexões Socket.IO - e uma conexão morre junto com o processo que a
// aceitou (não sobrevive a um restart, seja um deploy, seja o
// `node --watch` do dev). Num boot de instância ÚNICA (o padrão: sem
// ENABLE_REDIS_ADAPTER não existe outra instância que possa ser dona
// legítima dessas entradas), qualquer coisa que sobrou no Redis de antes
// deste processo subir é necessariamente fantasma - ninguém está de fato
// conectado àqueles socketIds nunca mais. Sem essa limpeza, cada restart deixa
// um usuário "preso" para sempre no roster de voz (e a presença de canal),
// porque o socket que o listaria como saiu já não existe pra emitir o
// evento de saída.
//
// Em modo multi-instância (ENABLE_REDIS_ADAPTER=true) NÃO fazemos essa
// limpeza: outras instâncias podem ter usuários de verdade conectados nessas
// mesmas chaves, e apagar tudo derrubaria a presença deles também.
export async function resetEphemeralPresenceOnBoot() {
  if (env.ENABLE_REDIS_ADAPTER) return;
  try {
    const [presenceKeys, voiceKeys, sockKeys] = await Promise.all([
      redis.keys('presence:*'),
      redis.keys('voice:channel:*'),
      redis.keys('sock:*'),
    ]);
    const allKeys = [...presenceKeys, ...voiceKeys, ...sockKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
      console.log(`[redis] presença/roster de voz de uma execução anterior limpos (${allKeys.length} chave(s)).`);
    }
  } catch (err) {
    // Fail-open: se o Redis não estiver acessível agora, os próprios
    // chamadores de presença já tratam erro individualmente depois.
    console.error('[redis] falha ao limpar presença antiga no boot:', err.message);
  }
}

// ---- Presença: scripts Lua para atomicidade ----
// Várias abas/janelas do mesmo usuário geram vários socketIds na mesma sala.
// "offline" só ocorre quando o ÚLTIMO socket do usuário sai. Precisamos de
// atomicidade entre ler/adicionar/remover socketIds, por isso usamos Lua.

// KEYS[1] = presence:{roomId}
// ARGV[1] = userId, ARGV[2] = socketId, ARGV[3] = username, ARGV[4] = avatarPath
// (opcional - string vazia ou omitido = sem foto cadastrada).
redis.defineCommand('presenceAdd', {
  numberOfKeys: 1,
  lua: `
    local key = KEYS[1]
    local field = ARGV[1]
    local socketId = ARGV[2]
    local username = ARGV[3]
    local avatarPath = ARGV[4] or ''
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
    entry.avatarPath = avatarPath
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
