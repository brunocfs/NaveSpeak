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
import { addVoicePresence, removeVoicePresence, listVoicePresence, setVoiceMediaState } from './voicePresence.js';
import { isCallChannel, handleCallLeave } from './calls.handler.js';
import { isCallParticipant, setStatus as setCallStatus } from './callsStore.js';
import { getUserPermissionBitmask, listRoleIdsForUser } from '../db/roles.repo.js';
import { PERMISSIONS, checkPermission, canAccessChannel } from '../utils/permissions.js';
import { randomUUID } from 'node:crypto';
import { logger, audit } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';
import { logError } from '../observability/errors.js';
import { permissionName } from '../middleware/permissions.js';

function wrapAck(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

// ---- Observabilidade de voz/WebRTC ----------------------------------------
// Só metadados: IDs, estados, contagens, durações. Nunca iceParameters,
// iceCandidates, dtlsParameters, rtpParameters/capabilities ou mídia.

const MEDIA_SOURCES = new Set(['mic', 'camera', 'screen', 'screen-audio']);
const mediaSourceLabel = (source) => (MEDIA_SOURCES.has(source) ? source : 'other');

// Recusa de entrada na voz: o motivo real vai pro log/métrica; o cliente
// continua recebendo a mesma mensagem de antes.
const SUSPICIOUS_JOIN_DENIALS = new Set(['not_room_member', 'no_channel_access', 'not_call_participant']);
function denyJoin(ack, reasonCode, publicMessage, fields = {}) {
  metrics.voiceJoinDenied.inc({ reason: reasonCode });
  if (SUSPICIOUS_JOIN_DENIALS.has(reasonCode)) {
    audit('room_join_denied', { outcome: 'denied', reason_code: reasonCode, throttleKey: reasonCode, ...fields });
  } else {
    logger.info({ event: 'room_join_denied', outcome: 'denied', reason_code: reasonCode, ...fields }, 'Voice room join denied');
  }
  return ack({ error: publicMessage });
}

function logWebrtcFailure(stage, err, fields = {}) {
  metrics.webrtcFailures.inc({ stage });
  logError(
    'webrtc_negotiation_failed',
    err,
    { stage, error_code: `WEBRTC_${stage.toUpperCase()}_FAILED`, ...fields },
    'WebRTC negotiation step failed'
  );
}

// Eventos do transporte chegam do worker mediasoup, fora do contexto do
// socket - por isso os campos de correlação vão explícitos.
function instrumentTransport(transport, fields) {
  let iceState = transport.iceState;
  let degraded = false;
  transport.on('icestatechange', (state) => {
    metrics.webrtcStateChanges.inc({ type: 'ice', state });
    const previous = iceState;
    iceState = state;
    const recovered = degraded && (state === 'connected' || state === 'completed');
    logger[recovered ? 'info' : 'debug'](
      { ...fields, event: 'webrtc_ice_connection_state_changed', previous_state: previous, new_state: state },
      'WebRTC ICE state changed'
    );
    if (state === 'disconnected') {
      degraded = true;
      logger.warn({ ...fields, event: 'media_session_degraded', reason_code: 'ice_disconnected' }, 'Media session degraded');
    } else if (recovered) {
      degraded = false;
    }
  });
  transport.on('dtlsstatechange', (state) => {
    metrics.webrtcStateChanges.inc({ type: 'dtls', state });
    if (state === 'failed') {
      metrics.webrtcFailures.inc({ stage: 'dtls' });
      logger.warn(
        { ...fields, event: 'webrtc_peer_connection_failed', reason_code: 'dtls_failed', error_code: 'WEBRTC_DTLS_FAILED' },
        'WebRTC transport DTLS handshake failed'
      );
    }
  });
  logger.debug({ ...fields, event: 'webrtc_transport_created' }, 'WebRTC transport created');
}

function logVoiceSessionEnded(peer, { channelId, socketId, reason, producersClosed }) {
  const durationMs = Date.now() - peer.joinedAt;
  metrics.voiceSessionDuration.observe({ reason }, durationMs / 1000);
  const fields = {
    connection_id: socketId,
    user_id: peer.userId,
    channel_id: channelId,
    room_id: peer.serverId ?? undefined,
    session_id: peer.sessionId,
    reason_code: reason,
    duration_ms: durationMs,
  };
  logger.info({ event: 'room_leave', ...fields }, 'Voice room left');
  logger.info({ event: 'voice_session_ended', ...fields, producers_closed: producersClosed }, 'Voice session ended');
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

// Quem está ASSISTINDO a tela compartilhada de cada usuário, por canal - pro
// indicador de "N pessoas vendo"/lista de espectadores no tile de
// compartilhamento (ver ParticipantTile.jsx/VoicePanel.jsx). Client-driven
// (media:setScreenViewer): "assistindo" é decisão 100% de quem VÊ (mídia
// oculta, ou aguardando clique com autoplay desligado - ver VoicePanel.jsx),
// o servidor só agrega e distribui pra todo mundo no canal. Sem isso só
// existiria consumer ativo/inativo (que não reflete a UI: o consumer de
// tela fica ligado independente de o vídeo estar sendo mostrado ou não) -
// mesma motivação de setVoiceMediaState pro deafened, mas em memória local
// ao processo (mesma limitação de voiceLocks acima: não sobrevive a um
// restart, mas é só um indicador social da chamada ATIVA, não precisa).
const screenViewers = new Map(); // `${channelId}:${targetUserId}` -> Map<viewerUserId, viewerUsername>

function viewerKey(channelId, targetUserId) {
  return `${channelId}:${targetUserId}`;
}

function getScreenViewersList(channelId, targetUserId) {
  const viewers = screenViewers.get(viewerKey(channelId, targetUserId));
  if (!viewers) return [];
  return Array.from(viewers.entries()).map(([userId, username]) => ({ userId, username }));
}

function broadcastScreenViewers(io, channelId, targetUserId) {
  io.to(voiceRoomOf(channelId)).emit('voice:screenViewers', {
    targetUserId,
    viewers: getScreenViewersList(channelId, targetUserId),
  });
}

// Marca/desmarca `viewerUserId` como assistindo a tela de `targetUserId` -
// devolve `true` só se a lista mudou de fato, pra quem chama decidir se vale
// a pena rebroadcastar (media:setScreenViewer pode chegar repetido, ex.: dois
// re-renders seguidos do mesmo estado).
function setScreenViewer(channelId, targetUserId, viewerUserId, viewerUsername, watching) {
  const key = viewerKey(channelId, targetUserId);
  const viewers = screenViewers.get(key);
  if (watching) {
    if (viewers?.get(viewerUserId) === viewerUsername) return false;
    if (viewers) viewers.set(viewerUserId, viewerUsername);
    else screenViewers.set(key, new Map([[viewerUserId, viewerUsername]]));
    return true;
  }
  if (!viewers?.has(viewerUserId)) return false;
  viewers.delete(viewerUserId);
  if (viewers.size === 0) screenViewers.delete(key);
  return true;
}

// `targetUserId` parou de compartilhar tela (producer fechado, ou saiu da
// chamada) - todo mundo que estava "assistindo" ele some da lista de uma vez,
// pra um NOVO compartilhamento dele não nascer com espectadores fantasmas da
// sessão anterior.
function clearScreenViewersOfTarget(io, channelId, targetUserId) {
  if (!screenViewers.delete(viewerKey(channelId, targetUserId))) return;
  broadcastScreenViewers(io, channelId, targetUserId);
}

// Tira `viewerUserId` de QUALQUER lista de espectadores deste canal (ele
// saiu da chamada) - varre só as chaves deste canal, avisa cada alvo afetado.
function clearScreenViewer(io, channelId, viewerUserId) {
  const prefix = `${channelId}:`;
  for (const [key, viewers] of screenViewers.entries()) {
    if (!key.startsWith(prefix) || !viewers.delete(viewerUserId)) continue;
    const targetUserId = key.slice(prefix.length);
    if (viewers.size === 0) screenViewers.delete(key);
    broadcastScreenViewers(io, channelId, targetUserId);
  }
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
async function leaveVoiceChannel(io, { channelId, socketId, userId, reason = 'unknown' }) {
  const peer = getPeer(channelId, socketId);
  const closedProducerIds = removePeer(channelId, socketId);
  if (peer) logVoiceSessionEnded(peer, { channelId, socketId, reason, producersClosed: closedProducerIds.length });
  for (const producerId of closedProducerIds) {
    io.to(voiceRoomOf(channelId)).except(socketId).emit('media:producerClosed', { producerId });
  }
  await removeVoicePresence(channelId, userId, socketId);
  // Ele parou de assistir tudo que estava vendo, e se estava compartilhando
  // tela os espectadores dele também somem (ver comentário em
  // clearScreenViewersOfTarget acima).
  clearScreenViewer(io, channelId, userId);
  clearScreenViewersOfTarget(io, channelId, userId);
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
  if (!allowed) {
    audit('authorization_denied', {
      outcome: 'denied',
      reason_code: 'missing_permission',
      permission: permissionName(flag),
      channel_id: channelId,
      room_id: channel.server_id,
    });
    return { error: 'Você não tem permissão para isso.' };
  }

  return { channel, room };
}

// Ids de socket, dentro da sala mediasoup de um canal, que pertencem a um
// determinado usuário (public_id) - um usuário pode ter mais de uma
// aba/dispositivo conectado na mesma chamada.
// Mapeia appData.source do producer de vídeo pro campo correspondente do
// estado de mídia do roster (ver voicePresence.js) - 'mic' não entra aqui,
// esse é tratado à parte (é o único que pausa/resume em vez de nascer/morrer
// junto com o producer).
function mediaFieldForSource(source) {
  if (source === 'camera') return 'cameraOn';
  if (source === 'screen') return 'sharingScreen';
  return null;
}

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
    if (!parsed.success) return denyJoin(ack, 'invalid_channel_id', 'ID de canal inválido.');
    const id = parsed.data;
    logger.debug({ event: 'room_join_requested', channel_id: id }, 'Voice room join requested');

    let serverId = null;
    if (isCallChannel(id)) {
      if (!(await isCallParticipant(id, user.id))) {
        return denyJoin(ack, 'not_call_participant', 'Você não faz parte dessa chamada.', { channel_id: id });
      }
      // media:join sozinho já conta como aceite - cobre quem entra direto
      // (reentrada) sem passar de novo por call:accept.
      await setCallStatus(id, user.id, 'accepted');
    } else {
      const channel = await findChannelById(id);
      if (!channel) return denyJoin(ack, 'channel_not_found', 'Canal não encontrado.', { channel_id: id });
      if (channel.type !== 'voice') return denyJoin(ack, 'not_voice_channel', 'Este canal não é de voz.', { channel_id: id });

      const member = await isRoomMember(channel.server_id, user.internalId);
      if (!member) {
        return denyJoin(ack, 'not_room_member', 'Você não é membro desse servidor.', { channel_id: id, room_id: channel.server_id });
      }

      const room = await findRoomById(channel.server_id);
      const [bitmask, roleIds] = await Promise.all([
        getUserPermissionBitmask(channel.server_id, user.internalId),
        listRoleIdsForUser(channel.server_id, user.internalId),
      ]);
      const canView = canAccessChannel({ channel, room, user, bitmask, roleIds, action: 'view' });
      if (!canView) {
        return denyJoin(ack, 'no_channel_access', 'Você não tem acesso a este canal.', { channel_id: id, room_id: channel.server_id });
      }

      serverId = channel.server_id;
    }

    try {
      const room = await getOrCreateRoom(id);
      const sessionId = `vs-${randomUUID()}`;
      addPeer(id, socket.id, { userId: user.id, username: user.username, sessionId, serverId });
      await addVoicePresence(id, user, socket.id);
      socket.data.voiceChannelId = id;
      socket.data.voiceServerId = serverId;
      // Garante que o socket receba media:newProducer e voice:update deste
      // canal mesmo que o usuário tenha entrado na voz a partir de um canal de
      // texto (sem ter feito channel:join no canal de voz).
      socket.join(voiceRoomOf(id));
      await broadcastVoicePresence(io, id, serverId);

      const sessionFields = {
        channel_id: id,
        room_id: serverId ?? undefined,
        session_id: sessionId,
        voice_room_type: isCallChannel(id) ? 'private_call' : 'server_channel',
      };
      logger.info({ event: 'room_join_succeeded', outcome: 'success', ...sessionFields }, 'Voice room joined');
      logger.info({ event: 'voice_session_started', ...sessionFields }, 'Voice session started');

      const lock = getLock(id, user.id);
      return ack({
        rtpCapabilities: room.router.rtpCapabilities,
        producers: listOtherProducers(id, socket.id),
        audioLocked: lock.audioLocked,
        mediaLocked: lock.mediaLocked,
      });
    } catch (err) {
      logWebrtcFailure('join', err, { channel_id: id });
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
      instrumentTransport(transport, {
        connection_id: socket.id,
        user_id: user.id,
        channel_id: channelId,
        session_id: peer.sessionId,
        transport_direction: direction,
      });

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
      logWebrtcFailure('create_transport', err, { channel_id: channelId, transport_direction: direction });
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
      logWebrtcFailure('connect_transport', err, { channel_id: channelId, session_id: peer.sessionId });
      return ack({ error: 'Falha ao conectar transporte.' });
    }
  });

  socket.on('media:produce', async ({ channelId, transportId, kind, rtpParameters, appData, paused } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const transport = peer?.transports.get(transportId);
    if (!transport) return ack({ error: 'Transporte não encontrado.' });
    if (kind !== 'audio' && kind !== 'video') return ack({ error: 'Tipo de mídia inválido.' });

    // Áudio do compartilhamento de tela (appData.source 'screen-audio',
    // producer À PARTE do vídeo - ver startScreenAudio em
    // MediaSessionContext.jsx) é opcional mas ainda É compartilhamento de
    // mídia - sem essa checagem, alguém sem a role de compartilhamento (ou
    // travado por voice:moderateMedia) só não conseguiria mandar o VÍDEO da
    // tela mas o áudio do sistema passaria sozinho, driblando a restrição.
    const isScreenAudio = kind === 'audio' && appData?.source === 'screen-audio';

    // Vídeo (webcam OU compartilhamento de tela, mesmo bit de permissão) e o
    // áudio da tela acima exigem a role de compartilhamento do canal, quando
    // definida, e são recusados enquanto o moderador tiver travado a mídia
    // deste usuário (voice:moderateMedia mode:'lock') - checado aqui, não só
    // escondido na UI, porque é o servidor quem decide o que aceita transmitir.
    if ((kind === 'video' || isScreenAudio) && !isCallChannel(channelId)) {
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

      // Áudio nasce pausado em dois casos: (1) travado por moderador
      // (voice:moderateMute mode:'lock') - o próprio usuário não consegue
      // reverter isso via media:setProducerPaused enquanto a trava existir
      // (ver handler abaixo); (2) o cliente pediu (`paused: true`) porque o
      // usuário já estava mutado/ensurdecido ANTES deste producer nascer -
      // caso do reconnect (handleReconnect em MediaSessionContext.jsx), onde
      // sem isso o producer nasceria destravado e o `media:newProducer`
      // abaixo já teria avisado o resto do canal ANTES de qualquer
      // media:setProducerPaused subsequente chegar - janela real (proporcional
      // ao RTT) em que o mic transmite de verdade pros outros apesar do
      // usuário estar "ensurdecido" na UI. Pausar aqui, antes do broadcast,
      // fecha essa janela por completo em vez de só encurtá-la.
      if (kind === 'audio' && (Boolean(paused) || getLock(channelId, user.id).audioLocked)) {
        await producer.pause();
      }

      socket.to(voiceRoomOf(channelId)).emit('media:newProducer', {
        producerId: producer.id,
        userId: user.id,
        username: user.username,
        kind: producer.kind,
        appData: producer.appData,
        paused: producer.paused,
      });

      // Estado de mídia do roster (voice:update) - câmera/tela nascem junto
      // com o producer (ao contrário do mic, que nasce e só pausa depois),
      // então já entram como ligadas aqui. Áudio só entra aqui se já nasceu
      // travado acima; o toggle normal de mute passa por
      // media:setProducerPaused, não por aqui.
      const mediaField = kind === 'video' ? mediaFieldForSource(appData?.source) : null;
      if (mediaField || (kind === 'audio' && producer.paused)) {
        await setVoiceMediaState(channelId, user.id, {
          ...(mediaField ? { [mediaField]: true } : {}),
          ...(kind === 'audio' && producer.paused ? { micMuted: true } : {}),
        });
        await broadcastVoicePresence(io, channelId, socket.data.voiceServerId);
      }

      logger.debug(
        { event: 'webrtc_producer_created', channel_id: channelId, session_id: peer.sessionId, media_kind: kind, media_source: mediaSourceLabel(appData?.source), paused: producer.paused },
        'WebRTC producer created'
      );
      return ack({ id: producer.id });
    } catch (err) {
      logWebrtcFailure('produce', err, { channel_id: channelId, session_id: peer.sessionId, media_kind: kind });
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
      metrics.webrtcFailures.inc({ stage: 'can_consume' });
      return ack({ error: 'Não é possível consumir essa mídia.' });
    }

    try {
      const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);

      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        socket.emit('media:producerClosed', { producerId });
      });

      logger.debug(
        { event: 'webrtc_consumer_created', channel_id: channelId, session_id: peer.sessionId, media_kind: consumer.kind },
        'WebRTC consumer created'
      );
      return ack({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      logWebrtcFailure('consume', err, { channel_id: channelId, session_id: peer.sessionId });
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

    if (producer.kind === 'audio') {
      await setVoiceMediaState(channelId, user.id, { micMuted: Boolean(paused) });
      await broadcastVoicePresence(io, channelId, socket.data.voiceServerId);
    }
    return ack({ ok: true });
  });

  socket.on('media:closeProducer', async ({ channelId, producerId } = {}, callback) => {
    const ack = wrapAck(callback);
    const peer = getPeer(channelId, socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) return ack({ error: 'Transmissão não encontrada.' });

    const mediaField = producer.kind === 'video' ? mediaFieldForSource(producer.appData?.source) : null;
    producer.close();
    peer.producers.delete(producerId);
    io.to(voiceRoomOf(channelId)).emit('media:producerClosed', { producerId });

    if (mediaField) {
      await setVoiceMediaState(channelId, user.id, { [mediaField]: false });
      await broadcastVoicePresence(io, channelId, socket.data.voiceServerId);
    }
    // Parou de compartilhar ESTA tela - espectadores da sessão anterior não
    // podem "vazar" pra um compartilhamento futuro dele no mesmo canal.
    if (mediaField === 'sharingScreen') clearScreenViewersOfTarget(io, channelId, user.id);
    return ack({ ok: true });
  });

  // "Silenciar todos" (deafen): não é um producer (não tem o que pausar/
  // fechar), é só "eu não quero ouvir ninguém" do lado de quem ensurdece -
  // mas igual mic/câmera/tela, o resto do servidor precisa ver o ícone no
  // roster (RoomPage.jsx via voice:update), não só o próprio usuário. Sem
  // ack proposital (ver toggleDeafen em MediaSessionContext.jsx - fire-and-
  // forget, o toggle local já aconteceu e não há como "falhar" de um jeito
  // que precise desfazer).
  socket.on('media:setDeafened', async ({ channelId, deafened } = {}) => {
    const parsed = mediaChannelIdSchema.safeParse(channelId);
    if (!parsed.success) return;
    const peer = getPeer(parsed.data, socket.id);
    if (!peer) return;

    await setVoiceMediaState(parsed.data, user.id, { deafened: Boolean(deafened) });
    await broadcastVoicePresence(io, parsed.data, socket.data.voiceServerId);
  });

  // Reporta "estou assistindo (ou parei de assistir) a tela compartilhada de
  // targetUserId" - quem decide isso é o CLIENTE (VoicePanel.jsx: mídia
  // oculta, ou aguardando clique com autoplay desligado, não conta como
  // assistindo), aqui só agrega entre espectadores e distribui pra todo
  // mundo no canal via voice:screenViewers, pro indicador no tile de quem
  // compartilha. Fire-and-forget igual media:setDeafened acima - sem ação a
  // desfazer se isto não chegar.
  socket.on('media:setScreenViewer', ({ channelId, targetUserId, watching } = {}) => {
    const parsedChannel = mediaChannelIdSchema.safeParse(channelId);
    const parsedTarget = userIdParamSchema.safeParse(targetUserId);
    if (!parsedChannel.success || !parsedTarget.success) return;
    // Só conta espectador quem de fato está na chamada deste canal.
    if (!getPeer(parsedChannel.data, socket.id)) return;

    const changed = setScreenViewer(
      parsedChannel.data,
      parsedTarget.data,
      user.id,
      user.username,
      Boolean(watching),
    );
    if (changed) broadcastScreenViewers(io, parsedChannel.data, parsedTarget.data);
  });

  socket.on('media:leave', async (channelId, callback) => {
    const ack = wrapAck(callback);
    const serverId = socket.data.voiceServerId;
    await leaveVoiceChannel(io, { channelId, socketId: socket.id, userId: user.id, reason: 'user_left' });
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
    await leaveVoiceChannel(io, { channelId, socketId: socket.id, userId: user.id, reason: 'disconnected' });
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

    await setVoiceMediaState(parsedChannel.data, parsedTarget.data, { micMuted: Boolean(muted) });
    await broadcastVoicePresence(io, parsedChannel.data, auth.channel.server_id);

    audit('voice_moderation_applied', {
      action: 'mute',
      mode: isLockMode ? 'lock' : 'once',
      enabled: Boolean(muted),
      target_user_id: parsedTarget.data,
      channel_id: parsedChannel.data,
      room_id: auth.channel.server_id,
    });
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
          // Vídeo (webcam/tela) OU o áudio à parte do compartilhamento de
          // tela (kind 'audio', appData.source 'screen-audio') - sem a
          // segunda parte, desligar a mídia de alguém deixava o áudio da
          // tela dele tocando sozinho, sem vídeo nenhum por trás.
          const isScreenAudio = producer.kind === 'audio' && producer.appData?.source === 'screen-audio';
          if (producer.kind !== 'video' && !isScreenAudio) continue;
          producer.close();
          peer.producers.delete(producerId);
          io.to(voiceRoomOf(parsedChannel.data)).emit('media:producerClosed', { producerId });
        }
      }
      // Desligou os dois de uma vez (o producer que não existia já estava
      // false, setVoiceMediaState só sobrescreve o que é passado).
      await setVoiceMediaState(parsedChannel.data, parsedTarget.data, {
        cameraOn: false,
        sharingScreen: false,
      });
      await broadcastVoicePresence(io, parsedChannel.data, auth.channel.server_id);
      clearScreenViewersOfTarget(io, parsedChannel.data, parsedTarget.data);
    }

    audit('voice_moderation_applied', {
      action: 'disable_media',
      mode: isLockMode ? 'lock' : 'once',
      enabled: Boolean(disabled),
      target_user_id: parsedTarget.data,
      channel_id: parsedChannel.data,
      room_id: auth.channel.server_id,
    });
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
      await leaveVoiceChannel(io, { channelId: parsedChannel.data, socketId, userId: parsedTarget.data, reason: 'moderator_disconnect' });
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket?.data?.voiceChannelId === parsedChannel.data) {
        targetSocket.data.voiceChannelId = null;
        targetSocket.data.voiceServerId = null;
      }
    }
    await broadcastVoicePresence(io, parsedChannel.data, auth.channel.server_id);
    audit('voice_moderation_applied', {
      action: 'disconnect',
      target_user_id: parsedTarget.data,
      target_sessions: targetSocketIds.length,
      channel_id: parsedChannel.data,
      room_id: auth.channel.server_id,
    });
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
    audit('voice_moderation_applied', {
      action: 'move',
      target_user_id: parsedTarget.data,
      channel_id: parsedChannel.data,
      to_channel_id: parsedTo.data,
      room_id: auth.channel.server_id,
    });
    io.to(`user:${parsedTarget.data}`).emit('voice:forceMove', {
      fromChannelId: parsedChannel.data,
      toChannelId: parsedTo.data,
      toChannelName: toChannel.name,
    });
    return ack({ ok: true });
  });
}
