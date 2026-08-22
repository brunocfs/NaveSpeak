import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { findUserByPublicId } from '../db/users.repo.js';
import { registerPresenceHandlers } from './presence.handler.js';
import { registerChatHandlers } from './chat.handler.js';
import { registerMediasoupHandlers } from './mediasoup.handler.js';

export function attachSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

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
      socket.data.user = { id: user.publicId, internalId: user.id, username: user.username };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    registerPresenceHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerMediasoupHandlers(io, socket);
  });

  return io;
}
