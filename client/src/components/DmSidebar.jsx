import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { getSocket } from "../api/socket.js";
import { isElectron, listScreenSources } from "../api/media.js";
import { listConversations, markConversationRead } from "../api/dm.js";
import StatusDot from "./StatusDot.jsx";
import Avatar from "./Avatar.jsx";
import VoiceControlBar from "./VoiceControlBar.jsx";
import ScreenSourcePicker from "./ScreenSourcePicker.jsx";
import StyledUsername from "./StyledUsername.jsx";

function compareConversations(a, b) {
  const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
  const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
  return bt - at;
}

// Painel lateral esquerdo de RoomsPage.jsx - substitui o antigo
// FriendsPanelOld. Duas abas: "Mensagens" (inbox único de DM - amigo ou não,
// ver GET /api/dm em server/src/routes/dmConversations.routes.js) e
// "Amigos", que só desseleciona a conversa aberta pra deixar o painel
// direito mostrar o FriendsPanel.jsx existente (nada aqui duplica a lista de
// amigos - ver decisão do usuário).
export default function DmSidebar({ selectedFriendId, onSelectFriend }) {
  const { user } = useAuth();
  const ownUserId = user?.id;
  // Chamada de voz é global (MediaSessionProvider em App.jsx) - o
  // VoiceControlBar no rodapé (mic/deafen/status/preferências) precisa
  // continuar visível aqui, mesmo raciocínio de FriendsPanelOld.jsx que este
  // painel substitui.
  const media = useMediaSession();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fontes de tela/janela do Electron pro botão de compartilhar tela do
  // VoiceControlBar - mesma lógica duplicada de propósito em
  // FriendsPanelOld.jsx/RoomPage.jsx (ver comentário lá).
  const [screenPickerSources, setScreenPickerSources] = useState(null);
  const [screenPickerMode, setScreenPickerMode] = useState("share");
  const [screenPickerError, setScreenPickerError] = useState(null);

  // Lido dentro do listener de socket (registrado uma vez) sem recriar a
  // subscrição a cada troca de conversa selecionada - mesmo padrão de
  // FriendsPanelOld.jsx.
  const selectedFriendIdRef = useRef(selectedFriendId);
  useEffect(() => {
    selectedFriendIdRef.current = selectedFriendId;
  }, [selectedFriendId]);

  // "Amigos" ativa quando nenhuma conversa está selecionada - o painel
  // direito de RoomsPage.jsx já decide sozinho o que mostrar a partir disso,
  // esse booleano é só pra destacar a aba certa aqui.
  const friendsActive = !selectedFriendId;

  useEffect(() => {
    setLoading(true);
    listConversations()
      .then((data) => setConversations(data.conversations))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const socket = getSocket();

    function handleStatus({ userId, status }) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === userId ? { ...c, status, online: status !== "offline" } : c,
        ),
      );
    }

    // Mesma lógica de FriendsPanelOld.jsx (lastMessageAt sobe a conversa ao
    // topo, unread só conta pro lado que recebeu e só se a conversa não
    // estiver aberta) - só que aqui o peer pode não ser amigo, então uma
    // mensagem pode chegar de alguém ainda sem linha nesta lista.
    function handleDmMessage(message) {
      const isIncoming = message.recipient_id === ownUserId;
      const peerId = isIncoming ? message.sender_id : message.recipient_id;
      const shouldCountUnread = isIncoming && peerId !== selectedFriendIdRef.current;

      if (isIncoming && peerId === selectedFriendIdRef.current) {
        markConversationRead(peerId).catch(() => {});
      }

      setConversations((prev) => {
        if (prev.some((c) => c.id === peerId)) {
          return prev.map((c) =>
            c.id === peerId
              ? {
                  ...c,
                  lastMessageAt: message.created_at,
                  unreadCount: shouldCountUnread ? (c.unreadCount ?? 0) + 1 : c.unreadCount,
                }
              : c,
          );
        }
        // Conversa nova (primeira mensagem trocada com esse peer nesta
        // sessão) - status/discriminator reais chegam no próximo refetch;
        // "offline" aqui é só o valor inicial até presence:status corrigir.
        return [
          ...prev,
          {
            id: peerId,
            username: isIncoming ? message.sender_username : message.recipient_username,
            avatarPath: isIncoming ? message.senderAvatarPath : undefined,
            isSystem: isIncoming ? Boolean(message.senderIsSystem) : false,
            nameStyle: isIncoming ? message.senderNameStyle : undefined,
            status: "offline",
            online: false,
            lastMessageAt: message.created_at,
            unreadCount: shouldCountUnread ? 1 : 0,
          },
        ];
      });
    }

    socket.on("presence:status", handleStatus);
    socket.on("dm:message", handleDmMessage);
    return () => {
      socket.off("presence:status", handleStatus);
      socket.off("dm:message", handleDmMessage);
    };
  }, [ownUserId]);

  async function openSourcePicker(mode) {
    setScreenPickerMode(mode);
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

  const sorted = useMemo(
    () => [...conversations].sort(compareConversations),
    [conversations],
  );

  function handleSelect(conv) {
    onSelectFriend?.(conv);
    if (conv.unreadCount) {
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)),
      );
    }
    markConversationRead(conv.id).catch(() => {});
  }

  // Clicar em "Mensagens" com a aba Amigos ativa reabre a conversa mais
  // recente, se houver uma - só um atalho, nada acontece se o inbox estiver
  // vazio (fica no FriendsPanel mesmo).
  function handleMessagesTab() {
    if (!friendsActive) return;
    if (sorted[0]) handleSelect(sorted[0]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
        <button
          type="button"
          onClick={handleMessagesTab}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            !friendsActive
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          Mensagens
        </button>
        <button
          type="button"
          onClick={() => onSelectFriend?.(null)}
          title="Em breve terá novas opções"
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            friendsActive
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          Amigos
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error && <p className="error-text px-3 text-sm">{error}</p>}
        {loading && <p className="hint px-3 text-sm">Carregando conversas...</p>}
        {!loading && sorted.length === 0 && (
          <p className="px-3 text-sm text-slate-500 dark:text-slate-400">
            Nenhuma mensagem ainda. Abra uma conversa pela aba Amigos ou pelo
            menu de um usuário num servidor.
          </p>
        )}
        <ul className="space-y-1">
          {sorted.map((conv) => (
            <li key={conv.id}>
              <button
                type="button"
                onClick={() => handleSelect(conv)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition ${
                  selectedFriendId === conv.id
                    ? "bg-slate-900 dark:bg-slate-100"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <span className="relative inline-flex shrink-0">
                  <Avatar avatarPath={conv.avatarPath} username={conv.username} size="sm" />
                  <StatusDot
                    status={conv.status}
                    className="absolute -right-0.5 -bottom-0.5 ring-2 ring-slate-50 dark:ring-slate-900"
                  />
                </span>
                <span
                  className={`flex flex-1 min-w-0 items-center gap-1 truncate text-sm font-medium ${
                    selectedFriendId === conv.id
                      ? "text-white dark:text-slate-900"
                      : "text-slate-800 dark:text-slate-100"
                  }`}
                >
                  <StyledUsername username={conv.username} style={conv.nameStyle} className="truncate" />
                  {conv.isSystem && (
                    <BadgeCheck
                      className="size-3.5 shrink-0 text-sky-500"
                      title="Conta oficial do NaveSpeak"
                    />
                  )}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white dark:bg-blue-500">
                    {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <VoiceControlBar
        toggleScreenShare={toggleScreenShare}
        switchScreenSource={switchScreenSource}
      />

      {screenPickerSources && (
        <ScreenSourcePicker
          sources={screenPickerSources}
          title={
            screenPickerMode === "switch"
              ? "Trocar para qual fonte?"
              : "Escolha o que compartilhar"
          }
          defaultWithAudio={
            screenPickerMode === "switch" ? media.screenAudioEnabled : false
          }
          onSelect={(sourceId, withAudio, quality) => {
            setScreenPickerSources(null);
            if (screenPickerMode === "switch")
              media.switchScreenSource(sourceId, { withAudio, quality });
            else media.shareScreen(sourceId, { withAudio, quality });
          }}
          onCancel={() => setScreenPickerSources(null)}
        />
      )}

      {screenPickerError && (
        <div
          className="fixed bottom-24 left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
          role="alert"
          title="Clique para fechar"
          onClick={() => setScreenPickerError(null)}
        >
          {screenPickerError}
        </div>
      )}
    </div>
  );
}
