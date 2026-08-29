import { listRoomsForUser } from '../db/rooms.repo.js';
import { markOnline, markOffline } from './onlineStore.js';

// Status ONLINE global (independente de canal/servidor - ver onlineStore.js).
//
// Assim que o socket autentica, o usuário entra em TODAS as rooms socket.io
// dos servidores dele (não só a que estiver navegando no momento via
// server:join) - é isso que permite a UI mostrar quem está online em
// qualquer servidor do usuário sem precisar abrir cada um. O evento só é
// reemitido para essas rooms, então usuários de servidores diferentes nunca
// veem o status uns dos outros.
export function registerOnlineHandlers(io, socket) {
  const user = socket.data.user;

  (async () => {
    await markOnline(user, socket.id);
    const rooms = await listRoomsForUser(user.internalId);
    const roomIds = rooms.map((r) => r.id);
    for (const roomId of roomIds) socket.join(roomId);
    if (roomIds.length > 0) {
      socket.to(roomIds).emit('user:online', { userId: user.id, username: user.username });
    }
  })();

  socket.on('disconnect', async () => {
    const wentOffline = await markOffline(user.id, socket.id);
    if (!wentOffline) return; // outro socket (aba) do mesmo usuário ainda está conectado

    const rooms = await listRoomsForUser(user.internalId);
    for (const room of rooms) {
      io.to(room.id).emit('user:offline', { userId: user.id });
    }
  });
}
