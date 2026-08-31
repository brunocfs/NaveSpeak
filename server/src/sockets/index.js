import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { findUserByPublicId } from '../db/users.repo.js';
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
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    // Os duplicates não herdam o handler de erro do cliente original - sem
    // isso o Node reclama ("missing 'error' handler") e pode encerrar o
    // processo num erro de Redis do adapter.
    const onError = (err) => console.error('[redis/adapter] erro:', err.message);
    pubClient.on('error', onError);
    subClient.on('error', onError);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[socket.io] adapter Redis ativo (multi-instância).');
  } else {
    console.log('[socket.io] adapter em memória (single-instance). Defina ENABLE_REDIS_ADAPTER=true para multi-instância via Redis.');
  }

  // Todo socket precisa apresentar um access token JWT válido no handshake
  // (client envia via `auth: { token }`) - sem isso, a conexão é recusada
  // antes de qualquer handler rodar.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const payload = verifyAccessToken(token);
      const user = await findUserByPublicId(payload.sub);
      if (!user) return next(new Error('unauthorized'));
      // `id` = public_id (UUID) exposto ao cliente; `internalId` = PK BIGINT
      // usada só em FKs/joins no banco.
      socket.data.user = {
        id: user.publicId,
        internalId: user.id,
        username: user.username,
        status: user.status,
        avatarPath: user.avatarPath,
      };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    registerOnlineHandlers(io, socket);
    registerPresenceHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerMediasoupHandlers(io, socket);
    registerDmHandlers(io, socket);
    registerCallHandlers(io, socket);
  });

  return io;
}
