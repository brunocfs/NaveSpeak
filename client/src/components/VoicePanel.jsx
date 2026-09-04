import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useCall } from "../context/CallContext.jsx";
import VideoLayoutManager from "./VideoLayoutManager.jsx";
import SimpleVideoGrid from "./SimpleVideoGrid.jsx";
import RemoteAudioPlayers from "./RemoteAudioPlayers.jsx";
import AddCallParticipant from "./AddCallParticipant.jsx";
import { usePreferences } from "../context/PreferencesContext.jsx";

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
    localMicStream,
    micTransmitting,
    voiceRoster: participants,
    panelAnchor,
    popout,
    openPopout,
    closePopout,
  } = media;

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
        // `micTransmitting` já cobre mute manual + trava de moderador +
        // push-to-talk (tecla solta = não transmitindo) - ver
        // MediaSessionContext.jsx.
        micMuted: !micTransmitting,
        videoStream: cameraOn ? localCameraStream : null,
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
        videoStream: localScreenStream,
        // Local: o volume é o GANHO DE ENVIO (0-200) que o próprio
        // compartilhador ajusta sobre o que está mandando - ver
        // setLocalScreenAudioVolume em MediaSessionContext.jsx.
        hasAudio: screenAudioEnabled,
        audioVolume: screenAudioVolume,
        audioVolumeMax: 200,
        onAudioVolumeChange: setLocalScreenAudioVolume,
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
      });
    }
    return tiles;
  }, [
    remoteStreams,
    sharingScreen,
    localScreenStream,
    user,
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

  if (!connected) return null;

  // Alvo de renderização: a janela de popout se estiver aberta (sobrepõe a
  // tela atual), senão o container que a tela atual registrou como âncora do
  // painel embutido. Sem nenhum dos dois - caso de uma chamada privada, ou
  // de navegar pra fora de RoomPage durante uma chamada de sala - vira
  // flutuante (ver comentário no topo do arquivo).
  const target = popout ? popout.document.body : panelAnchor;
  const floating = !target;

  const content = (
    <div className="flex h-full flex-col">
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
          />
        ) : (
          <SimpleVideoGrid
            tiles={visibleTiles}
            pinnedKeys={pinnedKeys}
            onTogglePin={togglePin}
            deafened={deafened}
          />
        )}
      </div>
    </div>
  );

  if (floating) {
    // Minimizado NUNCA desmonta `content` - só esconde via CSS (`hidden`).
    // Desmontar destruía todo <audio>/<video> dos participantes remotos
    // (eles vivem dentro de ParticipantTile, que só existe dentro de
    // `content`), cortando o áudio da chamada inteira até desminimizar -
    // <audio>/<video> continuam tocando normalmente com display:none, então
    // esconder em vez de desmontar resolve sem perder nada.
    return createPortal(
      <>
        {minimized && (
          <button
            onClick={() => setMinimized(false)}
            className="fixed bottom-24 right-4 z-20 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            🔊 Mostrar chamada ({allTiles.length})
          </button>
        )}
        <div
          // max-h + overflow-hidden: sem isso, uma chamada com muita gente
          // fazia esse card crescer do tamanho do grid inteiro (sem limite),
          // estourando pra fora da tela (pra cima, já que ele é ancorado
          // embaixo com `fixed bottom-24`) ao desminimizar. Com o teto aqui,
          // é o `overflow-auto` que já existia dentro de `content` (na área
          // do grid) que passa a rolar de verdade em vez de nunca ser
          // acionado (só rola quando o pai tem altura definida).
          className={`fixed bottom-24 right-4 z-20 flex max-h-[calc(100vh-7rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-slate-900 p-4 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 ${
            minimized ? "hidden" : ""
          }`}
        >
          {content}
        </div>
      </>,
      document.body,
    );
  }
  return createPortal(content, target);
}
