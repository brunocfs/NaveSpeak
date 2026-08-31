import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useCall } from "../context/CallContext.jsx";
import { getSocket } from "../api/socket.js";
import {
  listConversation,
  clearConversation,
  markConversationRead,
} from "../api/dm.js";
import MessageInput from "./MessageInput.jsx";
import StatusDot from "./StatusDot.jsx";
import Avatar from "./Avatar.jsx";

// Conversa privada com um amigo. Mesmo padrão do ChatPanel (histórico via
// REST, envio/recebimento em tempo real via socket) - só troca o canal de
// texto de um servidor pelo par (usuário logado, friend).
export default function DmPanel({ friend }) {
  const { user } = useAuth();
  const media = useMediaSession();
  const { startCall, leaveCall } = useCall();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [callBusy, setCallBusy] = useState(false);
  const [status, setStatus] = useState(friend.status ?? "offline");
  const bottomRef = useRef(null);

  // Sincroniza com o status atual ao trocar de amigo (o objeto `friend` vindo
  // de RoomsPage é um snapshot do momento da seleção - não se atualiza
  // sozinho depois).
  useEffect(() => {
    setStatus(friend.status ?? "offline");
  }, [friend.id, friend.status]);

  // Mesmo evento que FriendsPanel.jsx escuta pra reordenar a lista - aqui só
  // pra manter a bolinha do cabeçalho da conversa em dia enquanto ela fica
  // aberta (online/busy/away/offline - nunca 'invisible', ver
  // onlineStore.getPublicStatus no servidor).
  useEffect(() => {
    const socket = getSocket();

    function handleStatus({ userId, status: next }) {
      if (userId === friend.id) setStatus(next);
    }

    socket.on("presence:status", handleStatus);
    return () => socket.off("presence:status", handleStatus);
  }, [friend.id]);

  // Só uma chamada de voz por vez (mesma trava de RoomPage/MediaSessionContext:
  // entrar em outra sai da anterior) - então "em chamada" aqui é global, não
  // "em chamada COM ESTE amigo": se já há uma chamada ativa com QUALQUER
  // pessoa, o botão vira "Sair da chamada" independente de qual DM está
  // aberta no momento.
  const inAnyCall =
    media.connected && media.voiceChannelId?.startsWith("call:");

  function formatMessageTime(value) {
    return new Date(value).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listConversation(friend.id)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [friend.id]);

  // Abrir a conversa marca as mensagens pendentes daquele amigo como lidas
  // (zera o badge na lista - ver FriendsPanel.jsx, que reage a esse mesmo
  // markConversationRead ao selecionar o amigo). Chamado de novo aqui,
  // independente do clique que abriu, para cobrir também o caso de troca de
  // amigo enquanto o DmPanel já está montado.
  useEffect(() => {
    markConversationRead(friend.id).catch(() => {});
  }, [friend.id]);

  useEffect(() => {
    const socket = getSocket();

    function handleIncoming(message) {
      // Mensagens de QUALQUER conversa do usuário chegam nesta room pessoal
      // (ver dm.handler.js) - só aceita a que pertence à conversa aberta.
      const belongsHere =
        message.sender_id === friend.id || message.recipient_id === friend.id;
      if (!belongsHere) return;
      setMessages((prev) => [...prev, message]);
    }

    socket.on("dm:message", handleIncoming);
    return () => socket.off("dm:message", handleIncoming);
  }, [friend.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(content) {
    const socket = getSocket();
    return new Promise((resolve) => {
      socket.emit("dm:send", { userId: friend.id, content }, (response) => {
        resolve(response ?? { error: "Sem resposta do servidor." });
      });
    });
  }

  async function handleCallClick() {
    if (inAnyCall) {
      await leaveCall();
      return;
    }
    setCallBusy(true);
    setError(null);
    try {
      const res = await startCall(friend);
      if (res?.error) setError(res.error);
    } finally {
      setCallBusy(false);
    }
  }

  async function handleClearHistory() {
    const confirmed = window.confirm(
      `Limpar o histórico da conversa com ${friend.username}? Isso só afeta a sua visualização - ${friend.username} continua vendo as mensagens normalmente.`,
    );
    if (!confirmed) return;

    try {
      await clearConversation(friend.id);
      setMessages([]);
    } catch (err) {
      setError(err.message);
    }
  }
  // <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
  return (
    <div className="flex h-full min-h-[500px] flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-slate-900 dark:text-white">
          <span className="relative inline-flex shrink-0">
            <Avatar avatarPath={friend.avatarPath} username={friend.username} size="sm" />
            <StatusDot
              status={status}
              className="absolute -right-0.5 -bottom-0.5 ring-2 ring-white dark:ring-slate-900"
            />
          </span>
          <span className="truncate">{friend.username}</span>
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleCallClick}
            disabled={callBusy}
            title={
              inAnyCall ? "Sair da chamada" : `Ligar para ${friend.username}`
            }
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
              inAnyCall
                ? "bg-red-600 hover:bg-red-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {inAnyCall ? (
              <PhoneOff className="size-3.5" />
            ) : (
              <Phone className="size-3.5" />
            )}
            {inAnyCall ? "Sair da chamada" : "Ligar"}
          </button>
          <button
            type="button"
            onClick={handleClearHistory}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Limpar histórico
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {loading && <p className="hint">Carregando mensagens...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nenhuma mensagem ainda. Diga oi para {friend.username}!
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="flex items-start gap-3">
            <Avatar
              avatarPath={message.senderAvatarPath}
              username={message.sender_username}
              size="sm"
              className="mt-0.5"
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-semibold ${
                    message.sender_id === user?.id
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {message.sender_username}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatMessageTime(message.created_at)}
                </span>
              </div>
              <p className="break-words text-sm text-slate-700 dark:text-slate-200">
                {message.content}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-4 sm:px-5">
        <MessageInput onSend={handleSend} disabled={loading} />
      </div>
    </div>
  );
}
