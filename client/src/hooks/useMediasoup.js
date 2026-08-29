import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import { getSocket } from '../api/socket.js';
import { requestScreenStream, requestCameraStream, assertMediaDevicesAvailable } from '../api/media.js';

function emitAsync(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (response?.error) reject(new Error(response.error));
      else resolve(response ?? {});
    });
  });
}

// Encapsula toda a integração com mediasoup-client (voz na Fase 3; tela e
// câmera na Fase 4 reaproveitam o mesmo sendTransport via produceTrack).
//
// A conexão de voz é INDEPENDENTE do canal que está sendo *visualizado* pelo
// usuário: o hook guarda internamente em qual canal de voz ele está conectado
// (voiceChannelId / channelIdRef) e só se desconecta quando o próprio usuário
// sai da voz ou o componente desmonta - assim navegar por canais de texto não
// derruba a chamada de voz.
export function useMediasoup() {
  const [connected, setConnected] = useState(false);
  const [voiceChannelId, setVoiceChannelId] = useState(null);
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

  const addRemoteStream = useCallback((entry) => {
    setRemoteStreams((prev) => [...prev.filter((s) => s.producerId !== entry.producerId), entry]);
  }, []);

  const removeRemoteStream = useCallback((producerId) => {
    setRemoteStreams((prev) => prev.filter((s) => s.producerId !== producerId));
  }, []);

  const consumeProducer = useCallback(
    async ({ producerId, userId, username, kind, appData }) => {
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
        addRemoteStream({ producerId, userId, username, kind, appData, stream, paused: false });
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

    // Reconexão do socket (queda de rede, ou o servidor reiniciou): o
    // transporte WebRTC anterior morreu junto com a conexão antiga, mediasoup
    // não tem como sobreviver a isso. Se o usuário estava numa chamada
    // (channelIdRef ainda setado - só é limpo por uma saída explícita),
    // refaz a entrada na voz automaticamente em vez de deixá-lo "preso" numa
    // chamada morta até ele perceber e reentrar na mão.
    async function handleReconnect() {
      const channelId = channelIdRef.current;
      if (!channelId) return;
      await leaveVoiceRef.current();
      await joinVoiceRef.current(channelId);
    }

    socket.on('media:newProducer', handleNewProducer);
    socket.on('media:producerClosed', handleProducerClosed);
    socket.on('media:producerStateChanged', handleStateChanged);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('media:newProducer', handleNewProducer);
      socket.off('media:producerClosed', handleProducerClosed);
      socket.off('media:producerStateChanged', handleStateChanged);
      socket.off('connect', handleReconnect);
    };
  }, [socket, consumeProducer, removeRemoteStream]);

  // Limpa toda a mídia local e avisa o servidor que saímos do canal de voz.
  const leaveVoice = useCallback(async () => {
    const channelId = channelIdRef.current;
    if (channelId) socket.emit('media:leave', channelId);

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
  }, [socket]);

  useEffect(() => {
    leaveVoiceRef.current = leaveVoice;
  }, [leaveVoice]);

  // Só é chamado a partir de um clique explícito do usuário ("Entrar na
  // voz") - getUserMedia nunca dispara sozinho ao carregar a página.Recebe o
  // channelId do canal de voz alvo para que a conexão seja sempre explícita.
  const joinVoice = useCallback(
    async (channelId) => {
      // Se já estava em outra chamada de voz, sai primeiro para não ficar em
      // dois canais ao mesmo tempo.
      if (channelIdRef.current && channelIdRef.current !== channelId) {
        await leaveVoice();
      }
      setError(null);
      try {
        channelIdRef.current = channelId;
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        const [audioTrack] = stream.getAudioTracks();
        const micProducer = await sendTransport.produce({ track: audioTrack, appData: { source: 'mic' } });
        micProducerRef.current = micProducer;

        for (const producer of joinData.producers) {
          await consumeProducer(producer);
        }

        setVoiceChannelId(channelId);
        setConnected(true);
      } catch (err) {
        console.error(err);
        setError(err.message ?? 'Não foi possível entrar na voz.');
        await leaveVoice();
      }
    },
    [socket, consumeProducer, leaveVoice]
  );

  useEffect(() => {
    joinVoiceRef.current = joinVoice;
  }, [joinVoice]);

  const toggleMute = useCallback(async () => {
    const producer = micProducerRef.current;
    if (!producer) return;
    const nextMuted = !muted;
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
  }, [muted, socket]);

  // Ao ensurdecer, força o próprio mic mudo (lembrando se ele já estava
  // mudo por escolha do usuário, para não reativá-lo à toa ao desligar o
  // deafen). O silenciamento do áudio recebido em si acontece na UI
  // (ParticipantTile), que consulta `deafened`.
  const toggleDeafen = useCallback(async () => {
    if (!deafened) {
      wasMutedBeforeDeafenRef.current = muted;
      if (!muted) await toggleMute();
      setDeafened(true);
    } else {
      setDeafened(false);
      if (!wasMutedBeforeDeafenRef.current && muted) await toggleMute();
    }
  }, [deafened, muted, toggleMute]);

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
    []
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
    setError(null);
    try {
      const stream = await requestCameraStream();
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
  }, []);

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

  // Sai da chamada de voz quando o componente desmonta - nunca deixa um
  // producer/transport "vazado" tocando em background.
  useEffect(() => () => leaveVoice(), [leaveVoice]);

  return {
    connected,
    voiceChannelId,
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
  };
}
