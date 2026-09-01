import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Bug, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useNotifications } from "../context/NotificationContext.jsx";
import { usePreferences } from "../context/PreferencesContext.jsx";
import { useWhatsNew } from "../hooks/useWhatsNew.js";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import FriendsPanel from "../components/FriendsPanel.jsx";
import DmPanel from "../components/DmPanel.jsx";
import StatusSelector from "../components/StatusSelector.jsx";
import PreferencesModal from "../components/PreferencesModal.jsx";
import WelcomeModal from "../components/WelcomeModal.jsx";
import Avatar from "../components/Avatar.jsx";
import DownloadAppLink from "../components/DownloadAppLink.jsx";
import logo from "../assets/nvspk.svg";
import logoDark from "../assets/nvspk-dark.svg";
export default function RoomsPage() {
  const { user, logout } = useAuth();
  const { setActiveDmPeer } = useNotifications();
  const { theme } = usePreferences();
  const whatsNew = useWhatsNew();
  const [expanded, setExpanded] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Clique numa notificação desktop de DM chega aqui via navigate('/rooms',
  // { state: { openDmWith } }) (ver NotificationContext.jsx) - abre a
  // conversa direto. Roda uma única vez por navegação (limpa o state do
  // history depois, senão voltar pra /rooms de outra forma reabriria a
  // mesma conversa).
  useEffect(() => {
    const target = location.state?.openDmWith;
    if (!target) return;
    setSelectedFriend(target);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  // Mesmo raciocínio de RoomPage/setActiveChannel: reporta qual DM está
  // aberta pro NotificationContext decidir se uma mensagem nova ali deve
  // virar notificação ou ser suprimida.
  useEffect(() => {
    setActiveDmPeer(selectedFriend?.id ?? null);
    return () => setActiveDmPeer(null);
  }, [selectedFriend, setActiveDmPeer]);

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

  // Aviso de "você foi expulso/banido" - chega no state da navegação vinda
  // de RoomPage.jsx (ver o listener 'server:removed' de lá). Mostrado uma
  // vez e descartado do history, mesmo raciocínio de openDmWith acima.
  const [removedNotice, setRemovedNotice] = useState(
    location.state?.removedNotice ?? null,
  );
  useEffect(() => {
    if (!location.state?.removedNotice) return;
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  // Também escuta ao vivo (não só ao navegar de RoomPage.jsx) - cobre o caso
  // de já estar nesta tela quando um admin expulsa/bane em outra aba/sessão.
  useEffect(() => {
    const socket = getSocket();
    function handleRemoved(payload) {
      setRooms((prev) => prev.filter((r) => r.id !== payload.roomId));
      setRemovedNotice(
        payload.reason === "ban"
          ? "Você foi banido de um servidor."
          : "Você foi removido de um servidor.",
      );
    }
    socket.on("server:removed", handleRemoved);
    return () => socket.off("server:removed", handleRemoved);
  }, []);

  // Badge de não lidas por servidor (soma de todos os canais de texto) -
  // igual ao unreadCount de amigo em FriendsPanel.jsx, só que somado por
  // servidor em vez de por remetente. O socket já está nas rooms de todo
  // servidor em que o usuário é membro desde a conexão (ver
  // online.handler.js), então chega aqui mesmo sem a sala estar aberta.
  useEffect(() => {
    const socket = getSocket();
    function handleChatMessage(message) {
      if (message.user_id === user?.id) return;
      setRooms((prev) =>
        prev.map((r) =>
          r.id === message.serverId
            ? { ...r, unreadCount: (r.unreadCount ?? 0) + 1 }
            : r,
        ),
      );
    }
    socket.on("chat:message", handleChatMessage);
    return () => socket.off("chat:message", handleChatMessage);
  }, [user?.id]);

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
    <div className="flex h-screen flex-col overflow-y-auto bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 lg:overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-10xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="flex items-center text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              <img
                src={theme === "dark" ? logoDark : logo}
                alt="Canal de voz"
                className="h-15 w-15"
              />
              <strong>Nave</strong> Speak
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400"></p>
          </div>

          <div className="flex items-center gap-3">
            <DownloadAppLink />

            <Link
              to="/profile"
              className="hidden items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 sm:flex dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Avatar
                avatarPath={user?.avatarPath}
                username={user?.username}
                size="xs"
              />
              {user?.username}
            </Link>

            <StatusSelector />

            <button
              onClick={whatsNew.openManually}
              title="Novidades"
              aria-label="Novidades"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Sparkles className="h-5 w-5" />
            </button>

            <Link
              to="/reports"
              title="Reportar bug ou sugestão"
              aria-label="Reportar bug ou sugestão"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Bug className="h-5 w-5" />
            </Link>

            {/* Painel de convites - só admin da aplicação (users.is_admin,
                sem bootstrap automático, ver database/schema-postgre.sql)
                vê este ícone. A rota /admin/invites também é protegida no
                servidor (403 pra quem não é admin) e no client
                (ProtectedRoute requireAdmin) - isto aqui é só não oferecer o
                atalho a quem não pode usá-lo. */}
            {user?.isAdmin && (
              <Link
                to="/admin/invites"
                title="Convites"
                aria-label="Convites"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ShieldCheck className="h-5 w-5" />
              </Link>
            )}

            <PreferencesModal />

            <button
              onClick={handleLogout}
              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-950"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="grid max-w-10xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[400px_minmax(0,1fr)] lg:px-8 lg:min-h-0 lg:overflow-hidden">
        <section className="lg:flex lg:min-h-0 lg:flex-col">
          {removedNotice && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              {removedNotice}
              <button
                onClick={() => setRemovedNotice(null)}
                className="shrink-0 font-semibold hover:underline"
              >
                Ok
              </button>
            </div>
          )}
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 overflow-hidden transition-all duration-300 mb-5">
            {/* Cabeçalho clicável - sempre visível */}
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between p-6 text-left"
              aria-expanded={expanded}
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {expanded
                    ? "Criar / Entrar em um servidor"
                    : "Criar / Entrar em um servidor"}
                </h2>
                {!expanded && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Clique para expandir
                  </p>
                )}
              </div>

              {/* Ícone de seta que rotaciona */}
              <svg
                className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 ${
                  expanded ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Conteúdo expansível */}
            <div
              className={`grid transition-all duration-300 ease-in-out ${
                expanded
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="px-6 pb-6 space-y-6">
                  {/* Criar novo servidor */}
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      Criar novo servidor
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Defina um nome para começar uma nova conversa.
                    </p>

                    <form
                      onSubmit={handleCreateRoom}
                      className="mt-4 space-y-3"
                    >
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

                  {/* Entrar por convite */}
                  <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      Entrar por convite
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Use um código recebido para entrar em um servidor
                      existente.
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
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
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

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="relative inline-flex shrink-0">
                            <Avatar
                              avatarPath={room.icon_path}
                              username={room.name}
                              size="md"
                            />
                            {room.unreadCount > 0 && (
                              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white ring-2 ring-slate-50 dark:bg-blue-500 dark:ring-slate-800/60">
                                {room.unreadCount > 99
                                  ? "99+"
                                  : room.unreadCount}
                              </span>
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-slate-900 dark:text-white">
                              {room.name}
                            </p>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                              Abrir sala
                            </p>
                          </div>
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
          </div>
        </section>
        <section className="space-y-1 lg:flex lg:min-h-0 lg:flex-col">
          <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)] rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 lg:min-h-0 lg:flex-1">
            <FriendsPanel
              selectedFriendId={selectedFriend?.id}
              onSelectFriend={setSelectedFriend}
            />
            {/* <div className="min-h-[500px] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 lg:h-full lg:min-h-0"> */}
            <div className="min-h-[500px] overflow-hidden  border-l border-slate-200  dark:bg-slate-900 dark:ring-slate-800 lg:h-full lg:min-h-0">
              {selectedFriend ? (
                <DmPanel friend={selectedFriend} />
              ) : (
                <div className="flex h-full min-h-[500px] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Selecione um amigo para abrir uma conversa privada.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <WelcomeModal open={whatsNew.open} version={whatsNew.version} onClose={whatsNew.close} />
    </div>
  );
}
