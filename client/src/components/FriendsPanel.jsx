import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { getSocket } from "../api/socket.js";
import { clearConversation, markConversationRead } from "../api/dm.js";
import { isElectron, listScreenSources } from "../api/media.js";
import StatusDot from "./StatusDot.jsx";
import Avatar from "./Avatar.jsx";
import { Search, EllipsisVertical } from "lucide-react";
import VoiceControlBar from "./VoiceControlBar.jsx";
import ScreenSourcePicker from "./ScreenSourcePicker.jsx";
import {
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  blockUser,
} from "../api/friends.js";

// Amigos offline aparecem na lista igual aos online - só a ORDEM muda:
// online primeiro; dentro de cada grupo, conversa mais recente primeiro;
// quem nunca trocou mensagem cai no fim do grupo (por data da amizade).
// Mesmo critério do backend (GET /api/friends, ver friends.routes.js) -
// replicado aqui pra reordenar ao vivo sem precisar de refetch a cada
// online/offline ou mensagem nova.
function compareFriends(a, b) {
  if (a.online !== b.online) return a.online ? -1 : 1;
  const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
  const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
  if (at !== bt) return bt - at;
  return new Date(b.since).getTime() - new Date(a.since).getTime();
}

// Card único de amigos da tela inicial (mesmo estilo colapsável do card
// "Criar / Entrar em um servidor" de RoomsPage.jsx): "Adicionar amigo" abre/
// fecha por clique no cabeçalho; solicitações e a lista de amigos (com
// indicador online/offline, badge de não lidas e o menu ⋮ de remover/
// bloquear/limpar histórico) ficam sempre visíveis abaixo, no mesmo card.
export default function FriendsPanel({ selectedFriendId, onSelectFriend }) {
  const { user } = useAuth();
  const ownUserId = user?.id;
  // Chamada de voz é global (MediaSessionProvider em App.jsx) - continua
  // ativa mesmo navegando pra fora de uma sala, então o VoiceControlBar
  // abaixo da lista de amigos precisa ler o mesmo estado de mídia.
  const media = useMediaSession();

  const [addExpanded, setAddExpanded] = useState(false);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [usernameInput, setUsernameInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  // Fontes de tela/janela do Electron pro botão de compartilhar tela do
  // VoiceControlBar - mesma lógica (duplicada de propósito, ver comentário
  // equivalente em RoomPage.jsx/VoiceStatusBar.jsx) de listar fontes e abrir
  // o <ScreenSourcePicker> modal; fora do Electron, getDisplayMedia já
  // mostra o seletor nativo do navegador e isso nunca é usado.
  const [screenPickerSources, setScreenPickerSources] = useState(null);
  const [screenPickerMode, setScreenPickerMode] = useState("share");
  const [screenPickerError, setScreenPickerError] = useState(null);

  // Lido dentro do listener de socket (registrado uma vez, ver efeito
  // abaixo) sem recriar a subscrição a cada troca de amigo selecionado.
  const selectedFriendIdRef = useRef(selectedFriendId);
  useEffect(() => {
    selectedFriendIdRef.current = selectedFriendId;
  }, [selectedFriendId]);

  async function loadFriends() {
    try {
      const data = await listFriends();
      setFriends(data.friends);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadRequests() {
    try {
      const data = await listFriendRequests();
      setIncoming(data.incoming);
      setOutgoing(data.outgoing);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadFriends(), loadRequests()]).finally(() =>
      setLoading(false),
    );
  }, []);

  // Eventos empurrados pelo servidor (friends.routes.js / online.handler.js)
  // pela room pessoal user:<publicId> - solicitação/aceite/remoção são raros
  // o bastante para valer recarregar as duas listas inteiras (mais simples e
  // menos sujeito a bug do que remendar o array item a item); online/offline
  // e mensagem nova acontecem com mais frequência, então são tratados
  // localmente sem refetch.
  useEffect(() => {
    const socket = getSocket();

    // Status de presença (online/busy/away/offline - nunca 'invisible', ver
    // onlineStore.getPublicStatus no servidor) de QUALQUER amigo, emitido
    // pra room pessoal user:<publicId> - inclui conexão/desconexão, troca
    // manual pelo seletor (StatusSelector.jsx) e o "Ausente" automático por
    // inatividade.
    function handleFriendStatus({ userId, status }) {
      setFriends((prev) =>
        prev.map((f) =>
          f.id === userId ? { ...f, status, online: status !== "offline" } : f,
        ),
      );
    }
    function refetchAll() {
      loadFriends();
      loadRequests();
    }

    // Toda mensagem (enviada OU recebida) atualiza lastMessageAt do amigo -
    // é o que faz a conversa mais recente subir ao topo na hora, dos dois
    // lados. Unread é à parte, e só se aplica ao lado que RECEBEU: se a
    // conversa daquele remetente já está aberta (selectedFriendIdRef), a
    // mensagem já está visível no DmPanel - em vez de contar, avança o
    // cursor de leitura no servidor (markConversationRead) para o badge
    // continuar em zero mesmo depois de um F5.
    function handleDmMessage(message) {
      const isIncoming = message.recipient_id === ownUserId;
      const peerId = isIncoming ? message.sender_id : message.recipient_id;

      if (isIncoming && peerId === selectedFriendIdRef.current) {
        markConversationRead(peerId).catch(() => {});
      }

      setFriends((prev) =>
        prev.map((f) => {
          if (f.id !== peerId) return f;
          const shouldCountUnread =
            isIncoming && peerId !== selectedFriendIdRef.current;
          return {
            ...f,
            lastMessageAt: message.created_at,
            unreadCount: shouldCountUnread
              ? (f.unreadCount ?? 0) + 1
              : f.unreadCount,
          };
        }),
      );
    }

    socket.on("presence:status", handleFriendStatus);
    socket.on("friend:request", refetchAll);
    socket.on("friend:accepted", refetchAll);
    socket.on("friend:removed", refetchAll);
    socket.on("friend:request_closed", refetchAll);
    socket.on("dm:message", handleDmMessage);
    return () => {
      socket.off("presence:status", handleFriendStatus);
      socket.off("friend:request", refetchAll);
      socket.off("friend:accepted", refetchAll);
      socket.off("friend:removed", refetchAll);
      socket.off("friend:request_closed", refetchAll);
      socket.off("dm:message", handleDmMessage);
    };
  }, [ownUserId]);

  // Reordena a cada mudança em `friends` (online/offline, nova mensagem) -
  // deriva do estado em vez de manter `friends` já ordenado, pra nenhum
  // ponto de mutação (setFriends espalhado acima) precisar lembrar de
  // reordenar sozinho.
  const sortedFriends = useMemo(
    () => [...friends].sort(compareFriends),
    [friends],
  );

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target))
        setOpenMenuId(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function openSourcePicker(mode) {
    setScreenPickerMode(mode);
    // Fora do Electron não existe lista de fontes pra buscar (o seletor de
    // janela é o NATIVO do getDisplayMedia, só aparece ao confirmar) - o
    // picker abre mesmo assim, só pra escolher qualidade (resolução/fps).
    if (!isElectron()) {
      setScreenPickerSources([]);
      return;
    }
    try {
      const sources = await listScreenSources();
      setScreenPickerSources(sources ?? []);
    } catch (err) {
      console.error("[screen-share] Falha ao listar fontes de tela:", err);
      setScreenPickerError(
        err.message ?? "Não foi possível listar as telas/janelas disponíveis.",
      );
    }
  }
  function toggleScreenShare() {
    if (media.sharingScreen) {
      media.stopScreenShare();
      return;
    }
    openSourcePicker("share");
  }
  function switchScreenSource() {
    openSourcePicker("switch");
  }

  async function handleAddFriend(e) {
    e.preventDefault();
    const tag = usernameInput.trim();
    if (!tag) return;

    setBusy(true);
    setError(null);
    try {
      await sendFriendRequest(tag);
      setUsernameInput("");
      await loadRequests();
      await loadFriends();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(requestId) {
    setError(null);
    try {
      await acceptFriendRequest(requestId);
      await loadRequests();
      await loadFriends();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDecline(requestId) {
    setError(null);
    try {
      await declineFriendRequest(requestId);
      await loadRequests();
    } catch (err) {
      setError(err.message);
    }
  }

  // Abrir a conversa (clique na linha ou "Abrir conversa" no menu ⋮): zera o
  // badge local na hora e sincroniza o cursor de leitura no servidor -
  // mensagens pendentes daquele amigo viram lidas.
  function handleSelectFriend(friend) {
    onSelectFriend?.(friend);
    if (friend.unreadCount) {
      setFriends((prev) =>
        prev.map((f) => (f.id === friend.id ? { ...f, unreadCount: 0 } : f)),
      );
    }
    markConversationRead(friend.id).catch(() => {});
  }

  async function handleRemoveFriend(friend) {
    setOpenMenuId(null);
    const confirmed = window.confirm(
      `Remover ${friend.username} da sua lista de amigos?`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      await removeFriend(friend.id);
      if (selectedFriendId === friend.id) onSelectFriend?.(null);
      await loadFriends();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleBlockFriend(friend) {
    setOpenMenuId(null);
    const confirmed = window.confirm(
      `Bloquear ${friend.username}? Isso desfaz a amizade e impede novas mensagens dos dois lados.`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      await blockUser(friend.tag);
      if (selectedFriendId === friend.id) onSelectFriend?.(null);
      await loadFriends();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClearHistory(friend) {
    setOpenMenuId(null);
    const confirmed = window.confirm(
      `Limpar o histórico da conversa com ${friend.username}? Isso só afeta a sua visualização.`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      await clearConversation(friend.id);
    } catch (err) {
      setError(err.message);
    }
  }
  //   <div className="flex h-full min-h-0 flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 overflow-hidden transition-all duration-300">
  return (
    <div className="flex p-5 h-full min-h-0 flex-col transition-all duration-300 gap-3">
      <div className="flex items-center justify-between">
        <div class="flex">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Amigos - {friends.length}
          </h2>
          {incoming.length > 0 && (
            <>
              <button
                onClick={() => setAddExpanded((prev) => !prev)}
                className="cursor-pointer mx-5 text-1xl text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-yellow-500"
              >
                Nova solicitação de amizade - {incoming.length}
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => setAddExpanded((prev) => !prev)}
          className="cursor-pointer bg-purple-600 dark:bg-purple-800 text-white rounded-xl p-2"
        >
          Adicionar Amigo
        </button>
      </div>
      {addExpanded && (
        <div
          onSubmit={handleAddFriend}
          className="flex flex-col rounded-xl p-5  transition-all gap-3 dark:bg-slate-950 "
        >
          <span>
            Você pode adicionar outros "navegadores" na sua lista de amigos.
          </span>
          <form className="flex flex-col gap-3 m-2">
            <input
              className="w-full outline-none "
              maxLength={38}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="Insira o código do tribulante {usuario#12345}"
            ></input>

            <button
              type="submit"
              disabled={busy || !usernameInput.trim()}
              className="cursor-pointer bg-purple-600 dark:bg-purple-800 text-white rounded-xl p-2"
            >
              {busy ? "Enviando..." : "Enviar solicitação"}
            </button>
          </form>
          {incoming.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Solicitações recebidas
              </p>
              <ul className="space-y-2">
                {incoming.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {r.username}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => handleDecline(r.id)}
                        className=" cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        Recusar
                      </button>
                      <button
                        onClick={() => handleAccept(r.id)}
                        className="cursor-pointer rounded-lg bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-purple-700"
                      >
                        Aceitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outgoing.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Solicitações enviadas
              </p>
              <ul className="space-y-2">
                {outgoing.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {r.username}
                    </span>
                    <button
                      onClick={() => handleDecline(r.id)}
                      className="cursor-pointer shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      Cancelar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {!addExpanded && (
        <>
          <div className="flex  rounded-xl p-3 gap-2 dark:bg-slate-950">
            <Search />
            <input
              className="w-full outline-none  "
              placeholder="Buscar"
            ></input>
          </div>
          <ul>
            {sortedFriends.map((friend) => (
              <li key={friend.id} className="relative">
                <div class="flex w-full p-3 gap-2 items-center hover:bg-slate-100 border-t-1 rounded-xl dark:border-slate-800 border-slate-100  dark:hover:bg-slate-800 ">
                  <button
                    type="button"
                    onClick={() => handleSelectFriend(friend)}
                    className="cursor-pointer flex min-w-0 flex-1 items-center gap-2 text-left "
                  >
                    <div className="flex w-full  gap-2 items-center">
                      <span className="relative inline-flex shrink-0">
                        <Avatar
                          avatarPath={friend.avatarPath}
                          username={friend.username}
                          size="sm"
                        />
                        <StatusDot
                          status={friend.status}
                          className="absolute -right-0.5 -bottom-0.5 ring-2 ring-slate-50 dark:ring-slate-900"
                        />
                      </span>
                      <span
                        className={`truncate text-sm font-medium ${
                          selectedFriendId === friend.id
                            ? "text-white dark:text-slate-900"
                            : "text-slate-800 dark:text-slate-100"
                        }`}
                      >
                        {friend.username}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMenuId((prev) =>
                        prev === friend.id ? null : friend.id,
                      )
                    }
                    aria-label={`Mais opções para ${friend.username}`}
                    className={`cursor-pointer shrink-0 rounded-lg px-2 mr-3 py-1 text-sm transition dark:bg-slate-900 ${
                      selectedFriendId === friend.id
                        ? "text-white/80  dark:text-slate-900/70  "
                        : "text-slate-500  dark:text-slate-400 "
                    }`}
                  >
                    ⋮
                  </button>
                </div>
                {openMenuId === friend.id && (
                  <div
                    ref={menuRef}
                    className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
                  >
                    <button
                      onClick={() => {
                        handleSelectFriend(friend);
                        setOpenMenuId(null);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Abrir conversa
                    </button>
                    <button
                      onClick={() => handleClearHistory(friend)}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Limpar histórico
                    </button>
                    <button
                      onClick={() => handleRemoveFriend(friend)}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Remover amigo
                    </button>
                    <button
                      onClick={() => handleBlockFriend(friend)}
                      className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      Bloquear
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
