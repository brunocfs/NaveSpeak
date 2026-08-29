import { isRoomMember } from '../db/rooms.repo.js';
import { findChannelById } from '../db/channels.repo.js';
import { channelIdParamSchema } from '../validation/schemas.js';
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

export function registerMediasoupHandlers(io, socket) {
  const user = socket.data.user;

  // Entrar na "sala de voz" mediasoup é uma etapa separada de channel:join
  // (chat/presença) - mas depende da MESMA checagem de membership no banco, e
  // só é permitido em canais do tipo 'voice', então alguém não pode falar em
  // um canal de voz de um servidor do qual não é membro.
  socket.on('media:join', async (channelId, callback) => {
    const ack = wrapAck(callback);
    const parsed = channelIdParamSchema.safeParse(channelId);
    if (!parsed.success) return ack({ error: 'ID de canal inválido.' });

    const channel = await findChannelById(parsed.data);
    if (!channel) return ack({ error: 'Canal não encontrado.' });
    if (channel.type !== 'voice') return ack({ error: 'Este canal não é de voz.' });

    const member = await isRoomMember(channel.server_id, user.internalId);
    if (!member) return ack({ error: 'Você não é membro desse servidor.' });

    try {
      const room = await getOrCreateRoom(channel.id);
      addPeer(channel.id, socket.id, { userId: user.id, username: user.username });
      await addVoicePresence(channel.id, user, socket.id);
      socket.data.voiceChannelId = channel.id;
      socket.data.voiceServerId = channel.server_id;
      // Garante que o socket receba media:newProducer e voice:update deste
      // canal mesmo que o usuário tenha entrado na voz a partir de um canal de
      // texto (sem ter feito channel:join no canal de voz).
      socket.join(voiceRoomOf(channel.id));
      await broadcastVoicePresence(io, channel.id, channel.server_id);

      return ack({
        rtpCapabilities: room.router.rtpCapabilities,
        producers: listOtherProducers(channel.id, socket.id),
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

    try {
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { ...appData, userId: user.id, username: user.username },
      });
      peer.producers.set(producer.id, producer);

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
    const closedProducerIds = removePeer(channelId, socket.id);
    for (const producerId of closedProducerIds) {
      socket.to(voiceRoomOf(channelId)).emit('media:producerClosed', { producerId });
    }
    const serverId = socket.data.voiceServerId;
    if (socket.data.voiceChannelId === channelId) {
      socket.data.voiceChannelId = null;
      socket.data.voiceServerId = null;
    }
    await removeVoicePresence(channelId, user.id, socket.id);
    // Só quem estava DE FATO na chamada (voiceRoomOf) sai dessa room; a
    // membership na room de presença de canal (channelId, ver
    // presence.handler.js) é outra coisa e não é mexida aqui.
    socket.leave(voiceRoomOf(channelId));
    await broadcastVoicePresence(io, channelId, serverId);
    return ack({ ok: true });
  });

  socket.on('disconnect', async () => {
    const channelId = socket.data.voiceChannelId;
    if (!channelId) return;
    const serverId = socket.data.voiceServerId;
    const closedProducerIds = removePeer(channelId, socket.id);
    for (const producerId of closedProducerIds) {
      socket.to(voiceRoomOf(channelId)).emit('media:producerClosed', { producerId });
    }
    await removeVoicePresence(channelId, user.id, socket.id);
    await broadcastVoicePresence(io, channelId, serverId);
  });
}
