import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger, serializeError, shouldLog } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';
import { classifyError } from '../observability/errors.js';

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

// Instrumentação de um cliente ioredis (o principal e os duplicates do
// adapter): conexão logada só na TRANSIÇÃO (conectou/caiu/voltou),
// reconexão e erro com limite de volume (o ioredis re-emite a cada tentativa),
// latência/erro por comando com o NOME do comando apenas - nunca chave, valor
// ou argumentos. O listener de 'error' também é o que impede o processo de
// crashar por erro de Redis - o app precisa continuar operando (degradado).
export function instrumentRedis(client, name) {
  let ready = false;
  let everReady = false;
  metrics.redisUp.set({ client: name }, 0);

  client.on('ready', () => {
    ready = true;
    metrics.redisUp.set({ client: name }, 1);
    logger.info(
      { event: everReady ? 'redis_connection_restored' : 'redis_connected', redis_client: name },
      everReady ? 'Redis connection restored' : 'Redis connected'
    );
    everReady = true;
  });
  client.on('close', () => {
    if (!ready) return;
    ready = false;
    metrics.redisUp.set({ client: name }, 0);
    logger.warn({ event: 'redis_connection_lost', redis_client: name }, 'Redis connection lost');
  });
  client.on('reconnecting', (delayMs) => {
    metrics.redisReconnects.inc({ client: name });
    const gate = shouldLog(`redis_reconnecting:${name}`, { max: 5 });
    if (gate) logger.warn({ ...gate, event: 'redis_reconnecting', redis_client: name, retry_delay_ms: delayMs }, 'Reconnecting to Redis');
  });
  client.on('error', (err) => {
    const c = classifyError(err, 'redis');
    metrics.redisErrors.inc({ client: name, error_code: c.error_code });
    const gate = shouldLog(`redis_connection_error:${name}:${c.error_code}`, { max: 5 });
    if (gate) {
      logger.error(
        { ...gate, event: 'redis_connection_error', redis_client: name, error_code: c.error_code, retryable: c.retryable, error: serializeError(err, { stack: false }) },
        'Redis client error'
      );
    }
  });

  const sendCommand = client.sendCommand.bind(client);
  client.sendCommand = (command, ...rest) => {
    const startedAt = performance.now();
    const result = sendCommand(command, ...rest);
    const operation = String(command?.name ?? 'unknown').toLowerCase();
    const observe = () => {
      const durationMs = performance.now() - startedAt;
      metrics.redisDuration.observe({ command: operation }, durationMs / 1000);
      return durationMs;
    };
    command?.promise?.then(
      () => {
        const durationMs = observe();
        if (durationMs >= env.LOG_SLOW_REDIS_COMMAND_MS) {
          const gate = shouldLog(`redis_command_slow:${name}:${operation}`);
          if (gate) {
            logger.warn(
              { ...gate, event: 'redis_command_slow', redis_client: name, operation, duration_ms: Math.round(durationMs), threshold_ms: env.LOG_SLOW_REDIS_COMMAND_MS },
              'Slow Redis command'
            );
          }
        }
      },
      (err) => {
        const durationMs = observe();
        // O próprio ioredis manda CLIENT SETINFO ao conectar e ignora a
        // recusa de Redis < 7.2 - não é falha da aplicação.
        if (operation === 'client' && err?.name === 'ReplyError') return;
        const c = classifyError(err, 'redis');
        metrics.redisErrors.inc({ client: name, error_code: c.error_code });
        const gate = shouldLog(`redis_command_failed:${name}:${operation}:${c.error_code}`, { max: 10 });
        if (gate) {
          logger.warn(
            {
              ...gate,
              event: 'redis_command_failed',
              redis_client: name,
              operation,
              duration_ms: Math.round(durationMs),
              error_code: c.error_code,
              retryable: c.retryable,
              error: serializeError(err, { stack: false }),
            },
            'Redis command failed'
          );
        }
      }
    );
    return result;
  };
  return client;
}

instrumentRedis(redis, 'main');

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
      logger.info(
        { event: 'redis_ephemeral_presence_reset', keys_deleted: allKeys.length },
        'Stale presence and voice roster keys from a previous run were removed'
      );
    }
  } catch (err) {
    // Fail-open: se o Redis não estiver acessível agora, os próprios
    // chamadores de presença já tratam erro individualmente depois.
    const c = classifyError(err, 'redis');
    logger.warn(
      { event: 'redis_ephemeral_presence_reset_failed', error_code: c.error_code, retryable: c.retryable, error: serializeError(err, { stack: false }) },
      'Could not reset stale presence keys on boot'
    );
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
    local discriminator = ARGV[4] or ''
    local avatarPath = ARGV[5] or ''
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
    entry.discriminator = discriminator
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
