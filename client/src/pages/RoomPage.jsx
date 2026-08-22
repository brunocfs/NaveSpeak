import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import ChatPanel from "../components/ChatPanel.jsx";
import VoicePanel from "../components/VoicePanel.jsx";
import ScreenShareView from "../components/ScreenShareView.jsx";
import { useMediasoup } from "../hooks/useMediasoup.js";

export default function RoomPage() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [online, setOnline] = useState([]);
  const [error, setError] = useState(null);

  const media = useMediasoup(roomId);

  useEffect(() => {
    let cancelled = false;

    apiRequest(`/rooms/${roomId}`)
      .then((data) => {
        if (!cancelled) {
          setRoom(data.room);
          setMembers(data.members);
        }
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

    function join() {
      socket.emit("room:join", roomId, (response) => {
        if (response?.error) setError(response.error);
        else if (response?.members) setOnline(response.members);
      });
    }

    function handlePresence(update) {
      if (update.roomId === roomId) setOnline(update.members);
    }

    if (socket.connected) join();
    socket.on("connect", join);
    socket.on("presence:update", handlePresence);

    return () => {
      socket.emit("room:leave", roomId);
      socket.off("connect", join);
      socket.off("presence:update", handlePresence);
    };
  }, [roomId]);

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
                {room?.name ?? "Carregando..."}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Sala de conversa e voz
              </p>
            </div>
          </div>

          <span
            title="Código de convite"
            className="shrink-0 rounded-xl bg-slate-200 px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {room?.invite_code ?? "..."}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-8xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <ScreenShareView media={media} />
        </section>

        <section className="grid gap-6 lg:grid-cols-[330px_minmax(0,1fr)_320px]">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Voz e mídia
              </h2>
            </div>

            <VoicePanel media={media} />
          </div>
          <div className="min-w-0 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Mensagens
              </h2>
            </div>

            <div className="min-h-[500px]">
              <ChatPanel roomId={roomId} />
            </div>
          </div>

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
                    const isOnline = online.some((o) => o.userId === m.id);

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
        </section>
      </main>
    </div>
  );
}
