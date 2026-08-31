import { listRoomsForUser } from '../db/rooms.repo.js';
import { listFriendPublicIds } from '../db/friends.repo.js';
import { getPublicStatus } from './onlineStore.js';

// Único ponto que decide QUEM recebe a mudança de status de um usuário -
// reaproveitado tanto pelos handlers de socket (conexão, desconexão,
// inatividade - ver online.handler.js) quanto pela rota HTTP que troca o
// status manualmente (PATCH /api/users/me/status em users.routes.js).
//
// Alcança as mesmas duas audiências que online.handler.js sempre usou pra
// presença: todo servidor do usuário (RoomPage.jsx, lista de membros) e
// todo amigo (FriendsPanel.jsx/DmPanel.jsx), via a room pessoal
// user:<publicId>. O status emitido é sempre o PÚBLICO (getPublicStatus) -
// 'invisible' nunca sai daqui, sempre como 'offline'.
export async function broadcastUserStatus(io, user) {
  if (!io) return;

  const status = await getPublicStatus(user.id);
  const payload = { userId: user.id, username: user.username, status };

  const rooms = await listRoomsForUser(user.internalId);
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length > 0) io.to(roomIds).emit('presence:status', payload);

  const friendIds = await listFriendPublicIds(user.internalId);
  for (const friendId of friendIds) {
    io.to(`user:${friendId}`).emit('presence:status', payload);
  }
}
