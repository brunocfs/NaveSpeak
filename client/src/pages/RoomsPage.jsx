import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import DmSidebar from "../components/DmSidebar.jsx";
import FriendsPanel from "../components/FriendsPanel.jsx";
import DmPanel from "../components/DmPanel.jsx";
import BugReportPanel from "../components/BugReportPanel.jsx";
import TurboPanel from "../components/TurboPanel.jsx";
import CipherPanel from "../components/CipherPanel.jsx";
import AdminPanel from "../components/AdminPanel.jsx";
import { InvitesPanel } from "./AdminInvitesPage.jsx";
import NavespeakLogoV1 from "../components/NavespeakLogoV1.jsx";
import DownloadAppLink from "../components/DownloadAppLink.jsx";
import Avatar from "../components/Avatar.jsx";
import CreateOrJoinServerModal from "../components/CreateOrJoinServerModal.jsx";

import { useAuth } from "../context/AuthContext.jsx";
import { useNotifications } from "../context/NotificationContext.jsx";
import { useWhatsNew } from "../hooks/useWhatsNew.js";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import { ArrowLeft, Plus } from "lucide-react";
import RoomPage from "./RoomPage.jsx";
export default function RoomsPage() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();
  const [selectedFriend, setSelectedFriend] = useState(null);
  // Painel fixo aberto ao lado do DmSidebar ("bugs" | "turbo" | "cipher" | "invites" |
  // "admin") - null = Amigos ou conversa (selectedFriend).
  const [panel, setPanel] = useState(null);
  const { setActiveDmPeer } = useNotifications();
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [roomPanel, setRoomPanel] = useState(false);
  const [addServerOpen, setAddServerOpen] = useState(false);
  // Celular (abaixo de `md`): DmSidebar e painel da direita viram telas
  // separadas - true = painel aberto por cima de tudo, com botão voltar.
  const [mobileContentOpen, setMobileContentOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Espelha selectedRoomId/roomPanel em ref pro listener de socket (efeito
  // roda uma vez, closure senão ficaria presa nos valores da primeira
  // renderização) saber, a cada mensagem, se o servidor já está aberto.
  const openRoomRef = useRef({ id: null, open: false });
  useEffect(() => {
    openRoomRef.current = { id: selectedRoomId, open: roomPanel };
  }, [selectedRoomId, roomPanel]);
  function selectFriend(friend) {
    setSelectedFriend(friend);
    setPanel(null);
    setMobileContentOpen(true);
  }
  function selectPanel(next) {
    setPanel(next);
    setSelectedFriend(null);
    setMobileContentOpen(true);
  }
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
    const target = location.state?.openDmWith;
    if (!target) return;
    setRoomPanel(false);
    selectFriend(target);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);
  // /rooms/:roomId (notificação, duplo clique no PiP, convite, servidor
  // criado) abre o servidor aqui dentro. location.key em vez de só roomId:
  // navegar de novo pra mesma URL (ex.: usuário trocou de servidor pela
  // faixa, que não mexe na URL) também precisa reabrir.
  const { roomId: routeRoomId } = useParams();
  useEffect(() => {
    if (routeRoomId) handleSelectServer(routeRoomId);
  }, [routeRoomId, location.key]);
  useEffect(() => {
    loadRooms();
  }, []);
  // Badge de não lidas por servidor no rail de ícones - soma mensagens de
  // qualquer canal do servidor (mesmo raciocínio de unreadCount em
  // DmSidebar.jsx), pulando o servidor que já está aberto no painel ao lado
  // (RoomPage cuida de marcar como lido ali dentro).
  useEffect(() => {
    const socket = getSocket();
    function handleChatMessage(message) {
      if (message.user_id === user?.id) return;
      const { id: openId, open } = openRoomRef.current;
      if (open && message.serverId === openId) return;
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
  useEffect(() => {
    setActiveDmPeer(selectedFriend?.id ?? null);
    return () => setActiveDmPeer(null);
  }, [selectedFriend, setActiveDmPeer]);

  function handleSelectServer(roomId) {
    setSelectedRoomId(roomId);
    setRoomPanel(true);
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)),
    );
  }

  async function handleServerAdded(room) {
    await loadRooms();
    navigate(`/rooms/${room.id}`);
  }
  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-slate-100 text-slate-900 transition-colors dark:bg-[#0f1117] dark:text-slate-100 lg:overflow-hidden ">
      {error && (
        <div className="m-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="mx-auto w-full ">
        <main className="flex max-w-10xl flex-1 lg:min-h-0 lg:overflow-hidden bg-slate-100 dark:bg-[#0f1117]">
          <section className="">
            <div className="flex flex-col p-2 gap-3 bg-slate-200 dark:bg-[#0b0c10] max-w-20 h-screen items-center">
              <div className="rounded-xl bg-[#1c1831] mb-5 mt-3 ">
                <button
                  onClick={() => {
                    setRoomPanel(null);
                  }}
                  className="cursor-pointer"
                >
                  {/* Fundo do botão é sempre escuro (#1c1831), então a logo
                      fica clara nos dois temas. */}
                  <NavespeakLogoV1
                    title="Canal de voz"
                    className="h-14.5 w-14.5 text-slate-100"
                  />
                </button>
              </div>
              {loading && (
                <div className=" flex flex-col  gap-3">
                  <div className="h-14 w-14 animate-pulse rounded-full bg-slate-300 dark:bg-slate-800" />
                  <div className="h-14 w-14 animate-pulse rounded-full bg-slate-300 dark:bg-slate-800" />
                  <div className="h-14 w-14 animate-pulse rounded-full bg-slate-300 dark:bg-slate-800" />
                </div>
              )}
              {!loading && rooms.length > 0 && (
                <div
                  className="flex flex-col overflow-y-auto [&::-webkit-scrollbar]:hidden 
                      [-ms-overflow-style:'none'] 
                      [scrollbar-width:none] gap-3 p-1"
                >
                  {rooms.map((room) => {
                    const isActive = room.id === selectedRoomId;

                    return (
                      <button
                        key={room.id}
                        onClick={() => handleSelectServer(room.id)}
                        className={`cursor-pointer 
                        }`}
                      >
                        <span className="relative inline-flex">
                          <Avatar
                            avatarPath={room.icon_path}
                            username={room.name}
                            size={`lg`}
                            className={`${isActive ? "ring-2 ring-purple-500" : ""}`}
                          />
                          {room.unreadCount > 0 && (
                            <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-purple-600 px-1.5 text-[11px] font-semibold text-white ring-2 ring-slate-200 dark:bg-purple-500 dark:ring-[#0b0c10]">
                              {room.unreadCount > 9 ? "99+" : room.unreadCount}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setAddServerOpen(true)}
                title="Criar ou entrar em um servidor"
                aria-label="Criar ou entrar em um servidor"
                className="cursor-pointer inline-flex items-center justify-center rounded-xl border-2 border-dashed border-purple-400 bg-white text-purple-600 transition hover:bg-purple-50 dark:border-purple-400 dark:bg-[#191a1e] dark:text-purple-200 min-w-10 min-h-10 dark:hover:bg-slate-800"
              >
                <Plus className="size-5" />
              </button>{" "}
            </div>
          </section>
          {roomPanel ? (
            <section className="w-full h-screen bg-white dark:bg-[#0f1117]">
              <RoomPage roomId={selectedRoomId}></RoomPage>
            </section>
          ) : (
            <section className="w-full h-screen bg-white dark:bg-[#0f1117]">
              <div className="grid h-screen md:grid-cols-[300px_minmax(0,1fr)] shadow-sm ">
                <DmSidebar
                  selectedFriendId={selectedFriend?.id}
                  panel={panel}
                  onSelectFriend={selectFriend}
                  onSelectPanel={selectPanel}
                />
                <div
                  className={`w-full h-full overflow-y-auto bg-white dark:bg-[#161820] ${
                    mobileContentOpen
                      ? "max-md:fixed max-md:inset-0 max-md:z-40 max-md:flex max-md:flex-col"
                      : "max-md:hidden"
                  }`}
                >
                  <div className="shrink-0 border-b border-slate-200 p-2 md:hidden dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setMobileContentOpen(false)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <ArrowLeft className="size-5" /> Voltar
                    </button>
                  </div>
                  <div className="h-full max-md:h-auto max-md:min-h-0 max-md:flex-1">
                  {selectedFriend ? (
                    <DmPanel friend={selectedFriend} />
                  ) : panel === "bugs" ? (
                    <BugReportPanel />
                  ) : panel === "turbo" ? (
                    <TurboPanel />
                  ) : panel === "cipher" ? (
                    <CipherPanel />
                  ) : panel === "invites" ? (
                    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
                      <InvitesPanel />
                    </div>
                  ) : panel === "admin" ? (
                    <AdminPanel />
                  ) : (
                    <FriendsPanel
                      selectedFriendId={selectedFriend?.id}
                      onSelectFriend={selectFriend}
                    />
                    // <div className="flex h-full min-h-[500px] items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    //   Selecione um amigo para abrir uma conversa privada.
                    // </div>
                  )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
        <CreateOrJoinServerModal
          open={addServerOpen}
          onClose={() => setAddServerOpen(false)}
          onSuccess={handleServerAdded}
        />
      </div>
    </div>
  );
}
