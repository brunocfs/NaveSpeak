// Estado de CONVITE de uma chamada privada: quem foi chamado, aceitou,
// recusou ou saiu. Redis, sobrevive a reconexão/restart de um socket
// individual (não do processo inteiro - assim como voicePresence.js, é
// limpo no boot via resetEphemeralPresenceOnBoot, ver config/redis.js).
//
// Diferente do roster de voz (voicePresence.js): aquele é "quem está DE FATO
// conectado ao mediasoup agora"; este é "quem foi convidado e o que
// respondeu", inclusive gente que ainda não entrou (tocando) ou que já
// saiu (pode reentrar - ver isCallParticipant). Só existe para chamada
// PRIVADA: canal de voz de servidor não tem convite, quem é membro do
// servidor entra direto.
//
// Hash call:<uuid>:participants -> userId(public) -> JSON
//   { username, status: 'invited'|'accepted'|'declined'|'left', invitedBy: {id, username} | null }
// Um campo especial "__meta" no mesmo hash guarda quem criou a chamada
// (nunca colide com um userId real, que é sempre um UUID).
// Set  calls:pending:<userId> -> callIds em que esse usuário tem convite
//   ainda não respondido ('invited') - usado só para reentregar o convite
//   se ele estava offline no momento (ver online.handler.js).
import { redis } from '../config/redis.js';

const participantsKey = (callId) => `${callId}:participants`;
const pendingKey = (userId) => `calls:pending:${userId}`;
const META_FIELD = '__meta';

export async function createCall(callId, creator) {
  try {
    // Dois HSET de campo único em vez de um só com objeto (multi-campo) -
    // a forma multi-campo do HSET só existe a partir do Redis 4.0, e em
    // servidores mais antigos (ex.: a porta Windows do Redis 3.0.504) o
    // comando falha inteiro com "wrong number of arguments", derrubando os
    // DOIS campos de uma vez (inclusive o do próprio criador) - o fail-open
    // abaixo então escondia isso, deixando o criador sem entrada e travado
    // fora da própria chamada logo no media:join seguinte.
    const key = participantsKey(callId);
    await redis.hset(key, META_FIELD, JSON.stringify({ createdBy: creator.id, createdAt: Date.now() }));
    await redis.hset(
      key,
      creator.id,
      JSON.stringify({ username: creator.username, status: 'accepted', invitedBy: null })
    );
  } catch {
    /* fail-open: sem Redis, a chamada privada fica indisponível (checado no chamador) */
  }
}

export async function inviteParticipant(callId, target, invitedBy) {
  try {
    await redis.hset(
      participantsKey(callId),
      target.id,
      JSON.stringify({ username: target.username, status: 'invited', invitedBy })
    );
    await redis.sadd(pendingKey(target.id), callId);
  } catch {
    /* fail-open */
  }
}

export async function setStatus(callId, userId, status) {
  try {
    const raw = await redis.hget(participantsKey(callId), userId);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    entry.status = status;
    await redis.hset(participantsKey(callId), userId, JSON.stringify(entry));
    if (status !== 'invited') await redis.srem(pendingKey(userId), callId);
    return entry;
  } catch {
    return null;
  }
}

export async function getParticipant(callId, userId) {
  try {
    const raw = await redis.hget(participantsKey(callId), userId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// "Faz parte da chamada" = tem um convite que não foi recusado - cobre quem
// ainda está tocando (invited), quem já aceitou/entrou (accepted) e quem
// saiu e pode reentrar (left). Só 'declined' (ou nunca convidado) fica de
// fora - é essa checagem, não o formato do callId, que autoriza media:join
// numa chamada privada (ver mediasoup.handler.js).
export async function isCallParticipant(callId, userId) {
  const entry = await getParticipant(callId, userId);
  return Boolean(entry) && entry.status !== 'declined';
}

export async function listParticipants(callId) {
  try {
    const hash = await redis.hgetall(participantsKey(callId));
    const result = [];
    for (const [userId, raw] of Object.entries(hash)) {
      if (userId === META_FIELD) continue;
      try {
        const entry = JSON.parse(raw);
        result.push({ userId, username: entry.username, status: entry.status, invitedBy: entry.invitedBy });
      } catch {
        /* entrada corrompida - ignora */
      }
    }
    return result;
  } catch {
    return [];
  }
}

// Convites pendentes ('invited') de um usuário - reentregue no connect
// (online.handler.js) pra cobrir quem recebeu a chamada offline e só viu o
// evento ao voltar.
export async function listPendingCallInvites(userId) {
  try {
    const callIds = await redis.smembers(pendingKey(userId));
    const invites = [];
    for (const callId of callIds) {
      const entry = await getParticipant(callId, userId);
      if (entry?.status === 'invited') invites.push({ callId, from: entry.invitedBy });
    }
    return invites;
  } catch {
    return [];
  }
}

// Uma chamada só continua "hospedada" enquanto tiver pelo menos um
// participante 'accepted' (de fato dentro dela) - convites 'invited' sem
// ninguém pra atendê-los não sustentam a chamada sozinhos. Apaga o hash
// inteiro quando isso deixa de valer (ver handleCallLeave em
// calls.handler.js, que já avisa quem ainda estava tocando antes de chamar
// isto).
export async function deleteCallIfInactive(callId) {
  const participants = await listParticipants(callId);
  const stillHosted = participants.some((p) => p.status === 'accepted');
  if (!stillHosted) {
    try {
      await redis.del(participantsKey(callId));
    } catch {
      /* fail-open */
    }
  }
  return !stillHosted;
}
