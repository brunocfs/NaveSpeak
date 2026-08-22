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
export function useMediasoup(roomId) {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [error, setError] = useState(null);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [localCameraStream, setLocalCameraStream] = useState(null);

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
          roomId,
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
        await emitAsync(socket, 'media:resumeConsumer', { roomId, consumerId: consumer.id });

        const stream = new MediaStream([consumer.track]);
        addRemoteStream({ producerId, userId, username, kind, appData, stream, paused: false });
      } catch (err) {
        console.error('Falha ao consumir mídia remota:', err.message);
      }
    },
    [roomId, socket, addRemoteStream]
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

    socket.on('media:newProducer', handleNewProducer);
    socket.on('media:producerClosed', handleProducerClosed);
    socket.on('media:producerStateChanged', handleStateChanged);
    return () => {
      socket.off('media:newProducer', handleNewProducer);
      socket.off('media:producerClosed', handleProducerClosed);
      socket.off('media:producerStateChanged', handleStateChanged);
    };
  }, [socket, consumeProducer, removeRemoteStream]);

  // Deliberadamente NÃO depende de localScreenStream/localCameraStream (usa
  // a forma funcional de setState para acessar o valor atual em vez disso).
  // Isso mantém a identidade de leaveVoice estável entre re-renders - um
  // efeito "sair da sala ao desmontar" mais abaixo depende dela, e se a
  // identidade mudasse toda vez que o usuário ligasse a câmera/tela, o
  // cleanup desse efeito dispararia a cada mudança de estado (não só no
  // desmonte de verdade) e derrubaria a chamada de voz inteira.
  const leaveVoice = useCallback(async () => {
    socket.emit('media:leave', roomId);

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
    setLocalScreenStream((stream) => {
      stream?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setLocalCameraStream((stream) => {
      stream?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, [roomId, socket]);

  // Só é chamado a partir de um clique explícito do usuário ("Entrar na
  // voz") - getUserMedia nunca dispara sozinho ao carregar a página.
  const joinVoice = useCallback(async () => {
    setError(null);
    try {
      const joinData = await emitAsync(socket, 'media:join', roomId);

      const device = new Device();
      await device.load({ routerRtpCapabilities: joinData.rtpCapabilities });
      deviceRef.current = device;

      const sendParams = await emitAsync(socket, 'media:createTransport', { roomId, direction: 'send' });
      const sendTransport = device.createSendTransport(sendParams);
      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        emitAsync(socket, 'media:connectTransport', { roomId, transportId: sendTransport.id, dtlsParameters })
          .then(() => callback())
          .catch(errback);
      });
      sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        emitAsync(socket, 'media:produce', { roomId, transportId: sendTransport.id, kind, rtpParameters, appData })
          .then(({ id }) => callback({ id }))
          .catch(errback);
      });
      sendTransportRef.current = sendTransport;

      const recvParams = await emitAsync(socket, 'media:createTransport', { roomId, direction: 'recv' });
      const recvTransport = device.createRecvTransport(recvParams);
      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        emitAsync(socket, 'media:connectTransport', { roomId, transportId: recvTransport.id, dtlsParameters })
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

      setConnected(true);
    } catch (err) {
      console.error(err);
      setError(err.message ?? 'Não foi possível entrar na voz.');
      await leaveVoice();
    }
  }, [roomId, socket, consumeProducer, leaveVoice]);

  const toggleMute = useCallback(async () => {
    const producer = micProducerRef.current;
    if (!producer) return;
    const nextMuted = !muted;
    try {
      await emitAsync(socket, 'media:setProducerPaused', { roomId, producerId: producer.id, paused: nextMuted });
      if (nextMuted) producer.pause();
      else producer.resume();
      setMuted(nextMuted);
    } catch (err) {
      console.error(err);
    }
  }, [muted, roomId, socket]);

  const closeProducer = useCallback(
    async (producer) => {
      if (!producer) return;
      try {
        await emitAsync(socket, 'media:closeProducer', { roomId, producerId: producer.id });
      } catch (err) {
        console.error(err);
      }
      producer.close();
    },
    [roomId, socket]
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

  // Sai da sala de voz quando o roomId muda ou o componente desmonta - nunca
  // deixa um producer/transport "vazado" tocando em background.
  useEffect(() => () => leaveVoice(), [leaveVoice]);

  return {
    connected,
    muted,
    remoteStreams,
    error,
    joinVoice,
    leaveVoice,
    toggleMute,
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
