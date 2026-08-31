import { isRoomMember, findRoomById } from '../db/rooms.repo.js';
import { findChannelById } from '../db/channels.repo.js';
import { mediaChannelIdSchema, channelIdParamSchema, userIdParamSchema } from '../validation/schemas.js';
import { webRtcTransportOptions } from '../mediasoup/config.js';
import {
  getOrCreateRoom,
  getRoom,
  addPeer,
  getPeer,
  removePeer,
  listOtherProducers,
} from '../mediasoup/rooms.js';
import { addVoicePresence, removeVoicePresence, listVoicePresence } from './voicePresence.js';
import { isCallChannel, handleCallLeave } from './calls.handler.js';
import { isCallParticipant, setStatus as setCallStatus } from './callsStore.js';
import { getUserPermissionBitmask, listRoleIdsForUser } from '../db/roles.repo.js';
import { PERMISSIONS, checkPermission, canAccessChannel } from '../utils/permissions.js';

function wrapAck(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

// Room do socket.io dedicada a quem está DE FATO conectado à chamada de um
// canal - separada da room `channelId` usada por presence.handler.js para
// "quem está vendo este canal" (channel:join/channel:leave). São dois
// conceitos diferentes que só coincidiam por acidente antes: um socket que dá
// channel:leave (ex.: trocou de canal na UI) chamava socket.leave(channelId)
// e podia derrubar esse MESMO socket da room usada pro broadcast de
// voice:update, fazendo o próprio usuário que estava trocando de canal de voz
// perder o aviso de que saiu do canal anterior (o roster ficava "grudado"
// mostrando ele em dois canais ao mesmo tempo). Com rooms separadas, uma
// nunca interfere na outra.
const voiceRoomOf = (channelId) => `voice:${channelId}`;

// Travas de moderação "persistentes" (modo 'lock' - ver §7 do plano):
// sobrevivem a sair/entrar de novo na chamada, diferente do Map de
// mediasoup/rooms.js (que morre quando o canal de voz fica vazio) -
// deliberadamente um Map à parte, só um moderador destrava (voice:moderateMute/
// voice:moderateMedia com mode:'lock' de novo). Em memória local ao processo,
// mesma limitação já documentada em mediasoup/rooms.js (sem Redis nessa
// camada) - moderação num deploy multi-instância exigiria migrar isso pra lá.
const voiceLocks = new Map(); // `${channelId}:${userId}` -> { audioLocked, mediaLocked }

function lockKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

function getLock(channelId, userId) {
  return voiceLocks.get(lockKey(channelId, userId)) ?? { audioLocked: false, mediaLocked: false };
}

function setLock(channelId, userId, patch) {
  const key = lockKey(channelId, userId);
  const next = { ...getLock(channelId, userId), ...patch };
  if (!next.audioLocked && !next.mediaLocked) voiceLocks.delete(key);
  else voiceLocks.set(key, next);
  return next;
}

// Avisa quem está conectado na chamada e, quando dá pra saber o servidor
// (serverId), TODO MUNDO que tem o servidor aberto (server:join) - mesmo sem
// ter entrado nesse canal específico - sobre a lista atual de participantes
// da voz. Lê do Redis (fonte de verdade do roster, ver voicePresence.js) em
// vez do Map em memória do mediasoup - assim continua correto entre
// múltiplas instâncias e depois de um restart deste processo.
async function broadcastVoicePresence(io, channelId, serverId) {
  const participants = await listVoicePresence(channelId);
  const targets = serverId ? [voiceRoomOf(channelId), serverId] : voiceRoomOf(channelId);
  io.to(targets).emit('voice:update', { channelId, participants });
  return participants;
}

// Sai da chamada de voz de um canal - corpo compartilhado entre 'media:leave'
// (o próprio usuário saindo), 'disconnect' (socket caiu) e
// 'voice:moderateDisconnect' (um moderador desconectando outro usuário):
// mesma limpeza de estado nos três casos, só muda QUEM disparou.
async function leaveVoiceChannel(io, { channelId, socketId, userId }) {
  const closedProducerIds = removePeer(channelId, socketId);
  for (const producerId of closedProducerIds) {
    io.to(voiceRoomOf(channelId)).except(socketId).emit('media:producerClosed', { producerId });
  }
  await removeVoicePresence(channelId, userId, socketId);
  io.sockets.sockets.get(socketId)?.leave(voiceRoomOf(channelId));
  if (isCallChannel(channelId)) await handleCallLeave(io, channelId, userId);
}

// Checagem de permissão de SERVIDOR (não de canal) para as ações de
// moderação abaixo - resolve channelId -> server -> bitmask do MODERADOR.
// Devolve { error } pronto pra virar ack(), ou { channel, room } em caso de
// sucesso.
async function authorizeModeration(user, channelId, flag) {
  if (isCallChannel(channelId)) return { error: 'Ação não permitida em chamadas privadas.' };

  const channel = await findChannelById(channelId);
  if (!channel) return { error: 'Canal não encontrado.' };
  if (channel.type !== 'voice') return { error: 'Este canal não é de voz.' };

  const room = await findRoomById(channel.server_id);
  if (!room) return { error: 'Servidor não encontrado.' };

  const bitmask = await getUserPermissionBitmask(channel.server_id, user.internalId);
  const allowed = checkPermission({ room, user, bitmask, flag });
  if (!allowed) return { error: 'Você não tem permissão para isso.' };

  return { channel, room };
}

// Ids de socket, dentro da sala mediasoup de um canal, que pertencem a um
// determinado usuário (public_id) - um usuário pode ter mais de uma
// aba/dispositivo conectado na mesma chamada.
function findPeerSocketIds(channelId, targetUserId) {
  const room = getRoom(channelId);
  if (!room) return [];
  const ids = [];
  for (const [socketId, peer] of room.peers.entries()) {
    if (peer.userId === targetUserId) ids.push(socketId);
  }
  return ids;
}

export function registerMediasoupHandlers(io, socket) {
  const user = socket.data.user;

  // Entrar na "sala de voz" mediasoup é uma etapa separada de channel:join
  // (chat/presença) - mas depende de uma checagem de autorização, e só é
  // permitido em canais do tipo 'voice' OU numa chamada privada (channelId
  // "call:<uuid>", ver calls.handler.js): dois "tipos" de sala de voz, MESMO
  // pipeline mediasoup dali em diante - só a checagem abaixo diverge (member
  // do servidor vs. participante convidado da chamada).
  socket.on('media:join', async (channelId, callback) => {
    const ack = wrapAck(callback);
    const parsed = mediaChannelIdSchema.safeParse(channelId);
    if (!parsed.success) return ack({ error: 'ID de canal inválido.' });
    const id = parsed.data;

    let serverId = null;
    if (isCallChannel(id)) {
      if (!(await isCallParticipant(id, user.id))) {
        return ack({ error: 'Você não faz parte dessa chamada.' });
      }
      // media:join sozinho já conta como aceite - cobre quem entra direto
      // (reentrada) sem passar de novo por call:accept.
      await setCallStatus(id, user.id, 'accepted');
    } else {
      const channel = await findChannelById(id);
      if (!channel) return ack({ error: 'Canal não encontrado.' });
      if (channel.type !== 'voice') return ack({ error: 'Este canal não é de voz.' });

      const member = await isRoomMember(channel.server_id, user.internalId);
      if (!member) return ack({ error: 'Você não é membro desse servidor.' });

      const room = await findRoomById(channel.server_id);
      const [bitmask, roleIds] = await Promise.all([
        getUserPermissionBitmask(channel.server_id, user.internalId),
        listRoleIdsForUser(channel.server_id, user.internalId),
      ]);
      const canView = canAccessChannel({ channel, room, user, bitmask, roleIds, action: 'view' });
      if (!canView) return ack({ error: 'Você não tem acesso a este canal.' });

      serverId = channel.server_id;
    }

    try {
      const room = await getOrCreateRoom(id);
      addPeer(id, socket.id, { userId: user.id, username: user.username });
      await addVoicePresence(id, user, socket.id);
      socket.data.voiceChannelId = id;
      socket.data.voiceServerId = serverId;
      // Garante que o socket receba media:newProducer e voice:update deste
      // canal mesmo que o usuário tenha entrado na voz a partir de um canal de
      // texto (sem ter feito channel:join no canal de voz).
      socket.join(voiceRoomOf(id));
      await broadcastVoicePresence(io, id, serverId);

      const lock = getLock(id, user.id);
      return ack({
        rtpCapabilities: room.router.rtpCapabilities,
        producers: listOtherProducers(id, socket.id),
        audioLocked: lock.audioLocked,
        mediaLocked: lock.mediaLocked,
      });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Não foi possível entrar na sala de voz.' });
    }
  });

  socket.on('media:createTransport', async ({ channelId, direction } = {}, callback) => {
    const ack = wrapAck(callback);
    const room = getRoom(channelId);
    const peer = getPeer(channelId, socket.id);
    if (!room || !peer) return ack({ error: 'Entre no canal de voz antes de criar um transporte.' });
    if (direction !== 'send' && direction !== 'recv') return ack({ error: 'Direção inválida.' });

    try {
      const transport = await room.router.createWebRtcTransport(webRtcTransportOptions);
      peer.transports.set(transport.id, transport);

      transport.on('dtlsstatechange', (state) => {
        if (state === 'closed' || state === 'failed') transport.close();
      });

      return ack({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Não foi possível criar o transporte de mídia.' });
    }
  });

  socket.on('media:connectTransport', async ({ channelId, transportId, dtlsParameters } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const transport = peer?.transports.get(transportId);
    if (!transport) return ack({ error: 'Transporte não encontrado.' });

    try {
      await transport.connect({ dtlsParameters });
      return ack({ ok: true });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Falha ao conectar transporte.' });
    }
  });

  socket.on('media:produce', async ({ channelId, transportId, kind, rtpParameters, appData } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const transport = peer?.transports.get(transportId);
    if (!transport) return ack({ error: 'Transporte não encontrado.' });
    if (kind !== 'audio' && kind !== 'video') return ack({ error: 'Tipo de mídia inválido.' });

    // Vídeo (webcam OU compartilhamento de tela, mesmo bit de permissão)
    // exige a role de compartilhamento do canal, quando definida, e é
    // recusado enquanto o moderador tiver travado a mídia deste usuário
    // (voice:moderateMedia mode:'lock') - checado aqui, não só escondido na
    // UI, porque é o servidor quem decide o que aceita transmitir.
    if (kind === 'video' && !isCallChannel(channelId)) {
      const lock = getLock(channelId, user.id);
      if (lock.mediaLocked) return ack({ error: 'Um moderador bloqueou sua mídia neste canal.' });

      const channel = await findChannelById(channelId);
      if (channel) {
        const room = await findRoomById(channel.server_id);
        const [bitmask, roleIds] = await Promise.all([
          getUserPermissionBitmask(channel.server_id, user.internalId),
          listRoleIdsForUser(channel.server_id, user.internalId),
        ]);
        const canShare = canAccessChannel({ channel, room, user, bitmask, roleIds, action: 'share' });
        if (!canShare) return ack({ error: 'Você não tem permissão para compartilhar mídia neste canal.' });
      }
    }

    try {
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { ...appData, userId: user.id, username: user.username },
      });
      peer.producers.set(producer.id, producer);

      // Áudio travado (voice:moderateMute mode:'lock'): o produtor é aceito
      // (não quebra a negociação do cliente) mas nasce pausado - o próprio
      // usuário não consegue reverter isso via media:setProducerPaused
      // enquanto a trava existir (ver handler abaixo).
      if (kind === 'audio' && getLock(channelId, user.id).audioLocked) {
        await producer.pause();
      }

      socket.to(voiceRoomOf(channelId)).emit('media:newProducer', {
        producerId: producer.id,
        userId: user.id,
        username: user.username,
        kind: producer.kind,
        appData: producer.appData,
      });

      return ack({ id: producer.id });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Não foi possível transmitir mídia.' });
    }
  });

  socket.on('media:consume', async ({ channelId, transportId, producerId, rtpCapabilities } = {}, callback) => {
    const ack = wrapAck(callback);
    const room = getRoom(channelId);
    const peer = getPeer(channelId, socket.id);
    const transport = peer?.transports.get(transportId);
    if (!room || !transport) return ack({ error: 'Transporte não encontrado.' });

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      return ack({ error: 'Não é possível consumir essa mídia.' });
    }

    try {
      const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);

      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        socket.emit('media:producerClosed', { producerId });
      });

      return ack({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Não foi possível consumir mídia.' });
    }
  });

  socket.on('media:resumeConsumer', async ({ channelId, consumerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const consumer = peer?.consumers.get(consumerId);
    if (!consumer) return ack({ error: 'Consumidor não encontrado.' });

    await consumer.resume();
    return ack({ ok: true });
  });

  // Mute/unmute: pausa o producer em vez de fechá-lo, é mais barato e mais
  // rápido de reverter do que recriar tudo a cada toggle de microfone.
  socket.on('media:setProducerPaused', async ({ channelId, producerId, paused } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) return ack({ error: 'Transmissão não encontrada.' });

    // Áudio travado por um moderador (mode:'lock'): o próprio usuário não
    // consegue se desmutar sozinho até um moderador destravar.
    if (producer.kind === 'audio' && paused === false && getLock(channelId, user.id).audioLocked) {
      return ack({ error: 'Um moderador bloqueou seu áudio neste canal.' });
    }

    if (paused) await producer.pause();
    else await producer.resume();

    socket.to(voiceRoomOf(channelId)).emit('media:producerStateChanged', { producerId, paused: Boolean(paused) });
    return ack({ ok: true });
  });

  socket.on('media:closeProducer', async ({ channelId, producerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) return ack({ error: 'Transmissão não encontrada.' });

    producer.close();
    peer.producers.delete(producerId);
    io.to(voiceRoomOf(channelId)).emit('media:producerClosed', { producerId });
    return ack({ ok: true });
  });

  socket.on('media:leave', async (channelId, callback) => {
    const ack = wrapAck(callback);
    const serverId = socket.data.voiceServerId;
    await leaveVoiceChannel(io, { channelId, socketId: socket.id, userId: user.id });
    if (socket.data.voiceChannelId === channelId) {
      socket.data.voiceChannelId = null;
      socket.data.voiceServerId = null;
    }
    await broadcastVoicePresence(io, channelId, serverId);
    return ack({ ok: true });
  });

  socket.on('disconnect', async () => {
    const channelId = socket.data.voiceChannelId;
    if (!channelId) return;
    const serverId = socket.data.voiceServerId;
    await leaveVoiceChannel(io, { channelId, socketId: socket.id, userId: user.id });
    await broadcastVoicePresence(io, channelId, serverId);
  });

  // --- Moderação de voz (permissões de servidor: mover/mutar/desconectar/
  // desligar mídia de outro usuário) ---------------------------------------

  socket.on('voice:moderateMute', async ({ channelId, targetUserId, muted, mode } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsedChannel = mediaChannelIdSchema.safeParse(channelId);
    const parsedTarget = userIdParamSchema.safeParse(targetUserId);
    if (!parsedChannel.success || !parsedTarget.success) return ack({ error: 'Dados inválidos.' });

    const auth = await authorizeModeration(user, parsedChannel.data, PERMISSIONS.MUTE_MEMBERS);
    if (auth.error) return ack({ error: auth.error });

    const isLockMode = mode === 'lock';
    const lock = setLock(parsedChannel.data, parsedTarget.data, isLockMode ? { audioLocked: Boolean(muted) } : {});

    const room = getRoom(parsedChannel.data);
    for (const socketId of findPeerSocketIds(parsedChannel.data, parsedTarget.data)) {
      const peer = room?.peers.get(socketId);
      if (!peer) continue;
      for (const producer of peer.producers.values()) {
        if (producer.kind !== 'audio') continue;
        if (muted) await producer.pause();
        else if (!lock.audioLocked) await producer.resume();
        io.to(voiceRoomOf(parsedChannel.data)).emit('media:producerStateChanged', {
          producerId: producer.id,
          paused: Boolean(muted),
        });
      }
    }

    io.to(`user:${parsedTarget.data}`).emit('voice:audioModerated', {
      channelId: parsedChannel.data,
      muted: Boolean(muted),
      locked: lock.audioLocked,
    });
    return ack({ ok: true });
  });

  socket.on('voice:moderateMedia', async ({ channelId, targetUserId, disabled, mode } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsedChannel = mediaChannelIdSchema.safeParse(channelId);
    const parsedTarget = userIdParamSchema.safeParse(targetUserId);
    if (!parsedChannel.success || !parsedTarget.success) return ack({ error: 'Dados inválidos.' });

    const auth = await authorizeModeration(user, parsedChannel.data, PERMISSIONS.DISABLE_MEDIA);
    if (auth.error) return ack({ error: auth.error });

    const isLockMode = mode === 'lock';
    const lock = setLock(parsedChannel.data, parsedTarget.data, isLockMode ? { mediaLocked: Boolean(disabled) } : {});

    if (disabled) {
      const room = getRoom(parsedChannel.data);
      for (const socketId of findPeerSocketIds(parsedChannel.data, parsedTarget.data)) {
        const peer = room?.peers.get(socketId);
        if (!peer) continue;
        for (const [producerId, producer] of Array.from(peer.producers.entries())) {
          if (producer.kind !== 'video') continue;
          producer.close();
          peer.producers.delete(producerId);
          io.to(voiceRoomOf(parsedChannel.data)).emit('media:producerClosed', { producerId });
        }
      }
    }

    io.to(`user:${parsedTarget.data}`).emit('voice:mediaModerated', {
      channelId: parsedChannel.data,
      disabled: Boolean(disabled),
      locked: lock.mediaLocked,
    });
    return ack({ ok: true });
  });

  socket.on('voice:moderateDisconnect', async ({ channelId, targetUserId } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsedChannel = mediaChannelIdSchema.safeParse(channelId);
    const parsedTarget = userIdParamSchema.safeParse(targetUserId);
    if (!parsedChannel.success || !parsedTarget.success) return ack({ error: 'Dados inválidos.' });

    const auth = await authorizeModeration(user, parsedChannel.data, PERMISSIONS.DISCONNECT_MEMBERS);
    if (auth.error) return ack({ error: auth.error });

    const targetSocketIds = findPeerSocketIds(parsedChannel.data, parsedTarget.data);
    for (const socketId of targetSocketIds) {
      await leaveVoiceChannel(io, { channelId: parsedChannel.data, socketId, userId: parsedTarget.data });
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket?.data?.voiceChannelId === parsedChannel.data) {
        targetSocket.data.voiceChannelId = null;
        targetSocket.data.voiceServerId = null;
      }
    }
    await broadcastVoicePresence(io, parsedChannel.data, auth.channel.server_id);
    io.to(`user:${parsedTarget.data}`).emit('voice:kicked', { channelId: parsedChannel.data });
    return ack({ ok: true });
  });

  socket.on('voice:moderateMove', async ({ channelId, targetUserId, toChannelId } = {}, callback) => {
    const ack = wrapAck(callback);
    const parsedChannel = mediaChannelIdSchema.safeParse(channelId);
    const parsedTo = channelIdParamSchema.safeParse(toChannelId);
    const parsedTarget = userIdParamSchema.safeParse(targetUserId);
    if (!parsedChannel.success || !parsedTo.success || !parsedTarget.success) {
      return ack({ error: 'Dados inválidos.' });
    }

    const auth = await authorizeModeration(user, parsedChannel.data, PERMISSIONS.MOVE_MEMBERS);
    if (auth.error) return ack({ error: auth.error });

    const toChannel = await findChannelById(parsedTo.data);
    if (!toChannel || toChannel.type !== 'voice' || toChannel.server_id !== auth.channel.server_id) {
      return ack({ error: 'Canal de destino inválido.' });
    }

    // Não mexe no mediasoup diretamente daqui - o client do ALVO é quem
    // executa leaveVoice()+joinVoice(toChannelId) ao receber este evento,
    // reaproveitando toda a renegociação de transports que ele já sabe fazer.
    io.to(`user:${parsedTarget.data}`).emit('voice:forceMove', {
      fromChannelId: parsedChannel.data,
      toChannelId: parsedTo.data,
      toChannelName: toChannel.name,
    });
    return ack({ ok: true });
  });
}
