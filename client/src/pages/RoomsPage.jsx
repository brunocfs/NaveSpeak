import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { apiRequest } from "../api/http.js";
import logo from "../assets/nvspk.svg";
export default function RoomsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newRoomName, setNewRoomName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadRooms() {
    setLoading(true);
    try {
      const data = await apiRequest("/rooms");
      setRooms(data.rooms);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  async function handleCreateRoom(e) {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    setBusy(true);
    setError(null);

    try {
      const data = await apiRequest("/rooms", {
        method: "POST",
        body: JSON.stringify({ name: newRoomName.trim() }),
      });

      setNewRoomName("");
      await loadRooms();
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom(e) {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setBusy(true);
    setError(null);

    try {
      const data = await apiRequest("/rooms/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });

      setInviteCode("");
      await loadRooms();
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-10xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="flex items-center text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              <img src={logo} alt="Canal de voz" className="h-15 w-15" />
              <strong>Nave</strong> Speak
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400"></p>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 sm:block dark:bg-slate-800 dark:text-slate-200">
              {user?.username}
            </div>

            <button
              onClick={handleLogout}
              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-950"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-10xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3 lg:px-8">
        <section className="lg:col-span-1">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Seus servidores
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Acesse rapidamente as conversas das quais você participa.
                </p>
              </div>

              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {rooms.length} sala{rooms.length !== 1 ? "s" : ""}
              </span>
            </div>

            {loading && (
              <div className="space-y-3">
                <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              </div>
            )}

            {!loading && rooms.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Você ainda não está em nenhuma sala.
                </p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Crie uma nova sala ou use um código de convite para entrar.
                </p>
              </div>
            )}

            {!loading && rooms.length > 0 && (
              <ul className="space-y-3">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <Link
                      to={`/rooms/${room.id}`}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-blue-300 hover:bg-white hover:shadow-sm dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-blue-500/40 dark:hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-slate-900 dark:text-white">
                          {room.name}
                        </p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Abrir sala
                        </p>
                      </div>

                      <div className="shrink-0 rounded-xl bg-slate-200 px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wider text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        {room.invite_code}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Criar novo servidor
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Defina um nome para começar uma nova conversa.
            </p>

            <form onSubmit={handleCreateRoom} className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Nome do servidor"
                maxLength={64}
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />

              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
              >
                {busy ? "Processando..." : "Criar servidor"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Entrar por convite
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Use um código recebido para entrar em um servidor existente.
            </p>

            <form onSubmit={handleJoinRoom} className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Código de convite"
                maxLength={12}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm uppercase tracking-wide text-slate-900 outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />

              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
              >
                {busy ? "Processando..." : "Entrar por convite"}
              </button>
            </form>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}
        </section>
        <section className="space-y-1 lg:col-span-1">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            Amigos
          </div>
        </section>
      </main>
    </div>
  );
}
