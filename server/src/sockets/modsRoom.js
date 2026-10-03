// Room `mods:{serverId}`: sockets de moderadores de voz (isVoiceModerator),
// que recebem o voice:update COMPLETO (inclusive fantasmas do ghostVoice).
import { findRoomById } from '../db/rooms.repo.js';
import { findUserById } from '../db/users.repo.js';
import { getUserPermissionBitmask } from '../db/roles.repo.js';
import { isVoiceModerator } from '../utils/permissions.js';

export const modsRoomOf = (serverId) => `mods:${serverId}`;

// Relê tudo do banco (cargos e is_admin mudam no meio da sessão).
export async function isVoiceModeratorFor(internalUserId, serverId) {
  const [room, user, bitmask] = await Promise.all([
    findRoomById(serverId),
    findUserById(internalUserId),
    getUserPermissionBitmask(serverId, internalUserId),
  ]);
  if (!room || !user) return false;
  return isVoiceModerator({ room, user: { id: user.publicId, isAdmin: user.isAdmin }, bitmask });
}

export async function joinModsRoomIfModerator(socket, serverId) {
  if (await isVoiceModeratorFor(socket.data.user.internalId, serverId)) socket.join(modsRoomOf(serverId));
}
