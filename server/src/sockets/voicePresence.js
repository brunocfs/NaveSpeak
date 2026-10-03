// Roster de voz persistente no Redis: Hash voice:channel:{channelId}:members
// -> userId -> JSON { username, socketIds: [] }.
//
// É a fonte de verdade de "quem está na chamada" para efeitos de exibição -
// ao contrário do Map em memória de mediasoup/rooms.js (que guarda routers,
// transports, producers/consumers: estado de mídia inerentemente efêmero e
// preso ao processo, isso não sobrevive a um restart e nem tem como), este
// roster:
//   - sobrevive a um restart do processo: um usuário que estava na chamada
//     continua listado como participante até o próprio socket cair (o cliente
//     reconecta e refaz media:join automaticamente, ver useMediasoup.js);
//   - é visível para quem está só navegando no canal (channel:join), sem
//     precisar entrar na chamada - basta ler o Redis, não depende de estar no
//     mesmo processo que hospeda o router mediasoup daquele canal;
//   - funciona entre múltiplas instâncias atrás do adapter Redis do
//     socket.io (ENABLE_REDIS_ADAPTER=true), já que io.to(channelId).emit é
//     roteado via pub/sub do Redis para todas as instâncias.
import { createRoomPresenceStore } from './roomPresence.js';
import { redis } from '../config/redis.js';
import { splitRoster } from '../utils/voiceGhost.js';
import { modsRoomOf } from './modsRoom.js';

// Room socket.io de quem está DE FATO na chamada do canal (ver comentário em
// mediasoup.handler.js) - separada da room `channelId` de "quem vê o canal".
export const voiceRoomOf = (channelId) => `voice:${channelId}`;

const store = createRoomPresenceStore('voice', (channelId) => `voice:channel:${channelId}:members`);

// Hash separado (mesmo prefixo `voice:channel:*`, então também é varrido
// pela limpeza de fantasmas no boot, ver resetEphemeralPresenceOnBoot em
// config/redis.js) pro estado de mic/câmera/tela de cada participante -
// mic mutado, câmera ligada, tela compartilhada, ensurdecido. Por que não dentro do JSON
// do roomPresence acima? Porque aquele hash só é escrito atomicamente pelos
// scripts Lua presenceAdd/presenceRemove (genéricos, reaproveitados pela
// presença de canal também) - não dá pra "só" atualizar um campo de mídia
// sem duplicar essa lógica Lua. Isto aqui é escrito direto (HSET/HDEL),
// então É POR ISSO que existe como fonte de verdade DO SERVIDOR: antes esse
// estado só existia no cliente de quem já estava conectado à chamada
// (remoteStreams, ver MediaSessionContext.jsx) - um usuário que entrava
// depois de alguém já mutado, ou que nem tinha entrado na chamada ainda,
// nunca via o ícone. Com isso, todo mundo com o servidor aberto (voice:update
// vai pra room do canal E pra room do servidor, ver broadcastVoicePresence
// em mediasoup.handler.js) recebe o estado atual, não só quem está na call.
const mediaKey = (channelId) => `voice:channel:${channelId}:media`;
// speakingRing (benefício, gravado no media:join) vai no roster pra todos verem o anel.
const defaultMediaState = () => ({ micMuted: false, cameraOn: false, sharingScreen: false, deafened: false, speakingRing: false });

export async function setVoiceMediaState(channelId, userId, patch) {
  try {
    const raw = await redis.hget(mediaKey(channelId), userId);
    let current = defaultMediaState();
    if (raw) {
      try {
        current = { ...current, ...JSON.parse(raw) };
      } catch {
        /* mantém o default acima */
      }
    }
    const next = { ...current, ...patch };
    await redis.hset(mediaKey(channelId), userId, JSON.stringify(next));
    return next;
  } catch {
    // Fail-open: sem Redis, o estado de mídia no roster fica desativado (some
    // volta ao default false), mas a chamada em si continua funcionando -
    // mesma postura de fail-open do resto deste arquivo.
    return null;
  }
}

// Leitura pura (sem escrever nada) do estado de mídia de UM participante -
// usada pra checar `deafened` antes de deixar tocar um efeito sonoro
// (soundboard:play, ver mediasoup.handler.js) sem precisar ler o roster
// inteiro do canal (listVoicePresence) só por isso.
export async function getVoiceMediaState(channelId, userId) {
  try {
    const raw = await redis.hget(mediaKey(channelId), userId);
    if (!raw) return defaultMediaState();
    try {
      return { ...defaultMediaState(), ...JSON.parse(raw) };
    } catch {
      return defaultMediaState();
    }
  } catch {
    // Fail-open: sem Redis, assume não-ensurdecido (mesma postura de
    // listVoicePresence/setVoiceMediaState acima) - nunca bloqueia o
    // soundboard só porque o Redis caiu.
    return defaultMediaState();
  }
}

