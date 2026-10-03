import { isRoomMember, findRoomById } from "../db/rooms.repo.js";
import { findChannelById } from "../db/channels.repo.js";
import { createMessage } from "../db/messages.repo.js";
import { redis } from "../config/redis.js";
import { listRoleIdsForUser, getUserPermissionBitmask } from "../db/roles.repo.js";
import { canAccessChannel } from "../utils/permissions.js";
import {
  channelIdParamSchema,
  messageContentSchema,
  attachmentsArraySchema,
} from "../validation/schemas.js";
import { getTurboState } from "../db/users.repo.js";
import { TURBO_LIMITS, messageTooLong } from "../utils/turbo.js";
import { resolveAttachments } from "../utils/resolveAttachments.js";
import { logSocketRateLimited } from "../observability/sockets.js";
import { logError } from "../observability/errors.js";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 15;

// Contenção de flood por socket, compartilhada no Redis (funciona igual em
// várias instâncias). Contador com janela deslizante simples: INCR + EXPIRE
// no primeiro hit. Fail-open: se o Redis falhar, deixa passar (não trava o chat).
async function isRateLimited(socket) {
  const key = `ratelimit:socket:${socket.id}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
    return count > RATE_LIMIT_MAX_MESSAGES;
  } catch {
    return false;
  }
}

// Checa uma ou mais ações (view/send) de canal pro usuário, lendo room,
// bitmask e roles do banco. Membership do servidor fica a cargo de quem chama.
export async function canUserAccessChannel(channel, user, ...actions) {
  const [room, bitmask, roleIds] = await Promise.all([
    findRoomById(channel.server_id),
    getUserPermissionBitmask(channel.server_id, user.internalId),
    listRoleIdsForUser(channel.server_id, user.internalId),
  ]);
  return actions.every((action) => canAccessChannel({ channel, room, user, bitmask, roleIds, action }));
}

// Quem recebe chat:message. Canal sem role de visualização: room do canal +
// room do servidor (todo membro pode ver). Canal restrito: só os sockets
// (dessas duas rooms) de quem tem `view` - antes a room do servidor recebia
// o conteúdo inteiro, então membro sem acesso lia o canal em tempo real.
// Devolve uma lista de rooms/socket ids; vazia = ninguém.
// ponytail: 2 queries por membro conectado a cada mensagem em canal restrito;
// cachear as permissões por usuário se servidores grandes pesarem.
async function messageRecipients(io, channel) {
  if (!channel.viewRoleId) return [channel.id, channel.server_id];
  const sockets = await io.in([channel.id, channel.server_id]).fetchSockets();
  const accessByUser = new Map();
  const ids = [];
  for (const s of sockets) {
    const member = s.data.user;
    if (!member) continue;
    if (!accessByUser.has(member.internalId)) {
      accessByUser.set(member.internalId, canUserAccessChannel(channel, member, "view"));
    }
    if (await accessByUser.get(member.internalId)) ids.push(s.id);
  }
  return ids;
}

export function registerChatHandlers(io, socket) {
  const user = socket.data.user;

  // Indicador de "está digitando" por canal - sem rate limit e sem gravar
  // nada no banco (evento efêmero, puro repasse). `socket.to()` (não `io.to`)
  // já exclui quem emitiu, então nenhuma outra aba do próprio remetente
  // recebe seu próprio "digitando" por aqui - mas confere membership igual
  // chat:send, senão qualquer socket autenticado poderia forjar "fulano está
  // digitando" num canal de servidor que nem é membro.
  socket.on("chat:typing", async (payload) => {
    const channelIdResult = channelIdParamSchema.safeParse(payload?.channelId);
    if (!channelIdResult.success) return;
    const channelId = channelIdResult.data;
    const typing = Boolean(payload?.typing);

    const channel = await findChannelById(channelId);
    if (!channel || channel.type !== "text") return;
    const member = await isRoomMember(channel.server_id, user.internalId);
    if (!member) return;
    if (!(await canUserAccessChannel(channel, user, "view"))) return;

    socket.to(channelId).emit("chat:typing", {
      channelId,
      userId: user.id,
      username: user.username,
      typing,
    });
  });

  socket.on("chat:send", async (payload, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};

    if (await isRateLimited(socket)) {
      logSocketRateLimited("chat_message");
      return ack({
        error: "Você está enviando mensagens rápido demais. Aguarde um pouco.",
      });
    }

    const channelIdResult = channelIdParamSchema.safeParse(payload?.channelId);
    if (!channelIdResult.success) return ack({ error: "ID de canal inválido." });

    const attachmentsResult = attachmentsArraySchema.safeParse(payload?.attachments ?? []);
    if (!attachmentsResult.success) {
      return ack({ error: attachmentsResult.error.issues[0]?.message ?? "Anexo inválido." });
    }
    const hasAttachments = attachmentsResult.data.length > 0;

    // Conteúdo é opcional SE houver ao menos um anexo (mensagem só com
    // arquivo, sem texto) - senão continua obrigatório, mesma regra de
    // sempre.
    const rawContent = typeof payload?.content === "string" ? payload.content : "";
    let content = "";
    if (rawContent.trim().length > 0) {
      const contentResult = messageContentSchema.safeParse(rawContent);
      if (!contentResult.success) {
        return ack({
          error: contentResult.error.issues[0]?.message ?? "Mensagem inválida.",
        });
      }
      content = contentResult.data;
      // Só consulta o plano quando passa do limite grátis.
      if (content.length > TURBO_LIMITS.messageMaxChars) {
        const tooLong = messageTooLong(content, (await getTurboState(user.internalId))?.limits ?? TURBO_LIMITS);
        if (tooLong) return ack(tooLong);
      }
    } else if (!hasAttachments) {
      return ack({ error: "Mensagem vazia." });
    }

    const channelId = channelIdResult.data;

    // O canal precisa existir, ser do tipo 'text' e o usuário precisa ser
    // membro do servidor dono do canal - tudo checado no banco a cada envio.
    const channel = await findChannelById(channelId);
    if (!channel) return ack({ error: "Canal não encontrado." });
    if (channel.type !== "text") {
      return ack({ error: "Este canal não aceita mensagens." });
    }
    const member = await isRoomMember(channel.server_id, user.internalId);
    if (!member) return ack({ error: "Você não é membro desse servidor." });

    const canSend = await canUserAccessChannel(channel, user, "view", "send");
    if (!canSend) return ack({ error: "Você não tem permissão para enviar mensagens neste canal." });

    let attachments = [];
    if (hasAttachments) {
      const resolved = await resolveAttachments(attachmentsResult.data);
      if (resolved.error) return ack({ error: resolved.error });
      attachments = resolved.attachments;
    }

    try {
      const message = await createMessage({
        channelId: channelId,
        userId: user.internalId,
        content,
        attachments,
      });
      // Emite para a room do CANAL (quem tem ele aberto agora, ver
      // presence.handler.js/channel:join) e para a room do SERVIDOR
      // (channel.server_id - todo socket já entra nela sozinho ao conectar,
      // ver online.handler.js) - é o que permite notificação desktop e badge
      // de não lidas de canal que a pessoa não está olhando no momento
      // (NotificationContext.jsx), filtrado por `view` em canal restrito
      // (messageRecipients). socket.io deduplica: quem está nas duas rooms
      // recebe o evento uma vez só. `serverId` vai junto no payload (a
      // mensagem em si não carrega isso) para o clique da notificação saber
      // pra qual /rooms/:roomId navegar.
      const recipients = await messageRecipients(io, channel);
      // io.to([]) viraria broadcast pra TODO socket - lista vazia não emite.
      if (recipients.length) io.to(recipients).emit("chat:message", { ...message, serverId: channel.server_id });
      return ack({ ok: true, message });
    } catch (err) {
      logError("chat_message_send_failed", err, { channel_id: channelId, room_id: channel.server_id }, "Chat message could not be sent");
      return ack({ error: "Não foi possível enviar a mensagem." });
    }
  });
}
