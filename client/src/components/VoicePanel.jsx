import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useMediaSession } from '../context/MediaSessionContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import ParticipantTile from './ParticipantTile.jsx';
import AddCallParticipant from './AddCallParticipant.jsx';

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
    voiceRoster: participants,
    panelAnchor,
    popout,
    openPopout,
    closePopout,
  } = media;

  // Chave do tile fixado ("spotlight") - 'user:<id>' ou 'screen:<id>'.
  const [pinnedKey, setPinnedKey] = useState(null);
  const prevScreenKeysRef = useRef(new Set());

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
        key: 'user:self',
        kind: 'person',
        username: `${user.username} (você)`,
        avatarPath: user.avatarPath,
        isLocal: true,
        micMuted: muted,
        videoStream: cameraOn ? localCameraStream : null,
        micStream: null,
      });
    }
    for (const p of participants) {
      if (p.userId === user?.id) continue;
      const micEntry = remoteStreams.find(
        (s) => s.userId === p.userId && s.appData?.source === 'mic'
      );
      const cameraEntry = remoteStreams.find(
        (s) => s.userId === p.userId && s.appData?.source === 'camera'
      );
      tiles.push({
        key: `user:${p.userId}`,
        kind: 'person',
        username: p.username,
        avatarPath: p.avatarPath,
        isLocal: false,
        micMuted: micEntry?.paused ?? false,
        videoStream: cameraEntry?.stream ?? null,
        micStream: micEntry?.stream ?? null,
      });
    }
    return tiles;
  }, [participants, remoteStreams, user, muted, cameraOn, localCameraStream]);

  // Um tile por TELA compartilhada, sempre à parte do tile da pessoa (no
  // Discord, quem compartilha tela aparece com dois quadradinhos: o dela e o
  // da tela).
  const screenTiles = useMemo(() => {
    const tiles = [];
    if (sharingScreen) {
      tiles.push({
        key: 'screen:self',
        kind: 'screen',
        username: `${user?.username} (sua tela)`,
        isLocal: true,
        videoStream: localScreenStream,
      });
    }
    for (const s of remoteStreams) {
      if (s.appData?.source !== 'screen') continue;
      tiles.push({
        key: `screen:${s.userId}`,
        kind: 'screen',
        username: `${s.username} (tela)`,
        isLocal: false,
        videoStream: s.stream,
      });
    }
    return tiles;
  }, [remoteStreams, sharingScreen, localScreenStream, user]);

  const allTiles = useMemo(() => [...screenTiles, ...personTiles], [screenTiles, personTiles]);

  // Fixa automaticamente a primeira tela compartilhada nova que aparecer, se
  // nada mais já estiver fixado - assim quem está na chamada vê a tela em
  // destaque na hora, sem precisar clicar em fixar.
  useEffect(() => {
    const currentKeys = new Set(screenTiles.map((t) => t.key));
    const newKey = [...currentKeys].find((k) => !prevScreenKeysRef.current.has(k));
    prevScreenKeysRef.current = currentKeys;
    if (newKey && !pinnedKey) setPinnedKey(newKey);
  }, [screenTiles, pinnedKey]);

  // Se quem/o-que estava fixado sumir (saiu da chamada, parou de
  // compartilhar), desafixa - nunca trava numa fixação morta.
  useEffect(() => {
    if (pinnedKey && !allTiles.some((t) => t.key === pinnedKey)) setPinnedKey(null);
  }, [allTiles, pinnedKey]);

  function togglePin(key) {
    setPinnedKey((prev) => (prev === key ? null : key));
  }

  function togglePopout() {
    if (popout) closePopout();
    else openPopout({ width: 480, height: 680, title: 'Voz - NaveSpeak' });
  }

  if (!connected) return null;

  // Alvo de renderização: a janela de popout se estiver aberta (sobrepõe a
  // tela atual), senão o container que a tela atual registrou como âncora do
  // painel embutido. Sem nenhum dos dois - caso de uma chamada privada, ou
  // de navegar pra fora de RoomPage durante uma chamada de sala - vira
  // flutuante (ver comentário no topo do arquivo).
  const target = popout ? popout.document.body : panelAnchor;
  const floating = !target;

  if (floating && minimized) {
    return createPortal(
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-24 right-4 z-20 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
      >
        🔊 Mostrar chamada ({allTiles.length})
      </button>,
      document.body
    );
  }

  const pinnedTile = allTiles.find((t) => t.key === pinnedKey) ?? null;
  const restTiles = pinnedTile ? allTiles.filter((t) => t.key !== pinnedKey) : allTiles;

  const content = (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Voz · {allTiles.length} na chamada
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          {isCall && <AddCallParticipant roster={activeRoster} />}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={toggleMute}
              disabled={muted && audioLocked}
              title={muted && audioLocked ? 'Um moderador bloqueou seu áudio neste canal' : undefined}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {muted ? (audioLocked ? '🔒 Mutado por moderador' : 'Ativar mic') : 'Silenciar'}
            </button>
            <button
              onClick={cameraOn ? stopCamera : shareCamera}
              disabled={!cameraOn && mediaLocked}
              title={!cameraOn && mediaLocked ? 'Um moderador bloqueou sua mídia neste canal' : undefined}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cameraOn ? 'Desligar câmera' : mediaLocked ? '🔒 Mídia bloqueada' : 'Ligar câmera'}
            </button>
            <button
              onClick={toggleDeafen}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
            >
              {deafened ? 'Ouvir todos' : 'Silenciar todos'}
            </button>
            <button
              onClick={leaveVoice}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Sair da voz
            </button>
          </div>

          <button
            onClick={togglePopout}
            title={popout ? 'Encaixar de volta' : 'Abrir em uma nova janela'}
            className={`rounded-lg p-2 text-white transition ${
              popout ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            <ExternalLink className="size-4" />
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

      <div className="min-h-0 flex-1 overflow-auto">
        {pinnedTile ? (
          <div className="flex h-full min-h-[22rem] flex-col gap-3 md:flex-row">
            <div className="min-h-0 flex-1">
              <ParticipantTile
                {...pinnedTile}
                pinned
                deafened={deafened}
                onTogglePin={() => togglePin(pinnedTile.key)}
                className="!aspect-auto h-full min-h-[22rem]"
              />
            </div>
            {restTiles.length > 0 && (
              <div className="flex gap-2 overflow-x-auto md:w-44 md:flex-col md:overflow-x-hidden md:overflow-y-auto">
                {restTiles.map((t) => (
                  <ParticipantTile
                    key={t.key}
                    {...t}
                    deafened={deafened}
                    onTogglePin={() => togglePin(t.key)}
                    className="w-40 shrink-0 md:w-full"
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {allTiles.map((t) => (
              <ParticipantTile
                key={t.key}
                {...t}
                deafened={deafened}
                onTogglePin={() => togglePin(t.key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (floating) {
    return createPortal(
      <div className="fixed bottom-24 right-4 z-20 flex h-[28rem] w-[26rem] max-w-[calc(100vw-2rem)] flex-col rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        {content}
      </div>,
      document.body
    );
  }
  return createPortal(content, target);
}
