// Estado de presença em memória: quem está conectado em cada sala.
// roomId -> userId -> { username, socketIds: Set<string> }
// Um usuário pode ter mais de um socket (várias abas/janelas) - só
// consideramos "offline" quando o último socket dele sai da sala.
const rooms = new Map();

export function addPresence(roomId, user, socketId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  const roomMap = rooms.get(roomId);

  if (!roomMap.has(user.id)) {
    roomMap.set(user.id, { username: user.username, socketIds: new Set() });
  }
  roomMap.get(user.id).socketIds.add(socketId);
}

// Retorna true se o usuário ficou totalmente offline nessa sala (para saber
// se vale a pena notificar os outros membros).
export function removePresence(roomId, userId, socketId) {
  const roomMap = rooms.get(roomId);
  if (!roomMap?.has(userId)) return false;

  const entry = roomMap.get(userId);
  entry.socketIds.delete(socketId);

  if (entry.socketIds.size === 0) {
    roomMap.delete(userId);
    if (roomMap.size === 0) rooms.delete(roomId);
    return true;
  }
  return false;
}

export function removeSocketFromAllRooms(socketId) {
  const affectedRooms = [];
  for (const [roomId, roomMap] of rooms.entries()) {
    for (const userId of roomMap.keys()) {
      if (roomMap.get(userId).socketIds.has(socketId)) {
        if (removePresence(roomId, userId, socketId)) {
          affectedRooms.push(roomId);
        }
      }
    }
  }
  return affectedRooms;
}

export function listPresence(roomId) {
  const roomMap = rooms.get(roomId);
  if (!roomMap) return [];
  return Array.from(roomMap.entries()).map(([userId, entry]) => ({
    userId,
    username: entry.username,
  }));
}
