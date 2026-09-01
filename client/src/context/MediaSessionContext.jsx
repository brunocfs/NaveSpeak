import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import { getSocket } from '../api/socket.js';
import {
  requestScreenStream,
  requestCameraStream,
  requestMicStream,
  assertMediaDevicesAvailable,
} from '../api/media.js';
import { useWindowPopout } from '../hooks/useWindowPopout.js';
import { usePreferences } from './PreferencesContext.jsx';

function emitAsync(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (response?.error) reject(new Error(response.error));
      else resolve(response ?? {});
    });
  });
}

const MediaSessionContext = createContext(null);

// Encapsula toda a integração com mediasoup-client (voz na Fase 3; tela e
// câmera na Fase 4 reaproveitam o mesmo sendTransport via produceTrack).
//
// IMPORTANTE: este provider é montado uma única vez em App.jsx, ACIMA de
// <Routes> - não dentro de RoomPage. A conexão de voz é INDEPENDENTE não só
// do canal de texto sendo visualizado, mas da TELA inteira: trocar de rota
// (ex.: sala -> tela inicial) nunca desmonta este componente, então o efeito
// de limpeza no fim do arquivo só dispara quando o app inteiro desmonta (fechar
// a aba) ou por chamada explícita a leaveVoice(). Antes disso vivia como hook
// local em RoomPage, e cada saída da tela de sala desmontava o hook e derrubava
// a chamada - esse era o bug.
export function MediaSessionProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [voiceChannelId, setVoiceChannelId] = useState(null);
  // Metadados só de exibição (nome da sala/canal) para a barra global
  // (VoiceStatusBar) conseguir mostrar "Na voz em X" e linkar de volta pra
  // sala mesmo quando a tela atual não é mais a da sala (ex.: tela inicial).
  // Não participam da lógica de mediasoup - só o que RoomPage passou ao
  // chamar joinVoice.
  const [voiceRoomId, setVoiceRoomId] = useState(null);
  const [voiceMeta, setVoiceMeta] = useState({ roomName: null, channelName: null });
  // Roster (userId/username) do canal de voz ao qual estamos conectados -
  // igual ao que RoomPage já mantinha por servidor em `voiceRosters`, mas
  // aqui filtrado só pro canal ativo e vivendo no provider global, para o
  // VoicePanel (também global, ver abaixo) montar a grade de participantes
  // sem depender de RoomPage estar montada.
  const [voiceRoster, setVoiceRoster] = useState([]);
  // Nó DOM onde o VoicePanel embutido deve portar seu conteúdo quando NÃO
  // está destacado em popout - registrado por quem estiver exibindo a UI de
  // voz embutida no momento (hoje só RoomPage, quando é o canal de voz
  // ativo). null quando nenhuma tela está exibindo o painel embutido (ex.:
  // usuário na tela inicial) - nesse caso o VoicePanel só aparece se também
  // houver um popout aberto.
  const [panelAnchor, setPanelAnchor] = useState(null);
  // Janela destacada do painel de voz (ver useWindowPopout) - vive aqui, não
  // dentro de VoicePanel, para sobreviver à troca de tela: antes ficava presa
  // ao ciclo de vida de VoicePanel (montado só dentro de RoomPage) e por isso
  // fechava sozinha ao voltar pra tela inicial.
  const { popout, open: openPopout, close: closePopout } = useWindowPopout();
  const [muted, setMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [error, setError] = useState(null);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [localCameraStream, setLocalCameraStream] = useState(null);
  // "Silenciar todos" (deafen): para de reproduzir o áudio de todo mundo.
  // Ao ativar, também silencia o próprio microfone (como no Discord); ao
  // desativar, só reativa o mic se ele não estava mutado por escolha do
  // usuário antes do deafen (guardado em wasMutedBeforeDeafenRef).
  const [deafened, setDeafened] = useState(false);
  const wasMutedBeforeDeafenRef = useRef(false);
  // Espelham `muted`/`deafened` sempre atualizados, pra handleReconnect (mais
  // abaixo) ler o valor ATUAL sem precisar re-registrar os listeners de
  // socket a cada toggle (ele vive num useEffect com deps fixas, então uma
  // closure normal capturaria o valor do primeiro render pra sempre).
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);
  // Travas de moderação (voice:moderateMute/voice:moderateMedia mode:'lock',
  // ver server/src/sockets/mediasoup.handler.js) sobre o PRÓPRIO usuário no
  // canal de voz atual - enquanto true, o próprio usuário não consegue
  // reverter sozinho (toggleMute/shareCamera/shareScreen abaixo recusam).
  const [audioLocked, setAudioLocked] = useState(false);
  const [mediaLocked, setMediaLocked] = useState(false);

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const localStreamRef = useRef(null);
  const micProducerRef = useRef(null);
  const screenProducerRef = useRef(null);
  const cameraProducerRef = useRef(null);
  const consumersRef = useRef(new Map());
  // Guardam sempre a versão mais atual de stopScreenShare/stopCamera, para
  // que os listeners 'ended' registrados no momento da captura (que não
  // podem depender de um valor de closure que muda a cada render) chamem a
  // implementação certa mesmo depois de reconexões/re-renders.
  const stopScreenShareRef = useRef(() => {});
  const stopCameraRef = useRef(() => {});
  // Sempre a versão mais atual de leaveVoice/joinVoice, para o handler de
  // reconexão do socket (registrado antes delas existirem) chamar a
  // implementação certa.
  const leaveVoiceRef = useRef(() => {});
  const joinVoiceRef = useRef(() => {});

  // Canal de voz atual (pode ser diferente do canal sendo visualizado).
  const channelIdRef = useRef(null);

  const socket = getSocket();
  // Preferência de dispositivo salva em Preferências > Dispositivos -
  // reaproveitada aqui ao entrar na voz (mic) e ao ligar a câmera. null =
  // padrão do sistema. O fallback de dispositivo removido acontece dentro
  // de requestMicStream/requestCameraStream (api/media.js).
  const { micDeviceId, cameraDeviceId } = usePreferences();

  const addRemoteStream = useCallback((entry) => {
    setRemoteStreams((prev) => [...prev.filter((s) => s.producerId !== entry.producerId), entry]);
  }, []);

  const removeRemoteStream = useCallback((producerId) => {
    setRemoteStreams((prev) => prev.filter((s) => s.producerId !== producerId));
  }, []);

  const consumeProducer = useCallback(
    async ({ producerId, userId, username, kind, appData, paused }) => {
      if (!recvTransportRef.current || !deviceRef.current) return;
      try {
        const data = await emitAsync(socket, 'media:consume', {
          channelId: channelIdRef.current,
          transportId: recvTransportRef.current.id,
          producerId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        });
        const consumer = await recvTransportRef.current.consume({
          id: data.id,
          producerId: data.producerId,
          kind: data.kind,
          rtpParameters: data.rtpParameters,
        });
        consumersRef.current.set(producerId, consumer);
        await emitAsync(socket, 'media:resumeConsumer', {
          channelId: channelIdRef.current,
          consumerId: consumer.id,
        });

        const stream = new MediaStream([consumer.track]);
        // `paused` vem de quem chamou (listOtherProducers no media:join, ou
        // o payload de media:newProducer) - reflete o estado REAL do
        // producer no momento em que passamos a consumi-lo, não um "nasce
        // sempre tocando" hardcoded. Sem isso, entrar num canal com alguém
        // já mutado mostrava o mic dele como ativo até o próximo toggle.
        addRemoteStream({ producerId, userId, username, kind, appData, stream, paused: Boolean(paused) });
      } catch (err) {
        console.error('Falha ao consumir mídia remota:', err.message);
      }
    },
    [socket, addRemoteStream]
  );

  useEffect(() => {
    function handleNewProducer(payload) {
      consumeProducer(payload);
    }
    function handleProducerClosed({ producerId }) {
      const consumer = consumersRef.current.get(producerId);
      consumer?.close();
      consumersRef.current.delete(producerId);
      removeRemoteStream(producerId);
    }
    function handleStateChanged({ producerId, paused }) {
      setRemoteStreams((prev) => prev.map((s) => (s.producerId === producerId ? { ...s, paused } : s)));
    }
    // Roster do canal de voz conectado - só atualiza se for o canal em que
    // estamos (o servidor manda voice:update de todo canal de voz do
    // servidor, RoomPage usa o mesmo evento pra popular a barra lateral).
    function handleVoiceUpdate(update) {
      if (update.channelId === channelIdRef.current) setVoiceRoster(update.participants ?? []);
    }

    // Reconexão do socket (queda de rede, ou o servidor reiniciou): o
    // transporte WebRTC anterior morreu junto com a conexão antiga, mediasoup
    // não tem como sobreviver a isso. Se o usuário estava numa chamada
    // (channelIdRef ainda setado - só é limpo por uma saída explícita),
    // refaz a entrada na voz automaticamente em vez de deixá-lo "preso" numa
    // chamada morta até ele perceber e reentrar na mão.
    async function handleReconnect() {
      const channelId = channelIdRef.current;
      if (!channelId) return;
      // Captura ANTES de leaveVoiceRef - leaveVoice (chamado logo abaixo,
      // mesmo com keepMeta) sempre reseta muted/deafened pra false, porque
      // ele também serve pra sair de vez da chamada. joinVoice, por sua vez,
      // sempre cria o producer de mic NOVO e destravado. Sem recapturar e
      // reaplicar aqui, qualquer queda de rede (ou reinício do servidor, que
      // também derruba o socket) reconectava o usuário sempre destravado -
      // o mic voltava a transmitir de verdade e o ícone de ensurdecido
      // sumia pros outros, mesmo que ele tivesse mutado/ensurdecido de
      // propósito antes de cair.
      const wasMuted = mutedRef.current;
      const wasDeafened = deafenedRef.current;
      await leaveVoiceRef.current({ keepMeta: true });
      await joinVoiceRef.current(channelId);

      if (wasMuted || wasDeafened) {
        const producer = micProducerRef.current;
        if (producer) {
          try {
            await emitAsync(socket, 'media:setProducerPaused', {
              channelId,
              producerId: producer.id,
              paused: true,
            });
            producer.pause();
          } catch (err) {
            console.error('Falha ao reaplicar mute após reconexão:', err.message);
          }
        }
        setMuted(true);
      }
      if (wasDeafened) {
        setDeafened(true);
        socket.emit('media:setDeafened', { channelId, deafened: true });
      }
    }

    // Desconexão explícita do socket (hoje só acontece via disconnectSocket()
    // no logout, em AuthContext) - diferente de uma queda de rede, aqui não
    // há por que tentar reconectar, e como este provider vive acima de
    // <Routes> ele NÃO desmonta ao redirecionar para /login. Sem isso, uma
    // chamada ativa continuaria com câmera/mic ligados e transports "vivos"
    // no cliente mesmo depois do logout.
    function handleDisconnect(reason) {
      if (reason === 'io client disconnect' && channelIdRef.current) {
        leaveVoiceRef.current();
      }
    }

    // Moderação sobre o PRÓPRIO usuário (voice:moderateMute/voice:moderateMedia,
    // ver mediasoup.handler.js) - só reflete se for o canal em que estamos
    // conectados agora; um moderador travando um canal que nem estamos
    // ouvindo não deve acender indicador nenhum aqui.
    function handleAudioModerated({ channelId, muted, locked }) {
      if (channelId !== channelIdRef.current) return;
      setAudioLocked(Boolean(locked));
      if (muted) {
        micProducerRef.current?.pause();
        setMuted(true);
      }
    }
    function handleMediaModerated({ channelId, disabled, locked }) {
      if (channelId !== channelIdRef.current) return;
      setMediaLocked(Boolean(locked));
      if (disabled) {
        // O servidor já fechou os producers de vídeo (webcam/tela) - só
        // espelha o estado local (o produtor em si já morreu, o cleanup
        // completo roda via stopScreenShareRef/stopCameraRef).
        if (screenProducerRef.current) stopScreenShareRef.current();
        if (cameraProducerRef.current) stopCameraRef.current();
      }
    }
    // Desconectado da voz por um moderador (voice:moderateDisconnect).
    function handleKicked({ channelId }) {
      if (channelId !== channelIdRef.current) return;
      setError('Você foi desconectado da voz por um moderador.');
      leaveVoiceRef.current();
    }
    // Movido para outro canal de voz por um moderador (voice:moderateMove) -
    // sai do atual e entra no novo automaticamente.
    async function handleForceMove({ fromChannelId, toChannelId, toChannelName }) {
      if (fromChannelId !== channelIdRef.current) return;
      await leaveVoiceRef.current({ keepMeta: true });
      await joinVoiceRef.current(toChannelId, { channelName: toChannelName });
    }

    socket.on('media:newProducer', handleNewProducer);
    socket.on('media:producerClosed', handleProducerClosed);
    socket.on('media:producerStateChanged', handleStateChanged);
    socket.on('voice:update', handleVoiceUpdate);
    socket.on('voice:audioModerated', handleAudioModerated);
    socket.on('voice:mediaModerated', handleMediaModerated);
    socket.on('voice:kicked', handleKicked);
    socket.on('voice:forceMove', handleForceMove);
    socket.on('connect', handleReconnect);
    socket.on('disconnect', handleDisconnect);
    return () => {
      socket.off('media:newProducer', handleNewProducer);
      socket.off('media:producerClosed', handleProducerClosed);
      socket.off('media:producerStateChanged', handleStateChanged);
      socket.off('voice:update', handleVoiceUpdate);
      socket.off('voice:audioModerated', handleAudioModerated);
      socket.off('voice:mediaModerated', handleMediaModerated);
      socket.off('voice:kicked', handleKicked);
      socket.off('voice:forceMove', handleForceMove);
      socket.off('connect', handleReconnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, consumeProducer, removeRemoteStream]);

  // Limpa toda a mídia local e avisa o servidor que saímos do canal de voz.
  // `keepMeta` é usado só pelo fluxo de reconexão (handleReconnect acima):
  // ele sai e volta a entrar no mesmo canal, então não faz sentido apagar e
  // reescrever voiceRoomId/voiceMeta - evita a barra global piscar.
  const leaveVoice = useCallback(
    async ({ keepMeta = false } = {}) => {
      const channelId = channelIdRef.current;
      if (channelId) socket.emit('media:leave', channelId);

      // Sem chamada ativa não há mais o que mostrar no popout - fecha
      // explicitamente em vez de depender de VoicePanel desmontar (ele é
      // global agora, não desmonta por causa disso).
      closePopout();
      setVoiceRoster([]);

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      micProducerRef.current = null;
      screenProducerRef.current = null;
      cameraProducerRef.current = null;

      for (const consumer of consumersRef.current.values()) consumer.close();
      consumersRef.current.clear();

      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      sendTransportRef.current = null;
      recvTransportRef.current = null;
      deviceRef.current = null;

      setRemoteStreams([]);
      setConnected(false);
      setMuted(false);
      setSharingScreen(false);
      setCameraOn(false);
      setDeafened(false);
      wasMutedBeforeDeafenRef.current = false;
      setAudioLocked(false);
      setMediaLocked(false);
      setLocalScreenStream((stream) => {
        stream?.getTracks().forEach((t) => t.stop());
        return null;
      });
      setLocalCameraStream((stream) => {
        stream?.getTracks().forEach((t) => t.stop());
        return null;
      });
      channelIdRef.current = null;
      setVoiceChannelId(null);
      if (!keepMeta) {
        setVoiceRoomId(null);
        setVoiceMeta({ roomName: null, channelName: null });
      }
    },
    [socket, closePopout]
  );

  useEffect(() => {
    leaveVoiceRef.current = leaveVoice;
  }, [leaveVoice]);

  // Só é chamado a partir de um clique explícito do usuário ("Entrar na
  // voz") - getUserMedia nunca dispara sozinho ao carregar a página. Recebe
  // o channelId do canal de voz alvo para que a conexão seja sempre
  // explícita, e opcionalmente `meta` ({ roomId, roomName, channelName }) -
  // só para exibição na barra global (VoiceStatusBar), sem efeito na lógica
  // de mediasoup.
  const joinVoice = useCallback(
    async (channelId, meta = {}) => {
      // Se já estava em outra chamada de voz, sai primeiro para não ficar em
      // dois canais ao mesmo tempo.
      if (channelIdRef.current && channelIdRef.current !== channelId) {
        await leaveVoice();
      }
      setError(null);
      try {
        channelIdRef.current = channelId;
        if (meta.roomId !== undefined) setVoiceRoomId(meta.roomId);
        setVoiceMeta({ roomName: meta.roomName ?? null, channelName: meta.channelName ?? null });
        const joinData = await emitAsync(socket, 'media:join', channelId);

        const device = new Device();
        await device.load({ routerRtpCapabilities: joinData.rtpCapabilities });
        deviceRef.current = device;

        const sendParams = await emitAsync(socket, 'media:createTransport', {
          channelId,
          direction: 'send',
        });
        const sendTransport = device.createSendTransport(sendParams);
        sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          emitAsync(socket, 'media:connectTransport', {
            channelId,
            transportId: sendTransport.id,
            dtlsParameters,
          })
            .then(() => callback())
            .catch(errback);
        });
        sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
          emitAsync(socket, 'media:produce', {
            channelId,
            transportId: sendTransport.id,
            kind,
            rtpParameters,
            appData,
          })
            .then(({ id }) => callback({ id }))
            .catch(errback);
        });
        sendTransportRef.current = sendTransport;

        const recvParams = await emitAsync(socket, 'media:createTransport', {
          channelId,
          direction: 'recv',
        });
        const recvTransport = device.createRecvTransport(recvParams);
        recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          emitAsync(socket, 'media:connectTransport', {
            channelId,
            transportId: recvTransport.id,
            dtlsParameters,
          })
            .then(() => callback())
            .catch(errback);
        });
        recvTransportRef.current = recvTransport;

        assertMediaDevicesAvailable();
        const { stream, fellBack } = await requestMicStream(micDeviceId);
        if (fellBack) {
          setError('O microfone salvo em Preferências não foi encontrado - usando o padrão do sistema.');
        }
        localStreamRef.current = stream;
        const [audioTrack] = stream.getAudioTracks();
        const micProducer = await sendTransport.produce({ track: audioTrack, appData: { source: 'mic' } });
        micProducerRef.current = micProducer;

        for (const producer of joinData.producers) {
          await consumeProducer(producer);
        }

        setVoiceChannelId(channelId);
        setConnected(true);
        setAudioLocked(Boolean(joinData.audioLocked));
        setMediaLocked(Boolean(joinData.mediaLocked));
      } catch (err) {
        console.error(err);
        setError(err.message ?? 'Não foi possível entrar na voz.');
        await leaveVoice();
      }
    },
    [socket, consumeProducer, leaveVoice, micDeviceId]
  );

  useEffect(() => {
    joinVoiceRef.current = joinVoice;
  }, [joinVoice]);

  const toggleMute = useCallback(async () => {
    const producer = micProducerRef.current;
    if (!producer) return;
    const nextMuted = !muted;
    // Áudio travado por um moderador: só ele reverte (voice:moderateMute
    // mode:'lock' de novo) - o próprio usuário pode se mutar à vontade, só
    // não consegue se DESmutar sozinho.
    if (!nextMuted && audioLocked) {
      setError('Um moderador bloqueou seu áudio neste canal.');
      return;
    }
    try {
      await emitAsync(socket, 'media:setProducerPaused', {
        channelId: channelIdRef.current,
        producerId: producer.id,
        paused: nextMuted,
      });
      if (nextMuted) producer.pause();
      else producer.resume();
      setMuted(nextMuted);
    } catch (err) {
      console.error(err);
    }
  }, [muted, audioLocked, socket]);

  // Ao ensurdecer, força o próprio mic mudo (lembrando se ele já estava
  // mudo por escolha do usuário, para não reativá-lo à toa ao desligar o
  // deafen). O silenciamento do áudio recebido em si acontece na UI
  // (ParticipantTile), que consulta `deafened`.
  //
  // media:setDeafened avisa o servidor (fire-and-forget, sem ack - não é uma
  // ação que possa falhar de um jeito que precise desfazer o toggle local)
  // pra que o resto do servidor veja o ícone no roster (RoomPage.jsx lê
  // `p.deafened`, ver voicePresence.js) - antes isso era um estado 100%
  // local, então só o PRÓPRIO usuário via seu ícone de ensurdecido.
  const toggleDeafen = useCallback(async () => {
    const channelId = channelIdRef.current;
    if (!deafened) {
      wasMutedBeforeDeafenRef.current = muted;
      if (!muted) await toggleMute();
      setDeafened(true);
      if (channelId) socket.emit('media:setDeafened', { channelId, deafened: true });
    } else {
      setDeafened(false);
      if (!wasMutedBeforeDeafenRef.current && muted) await toggleMute();
      if (channelId) socket.emit('media:setDeafened', { channelId, deafened: false });
    }
  }, [deafened, muted, toggleMute, socket]);

  const closeProducer = useCallback(
    async (producer) => {
      if (!producer) return;
      try {
        await emitAsync(socket, 'media:closeProducer', {
          channelId: channelIdRef.current,
          producerId: producer.id,
        });
      } catch (err) {
        console.error(err);
      }
      producer.close();
    },
    [socket]
  );

  // Compartilhar tela: só pode ser chamado a partir de um clique explícito
  // do usuário ("Compartilhar tela") - é isso que dispara o prompt nativo do
  // navegador/SO para escolher e autorizar a captura, nunca automático.
  // Exige já estar conectado na voz (sendTransport criado em joinVoice).
  const shareScreen = useCallback(
    async (sourceId) => {
      if (!sendTransportRef.current) {
        setError('Entre na voz antes de compartilhar a tela.');
        return;
      }
      if (mediaLocked) {
        setError('Um moderador bloqueou sua mídia neste canal.');
        return;
      }
      setError(null);
      try {
        const stream = await requestScreenStream(sourceId);
        const [track] = stream.getVideoTracks();

        // Se o usuário parar a captura pelo controle nativo do navegador/SO
        // (em vez do nosso botão), sincronizamos o estado da UI também.
        track.addEventListener('ended', () => stopScreenShareRef.current());

        const producer = await sendTransportRef.current.produce({
          track,
          appData: { source: 'screen' },
        });
        screenProducerRef.current = producer;
        setLocalScreenStream(stream);
        setSharingScreen(true);
      } catch (err) {
        console.error(err);
        if (err.name !== 'NotAllowedError') {
          setError(err.message ?? 'Não foi possível compartilhar a tela.');
        }
      }
    },
    [mediaLocked]
  );

  const stopScreenShare = useCallback(async () => {
    await closeProducer(screenProducerRef.current);
    screenProducerRef.current = null;
    setLocalScreenStream((stream) => {
      stream?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setSharingScreen(false);
  }, [closeProducer]);

  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const shareCamera = useCallback(async () => {
    if (!sendTransportRef.current) {
      setError('Entre na voz antes de ligar a câmera.');
      return;
    }
    if (mediaLocked) {
      setError('Um moderador bloqueou sua mídia neste canal.');
      return;
    }
    setError(null);
    try {
      const { stream, fellBack } = await requestCameraStream(cameraDeviceId);
      if (fellBack) {
        setError('A webcam salva em Preferências não foi encontrada - usando o padrão do sistema.');
      }
      const [track] = stream.getVideoTracks();
      track.addEventListener('ended', () => stopCameraRef.current());

      const producer = await sendTransportRef.current.produce({
        track,
        appData: { source: 'camera' },
      });
      cameraProducerRef.current = producer;
      setLocalCameraStream(stream);
      setCameraOn(true);
    } catch (err) {
      console.error(err);
      if (err.name !== 'NotAllowedError') {
        setError(err.message ?? 'Não foi possível ligar a câmera.');
      }
    }
  }, [mediaLocked, cameraDeviceId]);

  const stopCamera = useCallback(async () => {
    await closeProducer(cameraProducerRef.current);
    cameraProducerRef.current = null;
    setLocalCameraStream((stream) => {
      stream?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setCameraOn(false);
  }, [closeProducer]);

  useEffect(() => {
    stopCameraRef.current = stopCamera;
  }, [stopCamera]);

  // Sai da chamada de voz quando o provider desmonta - como ele vive em
  // App.jsx, acima de <Routes>, isso só acontece quando o app inteiro
  // desmonta (fechar/recarregar a aba), nunca por navegação interna. Nunca
  // deixa um producer/transport "vazado" tocando em background.
  //
  // Deps VAZIO de propósito, com leaveVoiceRef em vez de leaveVoice direto:
  // leaveVoice muda de identidade sempre que closePopout muda (que muda a
  // cada abrir/fechar de popout, via useWindowPopout). Com [leaveVoice] nas
  // deps, o cleanup deste efeito rodava (chamando a leaveVoice ANTIGA, ou
  // seja, saindo da chamada de verdade) toda vez que o popout abria/fechava
  // - era esse o bug de "abrir em nova janela desconecta a chamada".
  useEffect(() => () => leaveVoiceRef.current(), []);

  // Ações de moderação de voz (mover/mutar/desconectar/desligar mídia de
  // OUTRO usuário) - simples wrappers de emitAsync, chamados pelo menu de
  // contexto do roster (VoiceRosterEntry). Não dependem de o próprio
  // usuário estar conectado à voz; por isso recebem channelId explícito em
  // vez de usar channelIdRef.
  const moderateMute = useCallback(
    (channelId, targetUserId, muted, mode = 'once') =>
      emitAsync(socket, 'voice:moderateMute', { channelId, targetUserId, muted, mode }),
    [socket]
  );
  const moderateMedia = useCallback(
    (channelId, targetUserId, disabled, mode = 'once') =>
      emitAsync(socket, 'voice:moderateMedia', { channelId, targetUserId, disabled, mode }),
    [socket]
  );
  const moderateDisconnect = useCallback(
    (channelId, targetUserId) => emitAsync(socket, 'voice:moderateDisconnect', { channelId, targetUserId }),
    [socket]
  );
  const moderateMove = useCallback(
    (channelId, targetUserId, toChannelId) =>
      emitAsync(socket, 'voice:moderateMove', { channelId, targetUserId, toChannelId }),
    [socket]
  );

  const value = useMemo(
    () => ({
      connected,
      voiceChannelId,
      voiceRoomId,
      voiceRoomName: voiceMeta.roomName,
      voiceChannelName: voiceMeta.channelName,
      voiceRoster,
      panelAnchor,
      setPanelAnchor,
      popout,
      openPopout,
      closePopout,
      muted,
      remoteStreams,
      error,
      joinVoice,
      leaveVoice,
      toggleMute,
      deafened,
      toggleDeafen,
      sharingScreen,
      localScreenStream,
      shareScreen,
      stopScreenShare,
      cameraOn,
      localCameraStream,
      shareCamera,
      stopCamera,
      sendTransportRef,
      deviceRef,
      audioLocked,
      mediaLocked,
      moderateMute,
      moderateMedia,
      moderateDisconnect,
      moderateMove,
    }),
    [
      connected,
      voiceChannelId,
      voiceRoomId,
      voiceMeta,
      voiceRoster,
      panelAnchor,
      popout,
      openPopout,
      closePopout,
      muted,
      remoteStreams,
      error,
      joinVoice,
      leaveVoice,
      toggleMute,
      deafened,
      toggleDeafen,
      sharingScreen,
      localScreenStream,
      shareScreen,
      stopScreenShare,
      cameraOn,
      localCameraStream,
      shareCamera,
      stopCamera,
      audioLocked,
      mediaLocked,
      moderateMute,
      moderateMedia,
      moderateDisconnect,
      moderateMove,
    ]
  );

  return <MediaSessionContext.Provider value={value}>{children}</MediaSessionContext.Provider>;
}

export function useMediaSession() {
  const ctx = useContext(MediaSessionContext);
  if (!ctx) throw new Error('useMediaSession precisa estar dentro de <MediaSessionProvider>.');
  return ctx;
}
