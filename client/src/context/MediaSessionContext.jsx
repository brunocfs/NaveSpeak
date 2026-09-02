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
import { createRnnoiseStream } from '../audio/rnnoise.js';
import { createGtcrnStream } from '../audio/gtcrn.js';
import { createNoiseGateStream } from '../audio/noiseGate.js';
import { playSound } from '../utils/sounds.js';

// Push-to-talk: ignora o próprio código da tecla quando o foco está num
// campo de texto (chat, busca etc.) - sem isso, atribuir uma tecla comum
// (ex.: "V") faria qualquer letra digitada também abrir/fechar o mic
// enquanto a pessoa escreve.
function isEditableTarget(target) {
  if (!target) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

// window.naveSpeak.pushToTalk só existe dentro do app Electron (exposto por
// electron/preload.js) - fora dele (navegador comum) é sempre undefined.
// Quando existe, dá pra segurar/soltar a tecla via hook global do processo
// main (electron/main.js, uiohook-napi), que funciona mesmo com a janela
// sem foco/minimizada - o listener de keydown/keyup do PRÓPRIO navegador
// (usado de qualquer forma, ver efeito abaixo) só recebe eventos com a
// janela em foco, limitação do Chromium/qualquer navegador, não tem como
// contornar de dentro do renderer sozinho.
const hasGlobalPushToTalk =
  typeof window !== 'undefined' && Boolean(window.naveSpeak?.pushToTalk);

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
// Estado inicial/"sem chamada" de networkStats - mesmo objeto reaproveitado
// em vários lugares abaixo (reset ao desconectar, antes da primeira medição).
const EMPTY_NETWORK_STATS = { ping: null, packetLoss: null, quality: 'unknown' };

// good/fair/poor a partir de RTT e perda de pacote - limiares arbitrários
// (mesma régua informal usada por apps de chamada: <100ms é "bom", >250ms já
// incomoda em voz). packetLoss null (sem consumer nenhum pra medir, ex.:
// sozinho no canal) não deve derrubar a nota sozinho.
function classifyNetworkQuality(ping, packetLoss) {
  if (ping == null) return 'unknown';
  if (ping <= 100 && (packetLoss == null || packetLoss <= 1)) return 'good';
  if (ping <= 250 && (packetLoss == null || packetLoss <= 5)) return 'fair';
  return 'poor';
}

// RTT do par de candidatos ICE selecionado - primeiro tenta achar via
// stat 'transport' -> selectedCandidatePairId (caminho mais direto e
// confiável), com fallback pra varrer todos os 'candidate-pair' com
// state 'succeeded' (nem todo handler/browser expõe 'transport').
function extractRttMs(report) {
  let transportStat = null;
  for (const stat of report.values()) {
    if (stat.type === 'transport') {
      transportStat = stat;
      break;
    }
  }
  if (transportStat?.selectedCandidatePairId) {
    const pair = report.get(transportStat.selectedCandidatePairId);
    if (pair && typeof pair.currentRoundTripTime === 'number') {
      return Math.round(pair.currentRoundTripTime * 1000);
    }
  }
  for (const stat of report.values()) {
    if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && typeof stat.currentRoundTripTime === 'number') {
      return Math.round(stat.currentRoundTripTime * 1000);
    }
  }
  return null;
}

// % de perda somada de todos os inbound-rtp (áudio/vídeo recebido de outros
// participantes) - reflete o que o usuário está OUVINDO/VENDO agora, não o
// upload dele. null quando não há nenhum inbound-rtp ainda (ex.: sozinho no
// canal) - packetLoss "0%" ali seria enganoso (não é 0% de perda, é "nada
// pra medir").
function extractPacketLossPercent(report) {
  let lost = 0;
  let received = 0;
  let found = false;
  for (const stat of report.values()) {
    if (stat.type === 'inbound-rtp') {
      found = true;
      lost += stat.packetsLost ?? 0;
      received += stat.packetsReceived ?? 0;
    }
  }
  if (!found || lost + received === 0) return null;
  return Math.round((lost / (lost + received)) * 1000) / 10; // 1 casa decimal
}

