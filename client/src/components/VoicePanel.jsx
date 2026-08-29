import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ParticipantTile from './ParticipantTile.jsx';
import { useWindowPopout } from '../hooks/useWindowPopout.js';

// Recebe o hook useMediasoup já instanciado pelo RoomPage (em vez de criar o
// seu próprio), assim outros componentes compartilham a mesma conexão/estado
// em vez de abrir transports duplicados. channelId é o canal de voz alvo
// (usado para iniciar a chamada); participants é o roster de quem está na
// chamada (voiceRosters[channelId] no RoomPage) - é a fonte de verdade de
// "quem mostrar" no grid, independente de já termos recebido o producer de
// mídia dessa pessoa ou não (evita gente "sumir" do grid por causa de uma
// corrida entre o roster via socket e o consumo do producer via WebRTC).
export default function VoicePanel({ media, channelId, participants = [] }) {
  const { user } = useAuth();
  const {
    connected,
    muted,
    remoteStreams,
    error,
    joinVoice,
    leaveVoice,
    toggleMute,
    deafened,
    toggleDeafen,
    cameraOn,
    localCameraStream,
    shareCamera,
    stopCamera,
    sharingScreen,
    localScreenStream,
  } = media;

  const { popout, open: openPopout, close: closePopout } = useWindowPopout();
  // Chave do tile fixado ("spotlight") - 'user:<id>' ou 'screen:<id>'.
  const [pinnedKey, setPinnedKey] = useState(null);
  const prevScreenKeysRef = useRef(new Set());

  // Um tile por PESSOA (câmera se estiver ligada, senão avatar com iniciais)
  // - nunca um por stream, para não duplicar quem está só com o mic ligado.
  const personTiles = useMemo(() => {
    const tiles = [];
    if (user) {
      tiles.push({
        key: 'user:self',
        kind: 'person',
        username: `${user.username} (você)`,
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

  const pinnedTile = allTiles.find((t) => t.key === pinnedKey) ?? null;
  const restTiles = pinnedTile ? allTiles.filter((t) => t.key !== pinnedKey) : allTiles;

  const content = (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Voz{connected ? ` · ${allTiles.length} na chamada` : ''}
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          {!connected ? (
            <button
              onClick={() => joinVoice(channelId)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Entrar na voz
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={toggleMute}
                className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
              >
                {muted ? 'Ativar mic' : 'Silenciar'}
              </button>
              <button
                onClick={cameraOn ? stopCamera : shareCamera}
                className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
              >
                {cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
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
          )}

          {connected && (
            <button
              onClick={togglePopout}
              title={popout ? 'Encaixar de volta' : 'Abrir em uma nova janela'}
              className={`rounded-lg p-2 text-white transition ${
                popout ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              <ExternalLink className="size-4" />
            </button>
          )}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {connected && (
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
      )}
    </div>
  );

  // Quando destacado, o mesmo conteúdo (mesma árvore React, mesmos
  // MediaStreams ao vivo) é portado para a janela independente em vez de
  // duplicado - fechar a janela (pelo nosso botão ou pelo X nativo dela) a
  // devolve pro lugar original automaticamente.
  if (popout) return createPortal(content, popout.document.body);
  return content;
}
