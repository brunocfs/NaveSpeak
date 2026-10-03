// ghostVoice: calcula o fantasma efetivo e mantém set + rooms de moderadores
// em dia quando algo muda no meio da chamada.
import { getGhostEligibility, findUserByPublicId, getVoiceCosmetics } from '../db/users.repo.js';
import { listChannelsForServer } from '../db/channels.repo.js';
import { getPreference } from './onlineStore.js';
import { isEffectiveGhost } from '../utils/voiceGhost.js';
import { isVoiceModeratorFor, modsRoomOf } from './modsRoom.js';
import { setGhost, listGhostIds, broadcastVoicePresence, setVoiceMediaState, getVoiceMediaState } from './voicePresence.js';

// user = socket.data.user / req.user (id público + internalId).
export async function computeEffectiveGhost(user) {
  const e = await getGhostEligibility(user.internalId);
  if (!e) return false;
  return isEffectiveGhost({ ...e, status: (await getPreference(user.id)) ?? e.status });
}

// Status, preferência ou benefício mudou: reavalia o usuário em cada canal de
// servidor em que está na voz e rebroadcasta só se o estado mudou.
export async function refreshUserGhost(io, user) {
  if (!io) return;
  const ghost = await computeEffectiveGhost(user);
  const seen = new Set();
  for (const s of await io.in(`user:${user.id}`).fetchSockets()) {
    const { voiceChannelId: channelId, voiceServerId: serverId } = s.data;
    if (!channelId || !serverId || seen.has(channelId)) continue;
    seen.add(channelId);
    if (await setGhost(channelId, user.id, ghost)) await broadcastVoicePresence(io, channelId, serverId);
  }
}

export async function refreshUserGhostByPublicId(io, publicId) {
  const u = await findUserByPublicId(publicId);
  if (u) await refreshUserGhost(io, { id: publicId, internalId: u.id });
}

// Preferência do anel de fala mudou: atualiza o flag no estado de mídia da voz
// (vai no voice:update) e rebroadcasta se mudou, igual refreshUserGhost.
export async function refreshSpeakingRing(io, user) {
  if (!io) return;
  const { speakingRing } = await getVoiceCosmetics(user.internalId);
  const seen = new Set();
  for (const s of await io.in(`user:${user.id}`).fetchSockets()) {
    const { voiceChannelId: channelId, voiceServerId: serverId } = s.data;
    if (!channelId || !serverId || seen.has(channelId)) continue;
    seen.add(channelId);
    if ((await getVoiceMediaState(channelId, user.id)).speakingRing === speakingRing) continue;
    await setVoiceMediaState(channelId, user.id, { speakingRing });
    await broadcastVoicePresence(io, channelId, serverId);
  }
}

// Cargo/admin mudou: recalcula quem está na mods:{serverId}. Se alguém entrou
// ou saiu, reenvia o roster dos canais que têm fantasma (a visão muda).
// ponytail: O(sockets do servidor) por mudança; recalcular só o usuário afetado se pesar.
export async function refreshModsRoom(io, serverId) {
  if (!io) return;
  const room = modsRoomOf(serverId);
  const verdict = new Map();
  let changed = false;
  for (const s of await io.in(serverId).fetchSockets()) {
    const uid = s.data.user?.internalId;
    if (!uid) continue;
    if (!verdict.has(uid)) verdict.set(uid, await isVoiceModeratorFor(uid, serverId));
    const inRoom = s.rooms.has(room);
    if (verdict.get(uid) && !inRoom) (s.join(room), (changed = true));
    else if (!verdict.get(uid) && inRoom) (s.leave(room), (changed = true));
  }
  if (!changed) return;
  for (const c of await listChannelsForServer(serverId)) {
    if (c.type === 'voice' && (await listGhostIds(c.id)).length) await broadcastVoicePresence(io, c.id, serverId);
  }
}