async function clearVoiceMediaState(channelId, userId) {
  try {
    await redis.hdel(mediaKey(channelId), userId);
  } catch {
    /* fail-open */
  }
}

// Set de fantasmas (ghostVoice) por canal - mesmo prefixo voice:channel:*,
// então a limpeza do boot também varre. Escrito no media:join e a cada troca
// de status/preferência (sockets/voiceGhost.js). Fail-open: sem Redis ninguém
// é fantasma (todos aparecem).
const ghostsKey = (channelId) => `voice:channel:${channelId}:ghosts`;

// Devolve true se o estado mudou.
export async function setGhost(channelId, userId, ghost) {
  try {
    return (await (ghost ? redis.sadd(ghostsKey(channelId), userId) : redis.srem(ghostsKey(channelId), userId))) === 1;
  } catch {
    return false;
  }
}

export async function listGhostIds(channelId) {
  try {
    return await redis.smembers(ghostsKey(channelId));
  } catch {
    return [];
  }
}

export const addVoicePresence = store.add;

// Envelope de store.remove: quando o usuário fica totalmente fora do canal
// (último socket saiu), também limpa o estado de mídia dele - senão o hash
// acumularia entradas de gente que já saiu há muito (elas nem aparecem no
// roster, mas ficariam ocupando espaço à toa no Redis).
export async function removeVoicePresence(channelId, userId, socketId) {
  const left = await store.remove(channelId, userId, socketId);
  if (left) {
    await clearVoiceMediaState(channelId, userId);
    await setGhost(channelId, userId, false);
  }
  return left;
}

export const removeSocketFromAllVoiceChannels = store.removeSocketFromAll;

// Painel admin: quem está em voz e de que TIPO ('server' | 'call') - nunca
// o canal, por privacidade.
// ponytail: KEYS é O(N) no Redis; trocar por SCAN se a base crescer muito.
export async function listUsersInVoice() {
  const result = new Map();
  try {
    const keys = await redis.keys('voice:channel:*:members');
    for (const key of keys) {
      const type = key.startsWith('voice:channel:call:') ? 'call' : 'server';
      for (const userId of await redis.hkeys(key)) result.set(userId, type);
    }
  } catch {
    /* fail-open: sem Redis, ninguém aparece em voz */
  }
  return result;
}

// Roster de um canal de voz já com o estado de mídia de cada participante
// mesclado - RoomPage/VoiceRosterEntry leem micMuted/cameraOn/sharingScreen
// direto do participante, sem precisar estar conectado à chamada pra saber.
// Por padrão devolve a lista FILTRADA (sem fantasmas) - quem enxerga tudo
// (voiceRoom/modsRoom) pede { full: true } e recebe `ghost: true` nos fantasmas.
export async function listVoicePresence(channelId, { full = false } = {}) {
  const participants = await store.list(channelId);
  if (participants.length === 0) return participants;

  let mediaHash = {};
  try {
    mediaHash = await redis.hgetall(mediaKey(channelId));
  } catch {
    /* fail-open: todo mundo cai no default abaixo */
  }

  const merged = participants.map((p) => {
    let state = defaultMediaState();
    const raw = mediaHash[p.userId];
    if (raw) {
      try {
        state = { ...state, ...JSON.parse(raw) };
      } catch {
        /* mantém o default acima */
      }
    }
    return { ...p, ...state };
  });
  const { full: withGhosts, filtered } = splitRoster(merged, await listGhostIds(channelId));
  return full ? withGhosts : filtered;
}

// Avisa a voz do canal e quem tem o servidor aberto. Com fantasmas, a lista
// completa vai só pra voiceRoom + mods:{serverId} e a filtrada pro resto do
// servidor (except). Chamada privada (sem serverId) não tem fantasma.
export async function broadcastVoicePresence(io, channelId, serverId) {
  const participants = await listVoicePresence(channelId, { full: true });
  const voiceRoom = voiceRoomOf(channelId);
  if (!serverId || !participants.some((p) => p.ghost)) {
    io.to(serverId ? [voiceRoom, serverId] : voiceRoom).emit('voice:update', { channelId, participants });
    return participants;
  }
  const privileged = [voiceRoom, modsRoomOf(serverId)];
  io.to(privileged).emit('voice:update', { channelId, participants });
  io.to(serverId).except(privileged).emit('voice:update', { channelId, participants: participants.filter((p) => !p.ghost) });
  return participants;
}
