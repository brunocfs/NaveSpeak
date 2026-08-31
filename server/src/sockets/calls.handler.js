// Convite/aceite/recusa de chamada PRIVADA - a camada "social" em cima do
// mesmo pipeline de mídia das salas (mediasoup.handler.js), nunca um fluxo
// de voz redundante. Uma chamada privada é só um channelId sintético
// "call:<uuid>" que mediasoup.handler.js já sabe tratar (getOrCreateRoom,
// producers/consumers, roster de voz) sem nenhuma mudança - a única diferença
// é a autorização (isCallParticipant aqui, em vez de isRoomMember) e o fato
// de existir um convite antes de poder entrar.
import { randomUUID } from 'node:crypto';
import { findUserByPublicId } from '../db/users.repo.js';
import { areFriends } from '../db/friends.repo.js';
import { isBlockedEitherDirection } from '../db/blocks.repo.js';
import { userIdParamSchema, mediaChannelIdSchema } from '../validation/schemas.js';
import {
  createCall,
  inviteParticipant,
  setStatus,
  getParticipant,
  isCallParticipant,
  listParticipants,
  deleteCallIfInactive,
} from './callsStore.js';

const CALL_PREFIX = 'call:';
export const isCallChannel = (channelId) =>
  typeof channelId === 'string' && channelId.startsWith(CALL_PREFIX);

// Mesma convenção de nome de room do mediasoup.handler.js (voiceRoomOf) -
// duplicada aqui de propósito: é uma única linha, e importar entre os dois
// módulos só por isto criaria acoplamento circular sem necessidade.
const voiceRoomOf = (channelId) => `voice:${channelId}`;

function wrapAck(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

async function broadcastParticipants(io, callId) {
  const participants = await listParticipants(callId);
  // Quem já está DE FATO na chamada (voice:<callId>) recebe pela room de
  // voz; quem só foi convidado e ainda não entrou não está nela - avisado
  // direto na sua room pessoal, senão a UI de "chamando..." de quem convidou
  // nunca veria aquele convite específico ser aceito/recusado antes da
  // pessoa entrar de fato.
  io.to(voiceRoomOf(callId)).emit('call:participantUpdate', { callId, participants });
  for (const p of participants) {
    if (p.status === 'invited') {
      io.to(`user:${p.userId}`).emit('call:participantUpdate', { callId, participants });
    }
  }
  return participants;
}

// Chamado por mediasoup.handler.js (media:leave e disconnect) quando o
// channelId é uma chamada privada - mantém o estado de convite em sincronia
// com quem de fato saiu da voz, e encerra a chamada pra quem ainda só
// estava tocando se não sobrar ninguém "hospedando" ela.
export async function handleCallLeave(io, callId, userId) {
  await setStatus(callId, userId, 'left');
  const participants = await broadcastParticipants(io, callId);

  const stillHosted = participants.some((p) => p.status === 'accepted');
  if (!stillHosted) {
    for (const p of participants) {
      if (p.status === 'invited') io.to(`user:${p.userId}`).emit('call:ended', { callId });
    }
    io.to(voiceRoomOf(callId)).emit('call:ended', { callId });
    await deleteCallIfInactive(callId);
  }
}

export function registerCallHandlers(io, socket) {
  const user = socket.data.user;

  // Amizade + bloqueio são checados a cada convite (nunca só na abertura do
  // chat privado) - mesma regra do DM (ver dm.handler.js).
  async function resolveInvitable(targetPublicId) {
    const parsed = userIdParamSchema.safeParse(targetPublicId);
    if (!parsed.success) return { error: 'ID de usuário inválido.' };

    const target = await findUserByPublicId(parsed.data);
    if (!target || target.id === user.internalId) return { error: 'Usuário inválido.' };
    if (await isBlockedEitherDirection(user.internalId, target.id)) {
      return { error: 'Não é possível chamar este usuário.' };
    }
    if (!(await areFriends(user.internalId, target.id))) {
      return { error: 'Vocês precisam ser amigos para iniciar uma chamada.' };
    }
    return { target };
  }

  // Cria a chamada e convida o amigo a partir do chat privado. Só cria o
  // registro de convite - entrar de fato na voz é um media:join separado
  // (o client faz os dois em sequência, ver CallContext.jsx), a mesma
  // separação já usada nas salas (channel:join vs. media:join).
  socket.on('call:create', async ({ peerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const { error, target } = await resolveInvitable(peerId);
    if (error) return ack({ error });

    const callId = `${CALL_PREFIX}${randomUUID()}`;
    await createCall(callId, { id: user.id, username: user.username });
    await inviteParticipant(
      callId,
      { id: target.publicId, username: target.username },
      { id: user.id, username: user.username }
    );

    io.to(`user:${target.publicId}`).emit('call:invite', {
      callId,
      from: { id: user.id, username: user.username },
    });
    return ack({ ok: true, callId });
  });

  // Convida MAIS alguém para uma chamada já em andamento (grupo) - quem
  // convida precisa estar de fato na chamada, nunca só conhecer o callId.
  // Não toca em nenhum producer/transport dos participantes já conectados -
  // a chamada atual não é derrubada para adicionar alguém.
  socket.on('call:invite', async ({ callId, peerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsedCall = mediaChannelIdSchema.safeParse(callId);
    if (!parsedCall.success || !isCallChannel(parsedCall.data)) {
      return ack({ error: 'Chamada inválida.' });
    }
    if (!(await isCallParticipant(parsedCall.data, user.id))) {
      return ack({ error: 'Você não está nessa chamada.' });
    }

    const { error, target } = await resolveInvitable(peerId);
    if (error) return ack({ error });

    const existing = await getParticipant(parsedCall.data, target.publicId);
    if (existing && (existing.status === 'invited' || existing.status === 'accepted')) {
      return ack({ error: 'Esse usuário já está na chamada.' });
    }

    await inviteParticipant(
      parsedCall.data,
      { id: target.publicId, username: target.username },
      { id: user.id, username: user.username }
    );
    io.to(`user:${target.publicId}`).emit('call:invite', {
      callId: parsedCall.data,
      from: { id: user.id, username: user.username },
    });
    await broadcastParticipants(io, parsedCall.data);
    return ack({ ok: true });
  });

  socket.on('call:accept', async ({ callId } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsed = mediaChannelIdSchema.safeParse(callId);
    if (!parsed.success || !isCallChannel(parsed.data)) return ack({ error: 'Chamada inválida.' });

    const entry = await getParticipant(parsed.data, user.id);
    if (!entry) return ack({ error: 'Convite não encontrado.' });

    await setStatus(parsed.data, user.id, 'accepted');
    await broadcastParticipants(io, parsed.data);
    return ack({ ok: true });
  });

  // Recusar um convite e sair de uma chamada em andamento usam o mesmo
  // evento - a diferença de efeito (chamada continua ou é encerrada) é
  // decidida por handleCallLeave/broadcastParticipants a partir de quem mais
  // sobrou, não daqui.
  socket.on('call:decline', async ({ callId } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsed = mediaChannelIdSchema.safeParse(callId);
    if (!parsed.success || !isCallChannel(parsed.data)) return ack({ error: 'Chamada inválida.' });

    await setStatus(parsed.data, user.id, 'declined');
    await broadcastParticipants(io, parsed.data);
    await deleteCallIfInactive(parsed.data);
    return ack({ ok: true });
  });
}
