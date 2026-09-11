import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { redis, instrumentRedis } from '../config/redis.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { findUserByPublicId } from '../db/users.repo.js';
import { logger } from '../observability/logger.js';
import { instrumentConnection, logSocketAuthFailure } from '../observability/sockets.js';
import { onShutdown } from '../observability/shutdown.js';
import { registerPresenceHandlers } from './presence.handler.js';
import { registerChatHandlers } from './chat.handler.js';
import { registerMediasoupHandlers } from './mediasoup.handler.js';
import { registerOnlineHandlers } from './online.handler.js';
import { registerDmHandlers } from './dm.handler.js';
import { registerCallHandlers } from './calls.handler.js';

export function attachSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  // Primeiro passo do shutdown: para de aceitar conexão e derruba os sockets
  // (fecha também o httpServer). Os handlers de 'disconnect' (presença/roster
  // no Redis) são async e o socket.io não espera por eles - folga curta antes
  // de fechar Redis/PostgreSQL nos passos seguintes (registrados em index.js).
  onShutdown('socket_io', async () => {
    await new Promise((resolve) => io.close(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  // Ponto de extensão para multi-instância: quando ENABLE_REDIS_ADAPTER=true
  // (e REDIS_URL aponta para um Redis acessível), anexamos o adapter Redis.
  // Assim o broadcast de eventos (chat, presença) propaga entre várias
  // instâncias do servidor atrás de um load balancer.
  //
  // IMPORTANTE: o adapter Redis roteia ATÉ a entrega local pela pub/sub do
  // Redis. Se ligado sem Redis disponível, o chat em tempo real quebra - por
  // isso NÃO ativamos só por existir REDIS_URL. Em single-instance (padrão)
  // usamos o adapter em memória do socket.io, que funciona sem Redis. Para virar
  // multi, basta subir o Redis e definir ENABLE_REDIS_ADAPTER=true.
  if (env.ENABLE_REDIS_ADAPTER) {
    // Os duplicates não herdam listeners nem instrumentação do cliente
    // original - instrumentRedis registra o handler de 'error' (sem ele o
    // Node reclama "missing 'error' handler" e pode encerrar o processo).
    const pubClient = instrumentRedis(redis.duplicate(), 'adapter_pub');
    const subClient = instrumentRedis(redis.duplicate(), 'adapter_sub');
    io.adapter(createAdapter(pubClient, subClient));
    onShutdown('redis_adapter_clients', () => Promise.all([pubClient.quit(), subClient.quit()]));
    logger.info({ event: 'socket_adapter_configured', adapter: 'redis' }, 'Socket.IO Redis adapter enabled (multi-instance)');
  } else {
    logger.info(
      { event: 'socket_adapter_configured', adapter: 'memory' },
      'Socket.IO in-memory adapter enabled (single instance); set ENABLE_REDIS_ADAPTER=true for multi-instance'
    );
  }

  // Todo socket precisa apresentar um access token JWT válido no handshake
  // (client envia via `auth: { token }`) - sem isso, a conexão é recusada
  // antes de qualquer handler rodar.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      logSocketAuthFailure(socket, 'missing_token');
      return next(new Error('unauthorized'));
    }
    try {
      const payload = verifyAccessToken(token);
      const user = await findUserByPublicId(payload.sub);
      if (!user) {
        logSocketAuthFailure(socket, 'user_not_found');
        return next(new Error('unauthorized'));
      }
      // `id` = public_id (UUID) exposto ao cliente; `internalId` = PK BIGINT
      // usada só em FKs/joins no banco.
      socket.data.user = {
        id: user.publicId,
        internalId: user.id,
        username: user.username,
        discriminator: user.discriminator,
        status: user.status,
        avatarPath: user.avatarPath,
      };
      return next();
    } catch (err) {
      const reason =
        err?.name === 'TokenExpiredError' ? 'token_expired' : err?.name === 'JsonWebTokenError' ? 'token_invalid' : 'auth_lookup_failed';
      logSocketAuthFailure(socket, reason);
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // Antes dos handlers: contexto de log por conexão + captura de erro em
    // todo socket.on registrado abaixo.
    instrumentConnection(socket);
    registerOnlineHandlers(io, socket);
    registerPresenceHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerMediasoupHandlers(io, socket);
    registerDmHandlers(io, socket);
    registerCallHandlers(io, socket);
  });

  return io;
}
