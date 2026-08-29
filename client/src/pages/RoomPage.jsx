import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import ChatPanel from "../components/ChatPanel.jsx";
import VoicePanel from "../components/VoicePanel.jsx";
import ScreenSourcePicker from "../components/ScreenSourcePicker.jsx";
import { useMediasoup } from "../hooks/useMediasoup.js";
import { isElectron, listScreenSources } from "../api/media.js";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  MessageSquare,
  Headphones,
} from "lucide-react";

export default function RoomPage() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [online, setOnline] = useState([]);
  // Status ONLINE global por usuário (independente de canal/servidor) -
  // distinto de `online` acima, que é só quem está vendo o canal ativo.
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  // Roster de voz de TODOS os canais do servidor, por channelId - mantido à
  // parte de `channels` (e não como um campo dentro de cada canal) de
  // propósito: os eventos voice:update do server:join podem chegar antes da
  // resposta REST que popula `channels` (é uma corrida entre socket e HTTP),
  // e um Map indexado por channelId nunca perde esse evento só porque o
  // canal ainda não existe no array no momento em que ele chega.
  const [voiceRosters, setVoiceRosters] = useState({});
  const [error, setError] = useState(null);
  // Fontes de tela/janela do Electron, quando o usuário clica em
  // compartilhar tela pelo painel fixo (fora do Electron, getDisplayMedia já
  // mostra o seletor nativo do navegador, então isso fica sempre null).
  const [screenPickerSources, setScreenPickerSources] = useState(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;
  const selectedChannel =
    channels.find((c) => c.id === selectedChannelId) ?? null;
  const isVoice = activeChannel?.type === "voice";
  // A conexão de voz é independente do canal visualizado: media gerencia o
  // canal de voz ao qual o usuário está conectado (media.voiceChannelId).
  const media = useMediasoup();
  // Roster de quem está na chamada do canal ativo.
  const voiceParticipants = voiceRosters[activeChannelId] ?? [];

  // Clicar num canal de voz seleciona ELE e já conecta na chamada - não
  // exige um segundo clique em "Entrar na voz". Só entra de novo se ainda
  // não estiver conectado a esse canal (reclicar o canal já ativo não deve
  // recriar a conexão de mídia).
  function openVoiceChannel(channelId) {
    setActiveChannelId(channelId);
    if (media.voiceChannelId !== channelId) media.joinVoice(channelId);
  }

  // Compartilhar/parar tela a partir do painel fixo - no Electron precisa
  // abrir o seletor de fonte antes (getDisplayMedia não funciona lá dentro).
  async function toggleScreenShare() {
    if (media.sharingScreen) {
      media.stopScreenShare();
      return;
    }
    if (isElectron()) {
      const sources = await listScreenSources();
      setScreenPickerSources(sources ?? []);
      return;
    }
    media.shareScreen();
  }

  useEffect(() => {
    let cancelled = false;
    // Troca de servidor: descarta o roster de voz do servidor anterior (os
    // channelIds são de outro servidor, não colidem, mas não há por que
    // manter esse estado morto em memória).
    setVoiceRosters({});

    Promise.all([
      apiRequest(`/rooms/${roomId}`),
      apiRequest(`/rooms/${roomId}/channels`),
    ])
      .then(([roomData, channelsData]) => {
        if (cancelled) return;
        setRoom(roomData.room);
        setMembers(roomData.members);
        const chs = channelsData.channels ?? [];
        setChannels(chs);
        const firstText = chs.find((c) => c.type === "text");
        setActiveChannelId(firstText?.id ?? chs[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [roomId]);
  useEffect(() => {
    const socket = getSocket();

    // Entrar no servidor entrega, via voice:update (tratado no efeito
    // abaixo, que já está com listener registrado antes do server:join
    // responder), o roster inicial de cada canal de voz - sem precisar abrir
    // cada um.
    function serverJoin() {
      socket.emit("server:join", roomId, (response) => {
        if (response?.error) setError(response.error);
        else if (response?.onlineUserIds)
          setOnlineUserIds(new Set(response.onlineUserIds));
      });
    }
    function handleUserOnline({ userId }) {
      setOnlineUserIds((prev) => new Set(prev).add(userId));
    }
    function handleUserOffline({ userId }) {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
    // Roster de voz de qualquer canal do servidor - chega assim que o
    // usuário entra no servidor (server:join manda o roster de todo canal de
    // voz) e a cada entra/sai de alguém, independente de qual canal está
    // selecionado. Registrado aqui (efeito por servidor, não por canal
    // ativo) para nunca perder um evento por causa de trocar de canal.
    function handleVoice(update) {
      setVoiceRosters((prev) => ({
        ...prev,
        [update.channelId]: update.participants ?? [],
      }));
    }

    if (socket.connected) serverJoin();
    socket.on("connect", serverJoin);
    socket.on("user:online", handleUserOnline);
    socket.on("user:offline", handleUserOffline);
    socket.on("voice:update", handleVoice);
    return () => {
      socket.off("connect", serverJoin);
      socket.off("user:online", handleUserOnline);
      socket.off("user:offline", handleUserOffline);
      socket.off("voice:update", handleVoice);
    };
  }, [roomId]);

  useEffect(() => {
    const socket = getSocket();
    function handlePresence(update) {
      if (update.channelId === activeChannelId) setOnline(update.members);
    }

    socket.on("connect", join);
    socket.on("presence:update", handlePresence);
    if (!activeChannelId) return;
    // channel:join vale para qualquer tipo de canal (texto ou voz) - é o que
    // popula a presença "quem está vendo este canal" e, em canais de voz,
    // entrega o roster inicial da chamada.
    if (socket.connected) join();

    function join() {
      socket.emit("channel:join", activeChannelId, (response) => {
        if (response?.error) setError(response.error);
        else if (response?.members) setOnline(response.members);
      });
    }
    return () => {
      socket.emit("channel:leave", activeChannelId);
      socket.off("connect", join);
      socket.off("presence:update", handlePresence);
    };
  }, [activeChannelId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900/50 dark:bg-slate-900">
          <p className="text-sm font-medium text-red-600 dark:text-red-300">
            {error}
          </p>
          <Link
            to="/rooms"
            className="mt-4 inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Voltar para as salas
          </Link>
        </div>
      </div>
    );
  }

  if (!room || !activeChannel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Carregando...
        </p>
      </div>
    );
  }

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-8xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              &larr;
            </Link>

            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-slate-900 dark:text-white">
                {room.name}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {activeChannel.type === "voice"
                  ? "Canal de voz"
                  : "Canal de texto"}
                {activeChannel.name ? ` · ${activeChannel.name}` : ""}
              </p>
            </div>
          </div>

          <span
            title="Código de convite"
            className="shrink-0 rounded-xl bg-slate-200 px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {room.invite_code}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-8xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:px-8">
        <aside className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Canais
          </h2>

          <div className="mb-4">
            <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Texto
            </p>
            <ul className="space-y-1">
              {textChannels.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveChannelId(c.id)}
                    //onClick={() => setSelectedChannelId(c.id)}
                    className={`w-full truncate rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                      c.id === activeChannelId
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    # {c.name}
                  </button>
                </li>
              ))}
              {textChannels.length === 0 && (
                <li className="px-1 text-sm text-slate-500 dark:text-slate-400">
                  Nenhum canal de texto.
                </li>
              )}
            </ul>
          </div>

          <div>
            <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Voz
            </p>
            <ul className="space-y-1">
              {voiceChannels.map((c) => (
                <div>
                  <li key={c.id}>
                    <button
                      onClick={() => openVoiceChannel(c.id)}
                      className={`w-full truncate rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                        c.id === activeChannelId
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      🔊 {c.name}
                    </button>
                  </li>
                  <ul className="flex flex-col gap-2 ml-2">
                    {(voiceRosters[c.id] ?? []).map((p) => (
                      <li
                        key={p.userId}
                        className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-slate-700 dark:text-slate-200"
                      >
                        <span className="h-5 w-5 shrink-0 rounded-full bg-emerald-500" />
                        <labe className="ml-1">{p.username}</labe>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {voiceChannels.length === 0 && (
                <li className="px-1 text-sm text-slate-500 dark:text-slate-400">
                  Nenhum canal de voz.
                </li>
              )}
            </ul>
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {isVoice ? (
            <div className="p-4">
              {/* <div className="mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Voz e mídia
                </h2>
              </div> */}

              {/* Roster: quem está no canal de voz (visível mesmo sem estar
                  conectado) */}
              {/* <div className="mb-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Na voz ({voiceParticipants.length})
                </p>
                {voiceParticipants.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Ninguém conectado na voz ainda.
                  </p>
                ) : (
                  <ul className="flex flex-col items-start gap-2">
                    {voiceParticipants.map((p) => (
                      <li
                        key={p.userId}
                        className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {p.username}
                      </li>
                    ))}
                  </ul>
                )}
              </div> */}

              {media.voiceChannelId === activeChannel.id && media.connected ? (
                <VoicePanel
                  media={media}
                  channelId={activeChannel.id}
                  participants={voiceParticipants}
                />
              ) : (
                <button
                  onClick={() => media.joinVoice(activeChannel.id)}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
                >
                  Entrar na voz
                </button>
              )}
            </div>
          ) : (
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Mensagens
              </h2>
              <div className="min-h-[500px]">
                <ChatPanel channelId={activeChannel.id} />
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Membros
              </h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {members.length}
              </span>
            </div>

            {members.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhum membro encontrado.
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => {
                  const isOnline = onlineUserIds.has(m.id);

                  return (
                    <li
                      key={m.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/60"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            isOnline
                              ? "bg-emerald-500"
                              : "bg-slate-400 dark:bg-slate-500"
                          }`}
                        />
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {m.username}
                        </span>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          isOnline
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </main>

      {media.voiceChannelId && (
        <div className="fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-lg dark:bg-slate-900 dark:text-slate-100">
          <span className="text-sm font-medium">
            🔊 Na voz:{" "}
            {channels.find((c) => c.id === media.voiceChannelId)?.name ??
              "canal"}
          </span>
          <button
            onClick={() =>
              media.cameraOn ? media.stopCamera() : media.shareCamera()
            }
            title={media.cameraOn ? "Desligar câmera" : "Ligar câmera"}
            className={`rounded-xl px-3 py-3 cursor-pointer transition ${
              media.cameraOn
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-gray-600 hover:bg-gray-500"
            }`}
          >
            {media.cameraOn ? (
              <Video className="size-5 text-white" />
            ) : (
              <VideoOff className="size-5 text-white" />
            )}
          </button>
          <button
            onClick={toggleScreenShare}
            title={
              media.sharingScreen
                ? "Parar compartilhamento"
                : "Compartilhar tela"
            }
            className={`rounded-xl px-3 py-3 cursor-pointer transition ${
              media.sharingScreen
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-gray-600 hover:bg-gray-500"
            }`}
          >
            <ScreenShare className="size-5 text-white" />
          </button>
          <button
            onClick={() => media.toggleMute()}
            title={media.muted ? "Ativar microfone" : "Silenciar microfone"}
            className={`rounded-xl px-3 py-3 cursor-pointer transition ${
              media.muted
                ? "bg-red-600 hover:bg-red-500"
                : "bg-gray-600 hover:bg-gray-500"
            }`}
          >
            {media.muted ? (
              <MicOff className="size-5 text-white" />
            ) : (
              <Mic className="size-5 text-white" />
            )}
          </button>

          <button
            onClick={() => media.toggleDeafen()}
            title={media.deafened ? "Ouvir todos" : "Silenciar todos"}
            className={`rounded-xl px-3 py-3 cursor-pointer transition ${
              media.deafened
                ? "bg-red-600 hover:bg-red-500"
                : "bg-gray-600 hover:bg-gray-500"
            }`}
          >
            <Headphones className="size-5 text-white" />
          </button>
          <button
            onClick={() => media.leaveVoice()}
            className="rounded-xl bg-red-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Sair da voz
          </button>
        </div>
      )}

      {screenPickerSources && (
        <ScreenSourcePicker
          sources={screenPickerSources}
          onSelect={(sourceId) => {
            setScreenPickerSources(null);
            media.shareScreen(sourceId);
          }}
          onCancel={() => setScreenPickerSources(null)}
        />
      )}
    </div>
  );
}
