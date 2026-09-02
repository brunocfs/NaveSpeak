import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/http.js";
import { getSocket } from "../api/socket.js";
import { markChannelRead } from "../api/messages.js";
import { useAuth } from "../context/AuthContext.jsx";
import MessageInput from "./MessageInput.jsx";
import MessageContent from "./MessageContent.jsx";
import AttachmentDropZone from "./AttachmentDropZone.jsx";
import Avatar from "./Avatar.jsx";

// Bit ADMINISTRATOR de PERMISSIONS (server/src/utils/permissions.js) -
// espelhado aqui só pra decidir a lista de sugestão de @menção (ver
// canMemberViewChannel abaixo); o servidor SEMPRE reconfere permissão de
// verdade em cada ação, isto aqui nunca é usado pra autorizar nada.
const ADMINISTRATOR_BIT = 1;

function memberPermissionBitmask(member, roles) {
  const permissionsByRoleId = new Map(roles.map((r) => [r.id, r.permissions]));
  return (member.roles ?? []).reduce((mask, r) => mask | (permissionsByRoleId.get(r.id) ?? 0), 0);
}

// Mesma regra de canAccessChannel(action:'view') no servidor - só sugere pra
// @mencionar quem de fato consegue ver este canal (o pedido original: "é
// necessário considerar as permissões do usuário"). Dono do servidor e quem
// tem ADMINISTRATOR sempre veem tudo; canal sem role exigida (viewRoleId
// null) é aberto a todo membro; senão só quem tem a role exigida.
function canMemberViewChannel(member, channel, room, roles) {
  if (room?.created_by === member.id) return true;
  if (memberPermissionBitmask(member, roles) & ADMINISTRATOR_BIT) return true;
  if (!channel?.viewRoleId) return true;
  return (member.roles ?? []).some((r) => r.id === channel.viewRoleId);
}

export default function ChatPanel({ channelId, members = [], channel = null, room = null, roles = [] }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const messageInputRef = useRef(null);
  // Quem pode ser @mencionado neste canal, pra DESTACAR EM NEGRITO uma
  // menção já escrita (MessageContent.jsx) - todo membro do servidor, sem
  // filtro de permissão (é só cosmético: só muda se a palavra "acende" ou
  // não, o servidor nunca usa isto pra autorizar nada).
  const memberUsernames = members.map((m) => m.username);
  // Já a lista de SUGESTÃO (autocomplete ao digitar "@", ver
  // MessageInput.jsx) é filtrada por quem realmente vê este canal.
  const mentionCandidates = members
    .filter((m) => canMemberViewChannel(m, channel, room, roles))
    .map((m) => ({ id: m.id, username: m.username, avatarPath: m.avatarPath }));

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

  async function handleSend(content, attachments) {
    const socket = getSocket();
    return new Promise((resolve) => {
      socket.emit("chat:send", { channelId, content, attachments }, (response) => {
        resolve(response ?? { error: "Sem resposta do servidor." });
      });
    });
  }

  return (
    <AttachmentDropZone
      onFilesDropped={(fileList) => messageInputRef.current?.addDroppedFiles(fileList)}
      disabled={loading}
      className="flex h-full min-h-[500px] flex-col"
    >
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
              <MessageContent
                content={message.content}
                attachments={message.attachments}
                mentionableUsernames={memberUsernames}
              />
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <MessageInput
        ref={messageInputRef}
        onSend={handleSend}
        disabled={loading}
        mentionCandidates={mentionCandidates}
      />
    </AttachmentDropZone>
  );
}
