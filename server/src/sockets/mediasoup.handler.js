import { isRoomMember } from '../db/rooms.repo.js';
import { roomIdParamSchema } from '../validation/schemas.js';
import { webRtcTransportOptions } from '../mediasoup/config.js';
import {
  getOrCreateRoom,
  getRoom,
  addPeer,
  getPeer,
  removePeer,
  listOtherProducers,
} from '../mediasoup/rooms.js';

function wrapAck(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

export function registerMediasoupHandlers(io, socket) {
  const user = socket.data.user;

  // Entrar na "sala de voz" mediasoup é uma etapa separada de room:join (chat) -
  // mas depende da MESMA checagem de membership no banco, então alguém não
  // pode ouvir/falar em uma sala que não pode nem ler o chat dela.
  socket.on('media:join', async (roomId, callback) => {
    const ack = wrapAck(callback);
    const parsed = roomIdParamSchema.safeParse(roomId);
    if (!parsed.success) return ack({ error: 'ID de sala inválido.' });

    const member = await isRoomMember(parsed.data, user.id);
    if (!member) return ack({ error: 'Você não é membro dessa sala.' });

    try {
      const room = await getOrCreateRoom(parsed.data);
      addPeer(parsed.data, socket.id, { userId: user.id, username: user.username });
      socket.data.voiceRoomId = parsed.data;

      return ack({
        rtpCapabilities: room.router.rtpCapabilities,
        producers: listOtherProducers(parsed.data, socket.id),
      });
    } catch (err) {
      console.error(err);
      return ack({ error: 'Não foi possível entrar na sala de voz.' });
    }
  });

  socket.on('media:createTransport', async ({ roomId, direction } = {}, callback) => {
    const ack = wrapAck(callback);
    const room = getRoom(roomId);
    const peer = getPeer(roomId, socket.id);
    if (!room || !peer) return ack({ error: 'Entre na sala de voz antes de criar um transporte.' });
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

  socket.on('media:connectTransport', async ({ roomId, transportId, dtlsParameters } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(roomId, socket.id);
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

  socket.on('media:produce', async ({ roomId, transportId, kind, rtpParameters, appData } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(roomId, socket.id);
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

      socket.to(roomId).emit('media:newProducer', {
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

  socket.on('media:consume', async ({ roomId, transportId, producerId, rtpCapabilities } = {}, callback) => {
    const ack = wrapAck(callback);
    const room = getRoom(roomId);
    const peer = getPeer(roomId, socket.id);
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

  socket.on('media:resumeConsumer', async ({ roomId, consumerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(roomId, socket.id);
    const consumer = peer?.consumers.get(consumerId);
    if (!consumer) return ack({ error: 'Consumidor não encontrado.' });

    await consumer.resume();
    return ack({ ok: true });
  });

  // Mute/unmute: pausa o producer em vez de fechá-lo, é mais barato e mais
  // rápido de reverter do que recriar tudo a cada toggle de microfone.
  socket.on('media:setProducerPaused', async ({ roomId, producerId, paused } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(roomId, socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) return ack({ error: 'Transmissão não encontrada.' });

    if (paused) await producer.pause();
    else await producer.resume();

    socket.to(roomId).emit('media:producerStateChanged', { producerId, paused: Boolean(paused) });
    return ack({ ok: true });
  });

  socket.on('media:closeProducer', async ({ roomId, producerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(roomId, socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) return ack({ error: 'Transmissão não encontrada.' });

    producer.close();
    peer.producers.delete(producerId);
    io.to(roomId).emit('media:producerClosed', { producerId });
    return ack({ ok: true });
  });

  socket.on('media:leave', (roomId, callback) => {
    const ack = wrapAck(callback);
    const closedProducerIds = removePeer(roomId, socket.id);
    for (const producerId of closedProducerIds) {
      socket.to(roomId).emit('media:producerClosed', { producerId });
    }
    if (socket.data.voiceRoomId === roomId) socket.data.voiceRoomId = null;
    return ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.voiceRoomId;
    if (!roomId) return;
    const closedProducerIds = removePeer(roomId, socket.id);
    for (const producerId of closedProducerIds) {
      socket.to(roomId).emit('media:producerClosed', { producerId });
    }
  });
}
