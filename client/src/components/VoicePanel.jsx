import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ExternalLink,
  ChevronDown,
  Camera,
  CameraOff,
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  LayoutFreeform,
  Grid2x2,
  PanelRightClose,
  PanelRightOpen,
  Maximize,
  Minimize,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useCall } from "../context/CallContext.jsx";
import VideoLayoutManager from "./VideoLayoutManager.jsx";
import SimpleVideoGrid from "./SimpleVideoGrid.jsx";
import ParticipantTile from "./ParticipantTile.jsx";
import RemoteAudioPlayers from "./RemoteAudioPlayers.jsx";
import AddCallParticipant from "./AddCallParticipant.jsx";
import { usePreferences } from "../context/PreferencesContext.jsx";
import { useSpeaking } from "../hooks/useSpeaking.js";
import { useTilePopouts } from "../hooks/useTilePopouts.js";

// Só existe pro PiP flutuante (ver `floating` mais abaixo): reporta se um
// mic está "falando" agora sem montar o ParticipantTile inteiro, pra
// VoicePanel decidir QUAL tile mostrar no PiP sem precisar renderizar todos.
// Não desenha nada (`return null`) - é só ponte entre useSpeaking (por
// stream) e o Map de estado do painel (por pessoa).
function SpeakingProbe({ speakerKey, stream, onChange }) {
  const speaking = useSpeaking(stream);
  useEffect(() => {
    onChange(speakerKey, speaking);
  }, [speakerKey, speaking, onChange]);
  return null;
}

