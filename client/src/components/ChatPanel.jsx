import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import { markChannelRead } from "../api/messages.js";
import { useAuth } from "../context/AuthContext.jsx";
import MessageInput from "./MessageInput.jsx";
import Avatar from "./Avatar.jsx";

export default function ChatPanel({ channelId }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  function formatMessageTime(value) {
    return new Date(value).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest(`/channels/${channelId}/messages`)
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
  }, [channelId]);

  // Canal aberto: zera o cursor de leitura ao entrar - o badge de não lidas
  // (RoomPage.jsx) some para este canal mesmo depois de um F5. Chamado de
  // novo abaixo a cada mensagem nova recebida, com o canal ainda aberto.
  useEffect(() => {
    markChannelRead(channelId).catch(() => {});
  }, [channelId]);

  useEffect(() => {
    const socket = getSocket();

    function handleIncoming(message) {
      // O conteúdo renderizado abaixo passa só pelo JSX ({message.content}),
      // que o React escapa automaticamente - sem dangerouslySetInnerHTML,
      // então uma mensagem maliciosa não vira HTML/script executável aqui.
      if (message.channel_id !== channelId) return;
      setMessages((prev) => [...prev, message]);
      markChannelRead(channelId).catch(() => {});
    }

    socket.on("chat:message", handleIncoming);
    return () => socket.off("chat:message", handleIncoming);
  }, [channelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(content) {
    const socket = getSocket();
    return new Promise((resolve) => {
      socket.emit("chat:send", { channelId, content }, (response) => {
        resolve(response ?? { error: "Sem resposta do servidor." });
      });
    });
  }

  return (
    <div className="flex h-full min-h-[500px] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {loading && <p className="hint">Carregando mensagens...</p>}
        {error && <p className="error-text">{error}</p>}
        {messages.map((message) => (
          <div key={message.id} className="flex items-start gap-3">
            <Avatar
              avatarPath={message.avatarPath}
              username={message.username}
              size="sm"
              className="mt-0.5"
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-semibold ${
                    message.user_id === user?.id
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {message.username}
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
      <MessageInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
