import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/http.js';
import { getSocket } from '../api/socket.js';
import { useAuth } from '../context/AuthContext.jsx';
import MessageInput from './MessageInput.jsx';

export default function ChatPanel({ roomId }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest(`/rooms/${roomId}/messages`)
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
  }, [roomId]);

  useEffect(() => {
    const socket = getSocket();

    function handleIncoming(message) {
      // O conteúdo renderizado abaixo passa só pelo JSX ({message.content}),
      // que o React escapa automaticamente - sem dangerouslySetInnerHTML,
      // então uma mensagem maliciosa não vira HTML/script executável aqui.
      if (message.room_id !== roomId) return;
      setMessages((prev) => [...prev, message]);
    }

    socket.on('chat:message', handleIncoming);
    return () => socket.off('chat:message', handleIncoming);
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(content) {
    const socket = getSocket();
    return new Promise((resolve) => {
      socket.emit('chat:send', { roomId, content }, (response) => {
        resolve(response ?? { error: 'Sem resposta do servidor.' });
      });
    });
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {loading && <p className="hint">Carregando mensagens...</p>}
        {error && <p className="error-text">{error}</p>}
        {messages.map((message) => (
          <div key={message.id} className={message.user_id === user?.id ? 'message own' : 'message'}>
            <span className="message-author">{message.username}</span>
            <span className="message-content">{message.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