export function MediaSessionProvider({ children }) {
  const [connected, setConnected] = useState(false);
  // Ping (RTT do transport de envio) e perda de pacotes (inbound do
  // transport de recebimento) - atualizado por polling enquanto `connected`
  // (ver efeito perto do fim do arquivo). Consumido pelo ícone de estado da
  // conexão em RoomPage (ConnectionStatusButton.jsx).
  const [networkStats, setNetworkStats] = useState(EMPTY_NETWORK_STATS);
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
  // Espelha voiceRoster em ref (handleVoiceUpdate compara contra isto, não
  // contra o state - o state só atualiza no próximo render) - usado só pra
  // detectar join/leave/começo de compartilhamento de tela de QUALQUER
  // participante e tocar o som certo pra todo mundo já conectado no canal,
  // não só pra quem fez a ação (ver handleVoiceUpdate). "Inicializado" evita
  // que o PRIMEIRO voice:update depois de entrar num canal já com gente lá
  // seja lido como "todo mundo acabou de entrar" - vira só a fotografia
  // inicial, sem som nenhum.
  const voiceRosterRef = useRef([]);
  const voiceRosterInitializedRef = useRef(false);
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
  // Stream CRUA do próprio mic (a capturada em joinVoice, antes do RNNoise -
  // ver denoiserRef abaixo) - só existe pra alimentar o anel de "falando" do
  // PRÓPRIO usuário (useSpeaking em VoiceRosterEntry/ParticipantTile), que
  // antes só acendia pros OUTROS participantes: `remoteStreams` (usado pra
  // achar o micStream de cada linha do roster/tile) nunca inclui o próprio
  // producer, ninguém consome o próprio áudio de volta. Precisa ser STATE
  // (não só localStreamRef) porque os componentes que desenham o anel
  // precisam re-renderizar quando a stream aparece/some (entrar/sair da voz).
  const [localMicStream, setLocalMicStream] = useState(null);
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
  const cameraOnRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);
  useEffect(() => {
    cameraOnRef.current = cameraOn;
  }, [cameraOn]);
  // Travas de moderação (voice:moderateMute/voice:moderateMedia mode:'lock',
  // ver server/src/sockets/mediasoup.handler.js) sobre o PRÓPRIO usuário no
  // canal de voz atual - enquanto true, o próprio usuário não consegue
  // reverter sozinho (toggleMute/shareCamera/shareScreen abaixo recusam).
  const [audioLocked, setAudioLocked] = useState(false);
  const [mediaLocked, setMediaLocked] = useState(false);
  const audioLockedRef = useRef(false);
  useEffect(() => {
    audioLockedRef.current = audioLocked;
  }, [audioLocked]);
  // Push-to-talk: true enquanto a tecla atribuída está pressionada (ver
  // efeito de keydown/keyup mais abaixo). Independente de `muted` - é uma
  // camada por CIMA do mute manual, nunca o substitui (mutar manualmente
  // continua bloqueando transmissão mesmo com a tecla segurada).
  const [pttActive, setPttActive] = useState(false);
  const pttActiveRef = useRef(false);

  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const localStreamRef = useRef(null);
  // Controlador do grafo Web Audio do supressor de ruído WASM (RNNoise ou
  // GTCRN, ver audio/rnnoise.js e audio/gtcrn.js) quando noiseSuppressionMode
  // é 'rnnoise'/'gtcrn' - null no 'native'/'off'. Guardado à parte de
  // localStreamRef porque a stream "crua" continua sendo o dono da captura
  // de verdade (é ela que precisa ser parada ao sair da voz); esta é só o
  // grafo derivado que produz a track processada enviada de verdade.
  const denoiserRef = useRef(null);
  // Controlador do grafo do noise gate (sensibilidade do microfone, ver
  // audio/noiseGate.js) quando micGateEnabled - null caso contrário. Fica
  // DEPOIS do denoiser na cadeia (denoiser limpa ruído, gate silencia o que
  // sobrar abaixo do threshold), mas é um grafo à parte (destroy próprio) -
  // o gate não sabe nem precisa saber se rodou algum supressor antes dele.
  const gateRef = useRef(null);
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
  // Idem, mas pra RELIGAR a câmera depois de uma reconexão (handleReconnect
  // abaixo) - shareCamera só existe como useCallback mais adiante no
  // arquivo, registrado num efeito próprio assim que definido.
  const shareCameraRef = useRef(() => {});
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
  const {
    micDeviceId,
    cameraDeviceId,
    noiseSuppressionMode,
    noiseSuppressionLevel,
    micGateEnabled,
    micGateThresholdDb,
    pushToTalkEnabled,
    pushToTalkKey,
  } = usePreferences();

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
    //
    // Também é daqui que tocam os sons de entrar/sair/compartilhar tela pra
    // QUALQUER participante do canal (não só quem fez a ação) - o servidor
    // manda este mesmo evento pra todo mundo na room do canal
    // (broadcastVoicePresence em mediasoup.handler.js), então comparar o
    // roster novo contra o anterior aqui já cobre todo mundo de uma vez.
    // Exceção: "leaveCall" de quem SAIU não passa por aqui (o servidor tira o
    // socket da room ANTES de disparar este broadcast, então quem saiu nunca
    // recebe o próprio evento) - por isso leaveVoice ainda toca esse som
    // direto, só pra si mesmo; join e shareScreen não precisam disso, o
    // autor da ação já recebe o próprio broadcast normalmente.
    function handleVoiceUpdate(update) {
      if (update.channelId !== channelIdRef.current) return;
      const next = update.participants ?? [];

      if (!voiceRosterInitializedRef.current) {
        voiceRosterInitializedRef.current = true;
        voiceRosterRef.current = next;
        setVoiceRoster(next);
        return;
      }

      const prev = voiceRosterRef.current;
      const prevIds = new Set(prev.map((p) => p.userId));
      const nextIds = new Set(next.map((p) => p.userId));

      if (next.some((p) => !prevIds.has(p.userId))) playSound('joinCall');
      if (prev.some((p) => !nextIds.has(p.userId))) playSound('leaveCall');
      // "Começou" a compartilhar agora (estava false/ausente, virou true) -
      // não repete o som pra quem já estava compartilhando antes deste update.
      if (
        next.some((p) => {
          const before = prev.find((q) => q.userId === p.userId);
          return p.sharingScreen && !before?.sharingScreen;
        })
      ) {
        playSound('shareScreen');
      }

      voiceRosterRef.current = next;
      setVoiceRoster(next);
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
      // Idem pra câmera: leaveVoice (chamado logo abaixo) sempre para a
      // track e zera cameraOn/localCameraStream, porque também serve pra
      // sair de vez da chamada - sem guardar aqui ANTES, uma queda de rede
      // sempre devolvia o usuário sem câmera, mesmo que ela estivesse ligada
      // um instante antes de cair.
      const wasCameraOn = cameraOnRef.current;
      await leaveVoiceRef.current({ keepMeta: true });
      await joinVoiceRef.current(channelId);

      // Religa a câmera DEPOIS do rejoin (precisa do sendTransport novo, que
      // só existe a partir daqui) - pede o device salvo de novo via
      // requestCameraStream, sem gesto novo do usuário porque o navegador já
      // tinha concedido a permissão antes de cair. shareCamera já trata os
      // próprios erros (moderador bloqueou mídia enquanto caído, webcam
      // sumiu etc.) via setError - não precisa de try/catch aqui.
      if (wasCameraOn) {
        await shareCameraRef.current();
      }

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
      // Só toca se realmente havia uma chamada ativa - leaveVoice() também é
      // chamado defensivamente (ex.: início de joinVoice trocando de canal)
      // sem que o usuário estivesse conectado a nada. Diferente de
      // joinCall/shareScreen (que tocam via handleVoiceUpdate pra todo mundo
      // de uma vez): quem SAI não recebe o próprio voice:update de volta (o
      // servidor tira o socket da room antes de emitir esse broadcast, ver
      // mediasoup.handler.js) - por isso só pra si mesmo o som é disparado
      // aqui, direto; o restante do canal ouve pelo handleVoiceUpdate normal.
      if (channelId) playSound('leaveCall');

      // Sem chamada ativa não há mais o que mostrar no popout - fecha
      // explicitamente em vez de depender de VoicePanel desmontar (ele é
      // global agora, não desmonta por causa disso).
      closePopout();
      setVoiceRoster([]);
      voiceRosterRef.current = [];
      voiceRosterInitializedRef.current = false;

      denoiserRef.current?.destroy();
      denoiserRef.current = null;
      gateRef.current?.destroy();
      gateRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalMicStream(null);
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
        const { stream, fellBack } = await requestMicStream(micDeviceId, { noiseSuppressionMode });
        if (fellBack) {
          setError('O microfone salvo em Preferências não foi encontrado - usando o padrão do sistema.');
        }
        localStreamRef.current = stream;
        setLocalMicStream(stream);
        let audioTrack = stream.getAudioTracks()[0];

        // Modos 'rnnoise'/'gtcrn': a captura acima já entra com
        // noiseSuppression nativo DESLIGADO (ver
        // media.js#micAudioConstraints) - o processamento de verdade é este
        // grafo WASM à parte. Falha aqui (ex.: AudioWorklet indisponível)
        // não pode derrubar a entrada na voz - segue com a track crua, só
        // avisa.
        if (noiseSuppressionMode === 'rnnoise' || noiseSuppressionMode === 'gtcrn') {
          try {
            const createDenoisedStream =
              noiseSuppressionMode === 'gtcrn' ? createGtcrnStream : createRnnoiseStream;
            const denoiser = await createDenoisedStream(stream, { level: noiseSuppressionLevel });
            denoiserRef.current = denoiser;
            audioTrack = denoiser.stream.getAudioTracks()[0];
          } catch (err) {
            console.error(err);
            setError(
              `Não foi possível ativar o supressor de ruído ${noiseSuppressionMode === 'gtcrn' ? 'GTCRN' : 'RNNoise'} - entrando com o microfone sem esse processamento.`
            );
          }
        }

        // Sensibilidade do microfone (noise gate) - DEPOIS do supressor de
        // ruído acima, na track que vai mesmo pro producer (crua ou já
        // denoised). Falha aqui também não derruba a entrada na voz, mesmo
        // padrão do supressor.
        if (micGateEnabled) {
          try {
            const gate = await createNoiseGateStream(new MediaStream([audioTrack]), {
              thresholdDb: micGateThresholdDb,
            });
            gateRef.current = gate;
            audioTrack = gate.stream.getAudioTracks()[0];
          } catch (err) {
            console.error(err);
            setError('Não foi possível ativar a sensibilidade do microfone - entrando sem esse processamento.');
          }
        }

        const micProducer = await sendTransport.produce({ track: audioTrack, appData: { source: 'mic' } });
        micProducerRef.current = micProducer;

        for (const producer of joinData.producers) {
          await consumeProducer(producer);
        }

        setVoiceChannelId(channelId);
        setConnected(true);
        // Toca pra si mesmo direto - o PRIMEIRO voice:update que recebemos
        // depois de conectar é sempre tratado como "foto inicial" por
        // handleVoiceUpdate (pra não soar "todo mundo entrou" quando a gente
        // entra num canal já cheio), então quem acabou de entrar nunca ouve
        // o próprio som só pelo broadcast. O resto do canal ouve por lá
        // normalmente (esse mesmo voice:update não é o primeiro PARA ELES).
        playSound('joinCall');
        setAudioLocked(Boolean(joinData.audioLocked));
        setMediaLocked(Boolean(joinData.mediaLocked));
      } catch (err) {
        console.error(err);
        setError(err.message ?? 'Não foi possível entrar na voz.');
        await leaveVoice();
      }
    },
    [
      socket,
      consumeProducer,
      leaveVoice,
      micDeviceId,
      noiseSuppressionMode,
      noiseSuppressionLevel,
      micGateEnabled,
      micGateThresholdDb,
    ]
  );

  useEffect(() => {
    joinVoiceRef.current = joinVoice;
  }, [joinVoice]);

  // O nível do supressor (diferente do modo) é reaplicado AO VIVO no grafo
  // já rodando, sem precisar reentrar na voz - é só um gain.value (mix
  // dry/wet, ver createRnnoiseStream/createGtcrnStream), tão barato quanto o
  // volume individual por participante (RemoteAudioPlayers.jsx). Mudar o
  // MODO, por outro lado, só vale da próxima entrada (mexe em como o mic foi
  // capturado, mesmo padrão de micDeviceId).
  useEffect(() => {
    denoiserRef.current?.setLevel(noiseSuppressionLevel);
  }, [noiseSuppressionLevel]);

  // Pausa/retoma o producer de mic de verdade (local + servidor) - função
  // única usada tanto pelo mute manual (toggleMute) quanto pelo push-to-talk
  // (efeitos abaixo), para as duas fontes nunca aplicarem o pause direto por
  // conta própria e brigarem sobre o estado real do producer. Não mexe em
  // `muted` - quem chama decide se isso também é uma troca de mute manual.
  const applyProducerPause = useCallback(
    async (paused) => {
      const producer = micProducerRef.current;
      if (!producer) return false;
      try {
        await emitAsync(socket, 'media:setProducerPaused', {
          channelId: channelIdRef.current,
          producerId: producer.id,
          paused,
        });
        if (paused) producer.pause();
        else producer.resume();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    },
    [socket]
  );

  const toggleMute = useCallback(async () => {
    if (!micProducerRef.current) return;
    const nextMuted = !muted;
    // Áudio travado por um moderador: só ele reverte (voice:moderateMute
    // mode:'lock' de novo) - o próprio usuário pode se mutar à vontade, só
    // não consegue se DESmutar sozinho.
    if (!nextMuted && audioLocked) {
      setError('Um moderador bloqueou seu áudio neste canal.');
      return;
    }
    // Com push-to-talk ligado, desmutar manualmente não deve religar a
    // transmissão sozinho - só tira o mute manual da frente; a tecla
    // continua mandando (some devolve o controle pro push-to-talk, que por
    // padrão fica mudo até a tecla ser pressionada de novo).
    const shouldTransmit = !nextMuted && (!pushToTalkEnabled || pttActiveRef.current);
    const ok = await applyProducerPause(!shouldTransmit);
    if (ok) setMuted(nextMuted);
  }, [muted, audioLocked, pushToTalkEnabled, applyProducerPause]);

  // Push-to-talk inteiro num efeito só (arma/desarma + segurar tecla) DE
  // PROPÓSITO, não dois efeitos separados: com dois efeitos, desligar
  // pushToTalkEnabled com a tecla ainda segurada rodava a limpeza dos DOIS
  // fora de ordem - o de "arma/desarma" resumia o producer, mas em seguida
  // a limpeza do efeito de tecla via `pttActiveRef` ainda true e pausava de
  // novo (achando que era um "soltar tecla" comum), deixando o mic mudo de
  // verdade enquanto a UI (baseada em `pushToTalkEnabled=false`) já mostrava
  // como transmitindo. Um efeito só, uma limpeza só, sem essa corrida.
  //
  // Só ativo com push-to-talk ligado E chamada conectada (independe de já
  // ter tecla atribuída - sem tecla, simplesmente não há handler que
  // desmute, o mic fica mudo por padrão até o usuário atribuir uma).
  useEffect(() => {
    if (!connected || !pushToTalkEnabled) return;
    // Liga: mic começa mudo por padrão - só a tecla desmuta. Não mexe se já
    // estiver mutado manualmente ou travado por moderador (nada de "padrão
    // de push-to-talk" a aplicar por cima disso).
    if (!mutedRef.current && !audioLockedRef.current) applyProducerPause(true);

    function release() {
      if (!pttActiveRef.current) return;
      pttActiveRef.current = false;
      setPttActive(false);
      if (!mutedRef.current && !audioLockedRef.current) applyProducerPause(true);
    }
    // `target` aqui é `document.activeElement` tanto pro keydown de verdade
    // (janela em foco) quanto pro pulso do hook global (Electron, janela
    // OU sem foco) - decide se ignora por estar digitando num campo de
    // texto SEM depender de foco de janela, porque isso cobre os dois
    // casos de uma vez: digitando com o app em foco, e "estava digitando e
    // trocou de janela sem tirar o foco do campo" (o campo continua sendo
    // `document.activeElement` mesmo com a janela do app em segundo plano).
    function press(target) {
      if (!pushToTalkKey || pttActiveRef.current) return;
      if (isEditableTarget(target)) return;
      pttActiveRef.current = true;
      setPttActive(true);
      if (!mutedRef.current && !audioLockedRef.current) applyProducerPause(false);
    }
    function handleKeyDown(e) {
      if (e.code === pushToTalkKey && !e.repeat) press(e.target);
    }
    function handleKeyUp(e) {
      if (e.code === pushToTalkKey) release();
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Fallback SÓ pra quando não há hook global (navegador comum, fora do
    // Electron): solta sozinho se a janela perder foco (alt-tab etc.), já
    // que sem o hook o keyup nunca chegaria e o mic ficaria "preso"
    // transmitindo. Com o hook global (abaixo) o keyup de VERDADE chega
    // mesmo sem foco - soltar aqui também derrubaria o mic assim que o
    // usuário trocasse de janela segurando a tecla, o oposto do que
    // push-to-talk deveria fazer.
    if (!hasGlobalPushToTalk) window.addEventListener('blur', release);

    let unsubscribeGlobalKeyDown;
    let unsubscribeGlobalKeyUp;
    if (hasGlobalPushToTalk) {
      // `supported` reflete se o processo main conseguiu mesmo ligar o hook
      // pra essa tecla (uiohook indisponível na plataforma, ou tecla sem
      // tradução pro hook global - ver DOM_CODE_TO_UIOHOOK_KEY em
      // electron/main.js) - logado pra dar pra diagnosticar pelo DevTools
      // (Ctrl+Shift+I) sem precisar instrumentar nada na hora.
      window.naveSpeak.pushToTalk
        .setWatchedKey(pushToTalkKey)
        .then((supported) => {
          console.log(
            `[push-to-talk] hook global ${supported ? 'ativo' : 'indisponível'} para "${pushToTalkKey}" - fora do foco só funciona se "ativo".`
          );
        })
        .catch((err) => console.error('[push-to-talk] Falha ao armar o hook global:', err));
      unsubscribeGlobalKeyDown = window.naveSpeak.pushToTalk.onKeyDown(() =>
        press(document.activeElement)
      );
      unsubscribeGlobalKeyUp = window.naveSpeak.pushToTalk.onKeyUp(release);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (!hasGlobalPushToTalk) window.removeEventListener('blur', release);
      if (hasGlobalPushToTalk) {
        window.naveSpeak.pushToTalk.setWatchedKey(null);
        unsubscribeGlobalKeyDown?.();
        unsubscribeGlobalKeyUp?.();
      }
      // Desliga (PTT desativado, desconectou, ou trocou a tecla): sempre
      // devolve o mic ao comportamento normal (transmite direto, só mute
      // manual/trava barram) - nunca deixa preso mudo por causa de um
      // "segurar" cujo efeito não existe mais.
      pttActiveRef.current = false;
      setPttActive(false);
      if (!mutedRef.current && !audioLockedRef.current) applyProducerPause(false);
    };
  }, [connected, pushToTalkEnabled, pushToTalkKey, applyProducerPause]);

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
  // Nomes dos sons seguem o pedido original ("mute"/"unmute"), mas a troca é
  // de DEAFEN (silenciar todos), não do mic - toggleMute (mic) não tem som
  // próprio.
  const toggleDeafen = useCallback(async () => {
    const channelId = channelIdRef.current;
    if (!deafened) {
      wasMutedBeforeDeafenRef.current = muted;
      if (!muted) await toggleMute();
      setDeafened(true);
      playSound('mute');
      if (channelId) socket.emit('media:setDeafened', { channelId, deafened: true });
    } else {
      setDeafened(false);
      playSound('unmute');
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
        // "shareScreen" toca via handleVoiceUpdate (voice:update, mesmo
        // motivo do comentário em joinVoice acima) - o broadcast que marca
        // sharingScreen:true inclui quem iniciou.
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

  useEffect(() => {
    shareCameraRef.current = shareCamera;
  }, [shareCamera]);

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

  // Se o mic está REALMENTE transmitindo agora - além de `muted`/`audioLocked`,
  // com push-to-talk ligado só é true enquanto a tecla está pressionada
  // (`pttActive`). Centralizado aqui pra VoicePanel/RoomPage não duplicarem
  // essa conta pra decidir o anel de "falando"/ícone do PRÓPRIO usuário.
  const micTransmitting =
    connected && !muted && !audioLocked && (!pushToTalkEnabled || pttActive);

  // Lê as estatísticas WebRTC (getStats()) dos transports mediasoup atuais e
  // atualiza networkStats - chamado em polling pelo efeito logo abaixo,
  // nunca direto por quem consome o context.
  const pollNetworkStats = useCallback(async () => {
    const sendTransport = sendTransportRef.current;
    if (!sendTransport) return;
    try {
      const sendReport = await sendTransport.getStats();
      const ping = extractRttMs(sendReport);

      // Perda de pacote vem do transport de RECEBIMENTO (o que chega dos
      // outros participantes) - pode não existir ainda mesmo com o send
      // conectado (ex.: entrou na voz mas ninguém mais fala/liga câmera).
      let packetLoss = null;
      const recvTransport = recvTransportRef.current;
      if (recvTransport) {
        const recvReport = await recvTransport.getStats();
        packetLoss = extractPacketLossPercent(recvReport);
      }

      setNetworkStats({ ping, packetLoss, quality: classifyNetworkQuality(ping, packetLoss) });
    } catch {
      // getStats() pode falhar num instante de transição (transport
      // fechando por reconexão) - ignora, tenta de novo no próximo tick.
    }
  }, []);

  // Só mede enquanto há chamada ativa - ao desconectar, volta pro estado
  // "sem dados" em vez de deixar o último número (ping de uma chamada que já
  // acabou) exposto no ícone.
  useEffect(() => {
    if (!connected) {
      setNetworkStats(EMPTY_NETWORK_STATS);
      return;
    }
    pollNetworkStats();
    const interval = setInterval(pollNetworkStats, 3000);
    return () => clearInterval(interval);
  }, [connected, pollNetworkStats]);

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
      localMicStream,
      sendTransportRef,
      deviceRef,
      audioLocked,
      mediaLocked,
      moderateMute,
      moderateMedia,
      moderateDisconnect,
      moderateMove,
      pushToTalkActive: pttActive,
      micTransmitting,
      networkStats,
    }),
    [
      connected,
      networkStats,
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
      localMicStream,
      audioLocked,
      mediaLocked,
      moderateMute,
      moderateMedia,
      moderateDisconnect,
      moderateMove,
      pttActive,
      micTransmitting,
    ]
  );

  return <MediaSessionContext.Provider value={value}>{children}</MediaSessionContext.Provider>;
}

export function useMediaSession() {
  const ctx = useContext(MediaSessionContext);
  if (!ctx) throw new Error('useMediaSession precisa estar dentro de <MediaSessionProvider>.');
  return ctx;
}
