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
const defaultMediaState = () => ({ micMuted: false, cameraOn: false, sharingScreen: false, deafened: false });

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

async function clearVoiceMediaState(channelId, userId) {
  try {
    await redis.hdel(mediaKey(channelId), userId);
  } catch {
    /* fail-open */
  }
}

export const addVoicePresence = store.add;

// Envelope de store.remove: quando o usuário fica totalmente fora do canal
// (último socket saiu), também limpa o estado de mídia dele - senão o hash
// acumularia entradas de gente que já saiu há muito (elas nem aparecem no
// roster, mas ficariam ocupando espaço à toa no Redis).
export async function removeVoicePresence(channelId, userId, socketId) {
  const left = await store.remove(channelId, userId, socketId);
  if (left) await clearVoiceMediaState(channelId, userId);
  return left;
}

export const removeSocketFromAllVoiceChannels = store.removeSocketFromAll;

// Roster de um canal de voz já com o estado de mídia de cada participante
// mesclado - RoomPage/VoiceRosterEntry leem micMuted/cameraOn/sharingScreen
// direto do participante, sem precisar estar conectado à chamada pra saber.
export async function listVoicePresence(channelId) {
  const participants = await store.list(channelId);
  if (participants.length === 0) return participants;

  let mediaHash = {};
  try {
    mediaHash = await redis.hgetall(mediaKey(channelId));
  } catch {
    /* fail-open: todo mundo cai no default abaixo */
  }

  return participants.map((p) => {
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
}
