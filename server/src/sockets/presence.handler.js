import { isRoomMember } from '../db/rooms.repo.js';
import { roomIdParamSchema } from '../validation/schemas.js';
import { addPresence, removePresence, removeSocketFromAllRooms, listPresence } from './presenceStore.js';

export function registerPresenceHandlers(io, socket) {
  const user = socket.data.user;

  socket.on('room:join', async (roomId, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const parsed = roomIdParamSchema.safeParse(roomId);
    if (!parsed.success) return ack({ error: 'ID de sala inválido.' });

    // Checagem de membership no banco a cada join - nunca confiar só no fato
    // de o cliente ter pedido para entrar nessa sala específica.
    const member = await isRoomMember(parsed.data, user.internalId);
    if (!member) return ack({ error: 'Você não é membro dessa sala.' });

    socket.join(parsed.data);
    addPresence(parsed.data, user, socket.id);
    const members = await listPresence(parsed.data);
    io.to(parsed.data).emit('presence:update', { roomId: parsed.data, members });
    return ack({ ok: true, members });
  });

  socket.on('room:leave', async (roomId, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const parsed = roomIdParamSchema.safeParse(roomId);
    if (!parsed.success) return ack({ error: 'ID de sala inválido.' });

    socket.leave(parsed.data);
    removePresence(parsed.data, user.id, socket.id);
    const members = await listPresence(parsed.data);
    io.to(parsed.data).emit('presence:update', { roomId: parsed.data, members });
    return ack({ ok: true });
  });

  socket.on('disconnect', async () => {
    const affectedRooms = await removeSocketFromAllRooms(socket.id);
    for (const roomId of affectedRooms) {
      const members = await listPresence(roomId);
      io.to(roomId).emit('presence:update', { roomId, members });
    }
  });
}