// Montado UMA VEZ, globalmente (App.jsx, junto de VoiceStatusBar) - não mais
// instanciado por RoomPage. Lê tudo (remoteStreams, roster, popout) direto
// de useMediaSession(), então não depende de nenhum estado dono de RoomPage:
// a chamada e a janela de popout continuam de pé mesmo se o usuário sair da
// tela da sala (era exatamente essa dependência que fazia o popout fechar
// sozinho ao voltar pra tela inicial).
//
// Como não fica mais posicionado dentro do layout de RoomPage, ele SEMPRE se
// porta (createPortal) para um alvo: a janela de popout, se aberta, senão o
// `panelAnchor` que a tela atual registrou via media.setPanelAnchor (hoje só
// RoomPage registra um, quando é o canal de voz ativo).
//
// Sem popout aberto e sem tela exibindo o painel embutido - é exatamente o
// caso de uma CHAMADA PRIVADA (nenhuma tela registra panelAnchor pra ela, só
// RoomPage registra e só para o canal de voz de um servidor) - o painel vira
// FLUTUANTE: um card fixo no canto da tela, portado direto pro <body>, pra
// câmera/tela compartilhada sempre terem onde aparecer, não importa a tela
// atual. Áudio nunca dependeu disso (mediasoup entrega o stream sozinho),
// mas vídeo sem nenhum <video> montado em algum lugar não tem como aparecer.
// Minimizável (setMinimized) pra não obrigar o card a ficar sempre aberto.
export default function VoicePanel() {
  const { user } = useAuth();
  const media = useMediaSession();
  const { isCall, activeRoster } = useCall();
  const {
    videoLayoutMode,
    setVideoLayoutMode,
    hideParticipantsWithoutMedia,
    toggleHideParticipantsWithoutMedia,
    getUserVolume,
    getScreenAudioVolume,
    setScreenAudioVolume,
    autoplayCamera,
    autoplayScreenShare,
    isMediaHidden,
    toggleMediaHidden,
    isLocallyMuted,
    toggleLocalMute,
    outputDeviceId,
    membersSidebarVisible,
    toggleMembersSidebar,
  } = usePreferences();
  const {
    connected,
    muted,
    remoteStreams,
    error,
    leaveVoice,
    toggleMute,
    audioLocked,
    mediaLocked,
    deafened,
    toggleDeafen,
    cameraOn,
    localCameraStream,
    shareCamera,
    stopCamera,
    sharingScreen,
    localScreenStream,
    screenAudioEnabled,
    screenAudioVolume,
    setLocalScreenAudioVolume,
    screenViewers,
    setWatchingScreen,
    localMicStream,
    micTransmitting,
    voiceRoster: participants,
    voiceRoomId,
    voiceChannelId,
    panelAnchor,
    popout,
    openPopout,
    closePopout,
  } = media;
  const navigate = useNavigate();

  // Chaves dos tiles fixados ("spotlight") - 'user:<id>' ou 'screen:<id>'.
  // Set em vez de uma chave só: dá pra fixar vários participantes ao mesmo
  // tempo (cada um ganha a região prioritária do VideoLayoutManager).
  const [pinnedKeys, setPinnedKeys] = useState(() => new Set());
  const prevScreenKeysRef = useRef(new Set());

  // Chaves de tile 'iniciadas manualmente' - só importa quando a preferência
  // de autoplay correspondente (autoplayCamera/autoplayScreenShare) está
  // DESLIGADA: a mídia chega mas fica atrás de um "clique para assistir"
  // (ParticipantTile.jsx) até a chave aparecer aqui. Efêmero DE PROPÓSITO
  // (não é preferência persistida) - é "already opted into watching THIS
  // stream nesta chamada", não uma escolha permanente como autoplay/ocultar;
  // reseta sozinho quando o tile desaparece (ver efeito de poda abaixo, mesmo
  // padrão de pinnedKeys) e começa vazio a cada nova montagem do painel.
  const [manuallyStartedKeys, setManuallyStartedKeys] = useState(
    () => new Set(),
  );
  function startWatching(key) {
    setManuallyStartedKeys((prev) => {
      if (prev.has(key)) return prev;
      return new Set(prev).add(key);
    });
  }

  // Só usado no modo flutuante (ver mais abaixo) - reseta a cada nova
  // conexão pra uma chamada anterior minimizada não deixar a próxima já
  // minimizada de cara.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (connected) setMinimized(false);
  }, [connected]);

  // Fullscreen do painel embutido/popout (nunca do PiP flutuante, ver
  // `floating` mais abaixo - card minúsculo de canto não faz sentido em tela
  // cheia). `contentRef` aponta pro elemento que de fato entra em
  // fullscreen; como ele pode viver tanto no documento principal quanto no
  // documento do popout (outra janela inteira - ver comentário no topo do
  // arquivo), sempre usa `contentRef.current.ownerDocument`, nunca o
  // `document` global do módulo, pra pedir/sair de fullscreen na janela
  // CERTA.
  const contentRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(
        Boolean(document.fullscreenElement || popout?.document?.fullscreenElement),
      );
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    popout?.document?.addEventListener("fullscreenchange", syncFullscreen);
    syncFullscreen();
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      popout?.document?.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, [popout]);
  function toggleFullscreen() {
    const el = contentRef.current;
    if (!el) return;
    const doc = el.ownerDocument;
    if (doc.fullscreenElement) doc.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  // Janelas separadas (uma por TILE - câmera ou tela de um participante,
  // nunca o painel inteiro) - ver useTilePopouts.js/handleTogglePopoutTile
  // mais abaixo (depende de `allTiles`, que só existe adiante).
  const { windows: tilePopoutWindows, open: openTilePopout, close: closeTilePopout } =
    useTilePopouts();

  // Pausa a PRÓPRIA pré-visualização de tela compartilhada (só o que EU
  // vejo - o que os outros recebem não muda em nada, o producer continua
  // mandando normal) sempre que a janela que de fato exibe essa
  // pré-visualização perder o foco - decodificar+desenhar a própria tela em
  // tempo real custa CPU/GPU à toa enquanto ninguém tá olhando. `win` é
  // SEMPRE a janela que atualmente mostra o tile (o popout do painel, se
  // aberto, senão a principal - nunca as duas, mesma regra de `target` mais
  // abaixo) - reagir à janela errada (ex.: sempre a principal) deixaria a
  // pré-visualização pausada por engano com o popout aberto e em foco.
  const [screenPreviewPaused, setScreenPreviewPaused] = useState(false);
  useEffect(() => {
    const win = popout ?? window;
    function sync() {
      setScreenPreviewPaused(
        win.document.visibilityState === "hidden" || !win.document.hasFocus(),
      );
    }
    win.addEventListener("blur", sync);
    win.addEventListener("focus", sync);
    win.document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      win.removeEventListener("blur", sync);
      win.removeEventListener("focus", sync);
      win.document.removeEventListener("visibilitychange", sync);
    };
  }, [popout]);

  // Só usados pelo PiP flutuante (ver `floating` mais abaixo).
  // `speakingMap`: chave 'user:self'/'user:<id>' -> falando agora ou não,
  // alimentado por <SpeakingProbe> (um por pessoa com mic, não por tile -
  // uma tela compartilhada usa o mesmo mic de quem compartilha). É o
  // critério de "quanta mídia relevante" cada pessoa tá gerando agora, junto
  // com ter vídeo (câmera/tela) ligado - ver `activeTileKey` abaixo.
  const [speakingMap, setSpeakingMap] = useState(() => new Map());
  const updateSpeaking = useCallback((key, value) => {
    setSpeakingMap((prev) => {
      if (prev.get(key) === value) return prev;
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  }, []);

  // Posição do PiP arrastado (canto padrão é inferior-direito via CSS, só
  // vira coordenada absoluta depois do primeiro arrastar - ver
  // handlePipPointerDown/Move abaixo). Guardado fora de qualquer state de
  // chamada de propósito: arrastar uma vez deve valer pra próxima chamada
  // também, não resetar a cada reconexão.
  const [pipPos, setPipPos] = useState(null);
  const pipDragRef = useRef(null);
  const pipRef = useRef(null);

  // Reencaixa o PiP arrastado se a janela encolher (resize da janela, girar
  // celular, etc.) - sem isso a posição em px absoluto ficava fora da tela
  // (card "perdido") sempre que a nova largura/altura era menor que a
  // coordenada salva. Só ENCOLHE a posição quando precisa, nunca mexe se o
  // card já cabe onde está - e não faz nada se nunca foi arrastado (pipPos
  // null = ainda no canto padrão via CSS, que já é responsivo sozinho).
  useEffect(() => {
    function handleResize() {
      setPipPos((prev) => {
        if (!prev || !pipRef.current) return prev;
        const rect = pipRef.current.getBoundingClientRect();
        const maxTop = Math.max(window.innerHeight - rect.height, 0);
        const maxLeft = Math.max(window.innerWidth - rect.width, 0);
        const top = Math.min(prev.top, maxTop);
        const left = Math.min(prev.left, maxLeft);
        return top === prev.top && left === prev.left ? prev : { top, left };
      });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handlePipPointerDown(e) {
    if (e.button !== 0) return;
    // Clique num botão (minimizar, mutar localmente, etc.) não deve virar
    // drag - setPointerCapture abaixo reencaminha até o "click" pro elemento
    // que capturou (o próprio card), então sem este early return o botão
    // nunca recebia o clique (era exatamente o bug do minimizar não
    // funcionar).
    if (e.target.closest("button")) return;
    const rect = pipRef.current.getBoundingClientRect();
    pipDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: rect.top,
      startLeft: rect.left,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handlePipPointerMove(e) {
    const drag = pipDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const maxTop = window.innerHeight - drag.height;
    const maxLeft = window.innerWidth - drag.width;
    setPipPos({
      top: Math.min(Math.max(drag.startTop + dy, 0), Math.max(maxTop, 0)),
      left: Math.min(Math.max(drag.startLeft + dx, 0), Math.max(maxLeft, 0)),
    });
  }
  function handlePipPointerUp(e) {
    lastPipDragMovedRef.current = pipDragRef.current?.moved ?? false;
    pipDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // Um tile por PESSOA (câmera se estiver ligada, senão avatar com iniciais)
  // - nunca um por stream, para não duplicar quem está só com o mic ligado.
  const personTiles = useMemo(() => {
    const tiles = [];
    if (user) {
      tiles.push({
        key: "user:self",
        kind: "person",
        username: `${user.username} (você)`,
        avatarPath: user.avatarPath,
        isLocal: true,
        // Ícone de deafen deste tile = o PRÓPRIO estado (mesmo valor do
        // `deafened` global, ver comentário em ParticipantTile.jsx).
        participantDeafened: deafened,
        // `micTransmitting` já cobre mute manual + trava de moderador +
        // push-to-talk (tecla solta = não transmitindo) - ver
        // MediaSessionContext.jsx.
        micMuted: !micTransmitting,
        videoStream: cameraOn ? localCameraStream : null,
        // Ocultar a PRÓPRIA câmera é só uma preferência de visualização
        // (não existe "aguardando clique" nem popout pra tile local, ver
        // onTogglePopout/isLocal em ParticipantTile.jsx) - mesma chave
        // isMediaHidden/toggleMediaHidden já usada pra ocultar câmera/tela
        // de outros participantes, agora também pra si mesmo.
        hiddenMedia: isMediaHidden(user.id, "camera"),
        onToggleHiddenMedia: () => toggleMediaHidden(user.id, "camera"),
        // Stream crua do próprio mic (MediaSessionContext) - só pro anel de
        // "falando" (useSpeaking em ParticipantTile); ParticipantTile já
        // silencia a REPRODUÇÃO de tiles locais (`isLocal || deafened`), não
        // tem risco de ecoar o próprio áudio. `null` enquanto não
        // transmitindo (mutado, travado, ou push-to-talk com a tecla
        // solta): mutar/PTT só pausam o producer (a track crua local
        // continua captando áudio normalmente), sem isso o anel acenderia
        // falando mesmo com ninguém ouvindo - diferente de outro
        // participante mutado, cujo consumer pausado já vem sem áudio
        // (useSpeaking nunca acende sozinho).
        micStream: micTransmitting ? localMicStream : null,
      });
    }
    for (const p of participants) {
      if (p.userId === user?.id) continue;
      const micEntry = remoteStreams.find(
        (s) => s.userId === p.userId && s.appData?.source === "mic",
      );
      const cameraEntry = remoteStreams.find(
        (s) => s.userId === p.userId && s.appData?.source === "camera",
      );
      const key = `user:${p.userId}`;
      // Webcam remota: oculta (nunca chega no servidor, só visual/local) OU
      // aguardando clique (autoplayCamera desligado E ninguém clicou ainda
      // pra esta pessoa nesta chamada) - hidden sempre vence, ver
      // ParticipantTile.jsx.
      const hiddenMedia = isMediaHidden(p.userId, "camera");
      const needsManualStart =
        Boolean(cameraEntry?.stream) &&
        !autoplayCamera &&
        !hiddenMedia &&
        !manuallyStartedKeys.has(key);
      tiles.push({
        key,
        kind: "person",
        userId: p.userId,
        username: p.username,
        avatarPath: p.avatarPath,
        isLocal: false,
        // Ícone de deafen deste participante = o dele mesmo (`p.deafened`
        // do roster, transmitido pelo servidor via media:setDeafened - ver
        // MediaSessionContext.jsx), nunca o `deafened` global de quem está
        // vendo a chamada.
        participantDeafened: Boolean(p.deafened),
        micMuted: micEntry?.paused ?? false,
        videoStream: cameraEntry?.stream ?? null,
        micStream: micEntry?.stream ?? null,
        hiddenMedia,
        onToggleHiddenMedia: () => toggleMediaHidden(p.userId, "camera"),
        needsManualStart,
        onStartWatching: () => startWatching(key),
        locallyMuted: isLocallyMuted(p.userId),
        onToggleLocalMute: () => toggleLocalMute(p.userId),
      });
    }
    return tiles;
  }, [
    participants,
    remoteStreams,
    user,
    micTransmitting,
    cameraOn,
    localCameraStream,
    localMicStream,
    deafened,
    autoplayCamera,
    manuallyStartedKeys,
    isMediaHidden,
    toggleMediaHidden,
    isLocallyMuted,
    toggleLocalMute,
  ]);

  // Um tile por TELA compartilhada, sempre à parte do tile da pessoa (no
  // Discord, quem compartilha tela aparece com dois quadradinhos: o dela e o
  // da tela).
  const screenTiles = useMemo(() => {
    const tiles = [];
    if (sharingScreen) {
      tiles.push({
        key: "screen:self",
        kind: "screen",
        username: `${user?.username} (sua tela)`,
        isLocal: true,
        // `screenPreviewPaused` some com o STREAM de verdade (não é só CSS
        // escondendo, ver comentário na declaração dele acima) - é isso que
        // economiza recursos de fato enquanto a janela está sem foco. O
        // producer que os outros recebem nunca lê esse valor, continua
        // mandando a tela normalmente.
        videoStream: screenPreviewPaused ? null : localScreenStream,
        // Ocultar a PRÓPRIA tela é uma preferência à parte (manual,
        // persistida) - independente do pause automático acima, mesma
        // chave isMediaHidden/toggleMediaHidden de sempre.
        hiddenMedia: isMediaHidden(user?.id, "screen"),
        onToggleHiddenMedia: () => toggleMediaHidden(user?.id, "screen"),
        // Local: o volume é o GANHO DE ENVIO (0-200) que o próprio
        // compartilhador ajusta sobre o que está mandando - ver
        // setLocalScreenAudioVolume em MediaSessionContext.jsx.
        hasAudio: screenAudioEnabled,
        audioVolume: screenAudioVolume,
        audioVolumeMax: 200,
        onAudioVolumeChange: setLocalScreenAudioVolume,
        // Quem está assistindo ESTA tela agora, agregado pelo servidor -
        // nunca inclui o próprio compartilhador (ver setWatchingScreen: só
        // tiles REMOTOS reportam assistir, ver efeito abaixo).
        viewers: screenViewers[user?.id] ?? [],
      });
    }
    for (const s of remoteStreams) {
      if (s.appData?.source !== "screen") continue;
      // Remoto: o volume é de ESCUTA (0-100, per-listener) - existência do
      // producer irmão 'screen-audio' deste mesmo userId é o que decide se
      // este compartilhamento tem áudio ou não.
      const hasAudio = remoteStreams.some(
        (a) => a.userId === s.userId && a.appData?.source === "screen-audio",
      );
      const key = `screen:${s.userId}`;
      // Tela compartilhada remota: mesma prioridade hidden > manual-start de
      // personTiles acima, só que governada por autoplayScreenShare (padrão
      // DESLIGADO - ver PreferencesContext, diferente da webcam).
      const hiddenMedia = isMediaHidden(s.userId, "screen");
      const needsManualStart =
        !autoplayScreenShare && !hiddenMedia && !manuallyStartedKeys.has(key);
      tiles.push({
        key,
        kind: "screen",
        userId: s.userId,
        username: `${s.username} (tela)`,
        isLocal: false,
        videoStream: s.stream,
        hasAudio,
        audioVolume: getScreenAudioVolume(s.userId),
        audioVolumeMax: 100,
        onAudioVolumeChange: hasAudio
          ? (v) => setScreenAudioVolume(s.userId, v)
          : undefined,
        hiddenMedia,
        onToggleHiddenMedia: () => toggleMediaHidden(s.userId, "screen"),
        needsManualStart,
        onStartWatching: () => startWatching(key),
        viewers: screenViewers[s.userId] ?? [],
      });
    }
    return tiles;
  }, [
    remoteStreams,
    sharingScreen,
    localScreenStream,
    screenPreviewPaused,
    user,
    screenViewers,
    screenAudioEnabled,
    screenAudioVolume,
    setLocalScreenAudioVolume,
    getScreenAudioVolume,
    setScreenAudioVolume,
    autoplayScreenShare,
    manuallyStartedKeys,
    isMediaHidden,
    toggleMediaHidden,
  ]);

  // Reporta ao servidor quais telas REMOTAS este cliente está de fato
  // assistindo agora (vídeo visível E tocando - nem oculta, nem esperando
  // clique manual, ver `hiddenMedia`/`needsManualStart` acima) - é isso que
  // alimenta o indicador "N assistindo" no tile de quem compartilha (ver
  // ParticipantTile.jsx/MediaSessionContext.jsx). Só emite quando o
  // conjunto muda de fato (guardado em `reportedWatchingRef`, não a cada
  // render) - `screenViewers` entra nas deps de `screenTiles` acima, então
  // este efeito reroda a cada atualização de espectadores só pra achar o
  // mesmo conjunto de novo (comparação abaixo não emite nada nesse caso).
  const reportedWatchingRef = useRef(new Set());
  useEffect(() => {
    const watchingNow = new Set(
      screenTiles
        .filter((t) => !t.isLocal && t.videoStream && !t.hiddenMedia && !t.needsManualStart)
        .map((t) => t.userId),
    );
    const prev = reportedWatchingRef.current;
    for (const targetUserId of watchingNow) {
      if (!prev.has(targetUserId)) setWatchingScreen(targetUserId, true);
    }
    for (const targetUserId of prev) {
      if (!watchingNow.has(targetUserId)) setWatchingScreen(targetUserId, false);
    }
    reportedWatchingRef.current = watchingNow;
  }, [screenTiles, setWatchingScreen]);

  // VoicePanel nunca desmonta durante a chamada (é global, ver comentário no
  // topo do arquivo) - então o cleanup do efeito acima nunca dispara nem ao
  // trocar de canal. Só ao sair de vez da chamada (leaveVoice já reseta
  // `screenViewers` no servidor via clearScreenViewer, ver
  // mediasoup.handler.js) o estado reportado precisa zerar aqui também, pra
  // uma PRÓXIMA chamada não nascer com o Set antigo e nunca reportar nada de
  // novo (o efeito acima só emite em cima de MUDANÇA de conjunto).
  useEffect(() => {
    if (!connected) reportedWatchingRef.current = new Set();
  }, [connected]);

  // Um <audio> por compartilhamento de tela REMOTO com áudio - consumido por
  // RemoteAudioPlayers junto do mic de todo mundo (nunca filtrado por
  // visibleTiles, mesmo motivo de personTiles: áudio não pode depender do
  // tile aparecer no grid).
  const screenAudioTiles = useMemo(
    () =>
      remoteStreams
        .filter((s) => s.appData?.source === "screen-audio")
        .map((s) => ({
          key: `screen-audio:${s.userId}`,
          userId: s.userId,
          stream: s.stream,
        })),
    [remoteStreams],
  );

  const allTiles = useMemo(
    () => [...screenTiles, ...personTiles],
    [screenTiles, personTiles],
  );

  const poppedOutKeys = useMemo(
    () => new Set(tilePopoutWindows.keys()),
    [tilePopoutWindows],
  );
  function handleTogglePopoutTile(key) {
    if (tilePopoutWindows.has(key)) {
      closeTilePopout(key);
      return;
    }
    const tile = allTiles.find((t) => t.key === key);
    // Defesa extra: o botão já nem aparece pra tile local (ver
    // ParticipantTile.jsx), mas nunca abre a PRÓPRIA mídia numa janela
    // separada mesmo se chamado por algum outro caminho.
    if (!tile || tile.isLocal) return;
    openTilePopout(key, { title: `${tile.username} - NaveSpeak` });
  }
  // Fecha sozinha a janela de um tile quando a mídia dele acaba - saiu da
  // chamada (tile some de vez) ou desligou a câmera (tile de pessoa continua
  // existindo, mas sem `videoStream` - só avatar, não há mais o que ver numa
  // janela à parte). Tela compartilhada já cai no primeiro caso (o tile
  // 'screen:*' só existe enquanto a pessoa está compartilhando).
  useEffect(() => {
    for (const key of tilePopoutWindows.keys()) {
      const tile = allTiles.find((t) => t.key === key);
      const mediaEnded = !tile || (tile.kind === "person" && !tile.videoStream);
      if (mediaEnded) closeTilePopout(key);
    }
  }, [allTiles, tilePopoutWindows, closeTilePopout]);

  // Chave de quem "fala" por trás de um tile - pra tela compartilhada é
  // sempre o mic de quem tá compartilhando, nunca a tela em si (tela não
  // tem mic próprio). Mesmo formato de personTiles.key ('user:self' /
  // 'user:<id>'), assim dá pra usar direto como chave de speakingMap.
  function speakerKeyForTile(t) {
    if (t.kind === "screen") return t.isLocal ? "user:self" : `user:${t.userId}`;
    return t.key;
  }

  // Único tile exibido no PiP flutuante (ver `floating` mais abaixo) -
  // critério: quem tem vídeo (câmera OU tela) E está falando vence sempre
  // (score 3); só vídeo ou só falando empatam (score 2 e 1); ninguém com
  // nada, sobra o que já tava em exibição. Em empate de score, o tile ATUAL
  // continua vencendo (evita ficar trocando de câmera sem parar entre dois
  // participantes com o mesmo score) - só troca quando um novo tile supera
  // de verdade o score do atual.
  const activeTileKeyRef = useRef(null);
  const activeTileKey = useMemo(() => {
    if (allTiles.length === 0) return null;
    const score = (t) =>
      (t.videoStream ? 2 : 0) + (speakingMap.get(speakerKeyForTile(t)) ? 1 : 0);
    const current = allTiles.find((t) => t.key === activeTileKeyRef.current);
    let best = current ?? allTiles[0];
    let bestScore = score(best);
    for (const t of allTiles) {
      if (score(t) > bestScore) {
        best = t;
        bestScore = score(t);
      }
    }
    activeTileKeyRef.current = best.key;
    return best.key;
  }, [allTiles, speakingMap]);
  const activeTile = allTiles.find((t) => t.key === activeTileKey) ?? null;
  // eslint-disable-next-line no-unused-vars
  const { key: _activeTileKeyProp, ...activeTileProps } = activeTile ?? {};

  // Lista que de fato vai pro grid - com "esconder sem mídia" ligado, tira
  // quem só tem avatar (sem câmera/tela, kind='person' sem videoStream) E
  // quem tem mídia mas está OCULTADA (`hiddenMedia`, ver ParticipantTile.jsx/
  // PreferencesContext) - pro usuário, as duas situações são visualmente a
  // MESMA coisa (só o avatar, sem vídeo pra ver), então contam igual pra
  // este filtro. Quem quer reativar rápido sem mexer neste filtro tem o
  // atalho no indicador de câmera/tela da sidebar (ver VoiceRosterEntry.jsx).
  // Quem só tem o mic aberto continua sendo OUVIDO normalmente (o áudio não
  // depende do tile aparecer), só não ocupa quadradinho visual.
  //
  // `!t.hiddenMedia` fica FORA do OR de propósito (multiplicando os dois
  // termos, não só o primeiro): telas compartilhadas são auto-fixadas ao
  // aparecer (ver efeito logo abaixo), e fixado normalmente escapa deste
  // filtro (é a exceção "participante FIXADO nunca some sem mídia" - o
  // usuário pediu destaque nele de propósito). Mas ocultar é uma escolha
  // EXPLÍCITA e mais recente que esse auto-fixar automático - sem tirar
  // `hiddenMedia` do escopo do OR, uma tela ocultada DEPOIS de já fixada
  // automaticamente nunca saía do grid mesmo com este filtro ligado (o
  // `pinnedKeys.has(t.key)` sempre vencia sozinho). Oculto agora sempre
  // vence, fixado ou não - só quem NUNCA foi ocultado continua protegido
  // pelo pin.
  const visibleTiles = useMemo(() => {
    if (!hideParticipantsWithoutMedia) return allTiles;
    return allTiles.filter(
      (t) => !t.hiddenMedia && (t.videoStream || pinnedKeys.has(t.key)),
    );
  }, [allTiles, hideParticipantsWithoutMedia, pinnedKeys]);

  // Fixa automaticamente a primeira tela compartilhada nova que aparecer, se
  // nada mais já estiver fixado - assim quem está na chamada vê a tela em
  // destaque na hora, sem precisar clicar em fixar. Só dispara com o Set
  // vazio: se alguém já fixou algo (ou várias pessoas), uma tela nova entrar
  // não deve roubar/mudar o que já tá em destaque.
  useEffect(() => {
    const currentKeys = new Set(screenTiles.map((t) => t.key));
    const newKey = [...currentKeys].find(
      (k) => !prevScreenKeysRef.current.has(k),
    );
    prevScreenKeysRef.current = currentKeys;
    if (newKey) {
      setPinnedKeys((prev) => (prev.size === 0 ? new Set([newKey]) : prev));
    }
  }, [screenTiles]);

  // Se quem/o-que estava fixado sumir (saiu da chamada, parou de
  // compartilhar), desafixa só aquela chave - nunca trava numa fixação morta,
  // mas não mexe nas outras fixações ainda válidas.
  useEffect(() => {
    setPinnedKeys((prev) => {
      const liveKeys = new Set(allTiles.map((t) => t.key));
      const next = new Set([...prev].filter((k) => liveKeys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [allTiles]);

  // Mesma poda de pinnedKeys acima, pras chaves 'iniciadas manualmente' -
  // sem isso, parar de compartilhar e compartilhar de novo (ou sair/entrar
  // na chamada) manteria pra sempre uma chave morta no Set, sem efeito
  // nenhum (só memória), mas também sem nunca voltar a pedir o clique se um
  // NOVO stream reaproveitasse a MESMA chave (`user:<id>`/`screen:<id>` são
  // por PESSOA, não por stream - ver comentário de manuallyStartedKeys).
  useEffect(() => {
    setManuallyStartedKeys((prev) => {
      const liveKeys = new Set(allTiles.map((t) => t.key));
      const next = new Set([...prev].filter((k) => liveKeys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [allTiles]);

  function togglePin(key) {
    setPinnedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePopout() {
    if (popout) closePopout();
    else openPopout({ width: 480, height: 680, title: "Voz - NaveSpeak" });
  }

  // Duplo clique no PiP flutuante leva direto pro servidor+canal de voz
  // conectado (?channel=<id> já é o formato que RoomPage usa pra abrir
  // direto num canal - ver o próprio RoomPage.jsx). Chamada privada (DM,
  // `voiceRoomId` nulo) não tem essa rota - ignora o clique.
  const lastPipDragMovedRef = useRef(false);
  function handlePipDoubleClick() {
    if (lastPipDragMovedRef.current) return;
    if (!voiceRoomId) return;
    navigate(`/rooms/${voiceRoomId}?channel=${voiceChannelId}`);
  }

  if (!connected) return null;

  // Alvo de renderização: a janela de popout se estiver aberta (sobrepõe a
  // tela atual), senão o container que a tela atual registrou como âncora do
  // painel embutido. Sem nenhum dos dois - caso de uma chamada privada, ou
  // de navegar pra fora de RoomPage durante uma chamada de sala - vira
  // flutuante (ver comentário no topo do arquivo).
  const target = popout ? popout.document.body : panelAnchor;
  const floating = !target;

  const content = (
    <div ref={contentRef} className="flex h-full flex-col">
      <div
        className={`${popout ? "justify-center dark:bg-black p-2 rounded-xl" : "justify-between"} mb-3 flex flex-wrap items-center  gap-2`}
      >
        {!popout && (
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Voz · {allTiles.length} na chamada
          </h3>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isCall && <AddCallParticipant roster={activeRoster} />}

          {/* Modo do layout de vídeo: "Grade" (SimpleVideoGrid - tamanho
              fixo, só CSS, sem resize) ou "Livre" (VideoLayoutManager -
              grid automático + resize manual por tile). Preferência
              persistida (PreferencesContext), vale pra qualquer chamada. */}
          <div className="flex rounded-lg bg-slate-700 p-0.5 text-sm">
            <button
              onClick={() => setVideoLayoutMode("grid")}
              title="Grade fixa, sem resize manual"
              className={` cursor-pointer rounded-md px-2.5 py-1 transition ${
                videoLayoutMode === "grid"
                  ? "bg-slate-500 text-white"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Grid2x2 />
            </button>
            <button
              onClick={() => setVideoLayoutMode("free")}
              title="Grid automático + resize manual por tile"
              className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
                videoLayoutMode === "free"
                  ? "bg-slate-500 text-white"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <LayoutFreeform />
            </button>
          </div>
          <button
            onClick={toggleHideParticipantsWithoutMedia}
            title={
              hideParticipantsWithoutMedia
                ? "Mostrar quem está sem câmera/tela (só avatar)"
                : "Esconder quem está sem câmera/tela (só avatar)"
            }
            aria-pressed={hideParticipantsWithoutMedia}
            className={`rounded-lg p-2 text-white transition ${
              hideParticipantsWithoutMedia
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-slate-700 hover:bg-slate-600"
            }`}
          >
            {hideParticipantsWithoutMedia ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>

          {popout && (
            <div>
              <div className="flex flex-wrap gap-2 ">
                <button
                  onClick={cameraOn ? stopCamera : shareCamera}
                  disabled={!cameraOn && mediaLocked}
                  title={
                    !cameraOn && mediaLocked
                      ? "Um moderador bloqueou sua mídia neste canal"
                      : undefined
                  }
                  className={`cursor-pointer rounded-lg  px-3 py-1.5 text-sm text-white  disabled:cursor-not-allowed disabled:opacity-50 ${
                    cameraOn
                      ? "bg-blue-600 hover:bg-blue-500"
                      : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  {cameraOn ? (
                    <Camera className="size-4" />
                  ) : mediaLocked ? (
                    "Mídia bloqueada"
                  ) : (
                    <CameraOff className="size-4" />
                  )}
                </button>
                <button
                  onClick={toggleMute}
                  disabled={muted && audioLocked}
                  title={
                    muted && audioLocked
                      ? "Um moderador bloqueou seu áudio neste canal"
                      : undefined
                  }
                  className={`cursor-pointer rounded-lg  px-3 py-1.5 text-sm text-white  ${
                    muted
                      ? "bg-red-600 hover:bg-red-500"
                      : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  {muted ? (
                    audioLocked ? (
                      "Mutado por moderador"
                    ) : (
                      <MicOff className="size-4" />
                    )
                  ) : (
                    <Mic className="size-4" />
                  )}
                </button>

                <button
                  onClick={toggleDeafen}
                  className={`cursor-pointer rounded-lg  px-3 py-1.5 text-sm text-white  ${
                    deafened
                      ? "bg-red-600 hover:bg-red-500"
                      : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  {deafened ? (
                    <HeadphoneOff className="size-4" />
                  ) : (
                    <Headphones className="size-4" />
                  )}
                </button>
                <button
                  onClick={leaveVoice}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Sair da voz
                </button>
              </div>
            </div>
          )}
          <button
            onClick={togglePopout}
            title={popout ? "Encaixar de volta" : "Abrir em uma nova janela"}
            className={`rounded-lg p-2 text-white transition ${
              popout
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-slate-700 hover:bg-slate-600"
            }`}
          >
            <ExternalLink className="size-4" />
          </button>

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            className={`rounded-lg p-2 text-white transition ${
              isFullscreen
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-slate-700 hover:bg-slate-600"
            }`}
          >
            {isFullscreen ? (
              <Minimize className="size-4" />
            ) : (
              <Maximize className="size-4" />
            )}
          </button>

          <button
            onClick={toggleMembersSidebar}
            title={
              membersSidebarVisible
                ? "Esconder painel de participantes"
                : "Mostrar painel de participantes"
            }
            aria-pressed={membersSidebarVisible}
            className={`rounded-lg p-2 text-white transition ${
              membersSidebarVisible
                ? "bg-slate-700 hover:bg-slate-600"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {membersSidebarVisible ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </button>

          {floating && (
            <button
              onClick={() => setMinimized(true)}
              title="Minimizar"
              className="rounded-lg bg-slate-700 p-2 text-white transition hover:bg-slate-600"
            >
              <ChevronDown className="size-4" />
            </button>
          )}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* Sempre com personTiles CHEIO (nunca visibleTiles) - o áudio de
          ninguém pode depender do filtro "esconder sem câmera/tela" nem de
          qual tile está fixado, ver RemoteAudioPlayers.jsx. */}
      <RemoteAudioPlayers
        tiles={personTiles}
        screenAudioTiles={screenAudioTiles}
        deafened={deafened}
        getUserVolume={getUserVolume}
        getScreenAudioVolume={getScreenAudioVolume}
        isLocallyMuted={isLocallyMuted}
        outputDeviceId={outputDeviceId}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {videoLayoutMode === "free" ? (
          <VideoLayoutManager
            tiles={visibleTiles}
            pinnedKeys={pinnedKeys}
            onTogglePin={togglePin}
            deafened={deafened}
            poppedOutKeys={poppedOutKeys}
            onTogglePopout={handleTogglePopoutTile}
          />
        ) : (
          <SimpleVideoGrid
            tiles={visibleTiles}
            pinnedKeys={pinnedKeys}
            onTogglePin={togglePin}
            deafened={deafened}
            poppedOutKeys={poppedOutKeys}
            onTogglePopout={handleTogglePopoutTile}
          />
        )}
      </div>
    </div>
  );

  // Uma janela por tile "separado" (ver handleTogglePopoutTile acima) -
  // independente do painel estar embutido, em popout ou flutuante, então
  // fica FORA do `if (floating)` abaixo: renderiza junto dos dois jeitos.
  // ParticipantTile sem `pinned`/`onTogglePin` de propósito - fixar não faz
  // sentido numa janela solta (não existe grid ali pra fixar dentro).
  const tilePopoutPortals = [...tilePopoutWindows].map(([key, win]) => {
    const tile = allTiles.find((t) => t.key === key);
    if (!tile) return null;
    const { key: _tileKey, ...tileProps } = tile;
    return createPortal(
      <ParticipantTile
        key={key}
        {...tileProps}
        deafened={deafened}
        className="!aspect-auto !rounded-none h-full w-full"
      />,
      win.document.body,
    );
  });

  if (floating) {
    // PiP flutuante: SÓ UM tile por vez (quem tem vídeo + fala vence, ver
    // `activeTileKey` acima) - o resto da chamada continua ouvido
    // normalmente (RemoteAudioPlayers abaixo nunca filtra por tile
    // exibido), só não ocupa quadradinho visual. <SpeakingProbe> roda um
    // AnalyserNode por pessoa com mic só pra alimentar essa escolha -
    // ninguém mais precisa saber "quem tá falando" fora do PiP.
    //
    // Minimizado NUNCA desmonta o tile nem os players de áudio - só esconde
    // via CSS (`hidden`), mesmo motivo de sempre: cortar o <audio>/<video>
    // ao minimizar cortava o som da chamada inteira até desminimizar.
    return (
      <>
        {createPortal(
          <>
            {personTiles.map((t) => (
              <SpeakingProbe
                key={t.key}
                speakerKey={t.key}
                stream={t.micStream}
                onChange={updateSpeaking}
              />
            ))}
            <RemoteAudioPlayers
              tiles={personTiles}
              screenAudioTiles={screenAudioTiles}
              deafened={deafened}
              getUserVolume={getUserVolume}
              getScreenAudioVolume={getScreenAudioVolume}
              isLocallyMuted={isLocallyMuted}
              outputDeviceId={outputDeviceId}
            />
            {minimized && (
              <button
                onClick={() => setMinimized(false)}
                className="fixed bottom-24 right-4 z-20 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                🔊 Mostrar chamada ({allTiles.length})
              </button>
            )}
            <div
              ref={pipRef}
              onPointerDown={handlePipPointerDown}
              onPointerMove={handlePipPointerMove}
              onPointerUp={handlePipPointerUp}
              onDoubleClick={handlePipDoubleClick}
              title="Arraste para reposicionar · duplo clique para abrir o canal"
              style={
                pipPos
                  ? { top: pipPos.top, left: pipPos.left, right: "auto", bottom: "auto" }
                  : undefined
              }
              className={`fixed z-20 w-64 max-w-[calc(100vw-2rem)] cursor-grab touch-none select-none overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200 active:cursor-grabbing dark:ring-slate-800 ${
                pipPos ? "" : "bottom-24 right-4"
              } ${minimized ? "hidden" : ""}`}
            >
              {activeTile && (
                <ParticipantTile
                  key={activeTile.key}
                  {...activeTileProps}
                  deafened={deafened}
                  className="!rounded-2xl"
                />
              )}
              <button
                onClick={() => setMinimized(true)}
                title="Minimizar"
                className="absolute left-1.5 top-1.5 rounded-lg bg-black/50 p-1.5 text-white transition hover:bg-black/70"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
          </>,
          document.body,
        )}
        {tilePopoutPortals}
      </>
    );
  }
  return (
    <>
      {createPortal(content, target)}
      {tilePopoutPortals}
    </>
  );
}
