import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import { useAuth } from "../context/AuthContext.jsx";
import MessageInput from "./MessageInput.jsx";

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

  useEffect(() => {
    const socket = getSocket();

    function handleIncoming(message) {
      // O conteúdo renderizado abaixo passa só pelo JSX ({message.content}),
      // que o React escapa automaticamente - sem dangerouslySetInnerHTML,
      // então uma mensagem maliciosa não vira HTML/script executável aqui.
      if (message.channel_id !== channelId) return;
      setMessages((prev) => [...prev, message]);
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
          <div
            key={message.id}
            className={message.user_id === user?.id ? "message own" : "message"}
          >
            <div>
              <span className="message-author">{message.username}</span>
              <span
                className={`mt-1 px-1 text-xs
                     "text-right text-slate-500 dark:text-slate-400"
                    
                }`}
              >
                {formatMessageTime(message.created_at)}
              </span>
            </div>
            <span className="message-content">{message.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
