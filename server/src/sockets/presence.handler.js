import { isRoomMember } from "../db/rooms.repo.js";
import { findChannelById, listChannelsForServer } from "../db/channels.repo.js";
import { channelIdParamSchema, roomIdParamSchema } from "../validation/schemas.js";
import { listVoicePresence, voiceRoomOf } from "./voicePresence.js";
import { listGhostIds } from "./voicePresence.js";
import { computeEffectiveGhost } from "./voiceGhost.js";
import { joinModsRoomIfModerator, modsRoomOf } from "./modsRoom.js";
import { listPublicStatuses } from "./onlineStore.js";
import {
  addPresence,
  removePresence,
  removeSocketFromAllRooms,
  listPresence,
} from "./presenceStore.js";
import { canUserAccessChannel } from "./chat.handler.js";

// Lista completa (com ghost:true) só pra quem está na voz do canal ou é
// moderador; o resto recebe a filtrada.
async function voiceSnapshot(socket, channelId, isMod) {
  const full = isMod || socket.rooms.has(voiceRoomOf(channelId));
  return { channelId, participants: await listVoicePresence(channelId, { full }) };
}

// presence:update de canal é para quem "vê" o canal: fantasma (set da voz) não
// aparece nele (o roster de voz já mostra pra quem pode, via voice:update).
async function withoutGhosts(channelId, members) {
  const ghosts = new Set(await listGhostIds(channelId));
  return ghosts.size ? members.filter((m) => !ghosts.has(m.userId)) : members;
}

export function registerPresenceHandlers(io, socket) {
  const user = socket.data.user;

  // Presença é POR CANAL (não por servidor): ao entrar num canal, o socket
  // entra na "room" do socket.io keyada pelo channelId e a lista de
  // presentes é a daquele canal específico.

  socket.on("server:join", async (serverId, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};
    const parsed = roomIdParamSchema.safeParse(serverId);

    if (!parsed.success) return ack({ error: "ID de servidor inválido." });

    const member = await isRoomMember(parsed.data, user.internalId);
    if (!member) return ack({ error: "Você não é membro desse servidor." });

    socket.join(parsed.data);
    // Moderador de voz entra na mods:{serverId} e passa a ver os fantasmas.
    await joinModsRoomIfModerator(socket, parsed.data);
    const isMod = socket.rooms.has(modsRoomOf(parsed.data));

    // Abrir um servidor não é entrar em nenhum canal específico (isso é
    // channel:join), mas a UI precisa mostrar de cara quem já está em cada
    // canal de voz - lê o roster de cada um direto do Redis, sem precisar
    // que o socket esteja conectado à chamada nem à sala socket.io do canal.
    const channels = await listChannelsForServer(parsed.data);
    const voiceChannels = channels.filter((channel) => channel.type === "voice");
    for (const channel of voiceChannels) {
      socket.emit("voice:update", await voiceSnapshot(socket, channel.id, isMod));
    }

    // Snapshot inicial do status de presença global (independente de canal/
    // servidor, ver onlineStore.js) - dali em diante o cliente acompanha
    // pelo evento presence:status emitido para esta room. Mapa
    // { userId: 'online'|'busy'|'away' } - quem está offline (ou invisível)
    // simplesmente não aparece aqui.
    return ack({ ok: true, statuses: await listPublicStatuses() });
  });

  socket.on("channel:join", async (channelId, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};
    const parsed = channelIdParamSchema.safeParse(channelId);
    if (!parsed.success) return ack({ error: "ID de canal inválido." });

    const channel = await findChannelById(parsed.data);
    if (!channel) return ack({ error: "Canal não encontrado." });

    // Checagem de membership no banco a cada join - nunca confiar só no fato
    // de o cliente ter pedido para entrar nesse canal específico.
    const member = await isRoomMember(channel.server_id, user.internalId);
    if (!member) return ack({ error: "Você não é membro desse servidor." });
    // Sem isso, entrar na room do canal entregava as mensagens (chat:message)
    // de um canal restrito a quem não tem a role de visualização.
    if (!(await canUserAccessChannel(channel, user, "view"))) {
      return ack({ error: "Você não tem acesso a este canal." });
    }

    socket.join(channel.id);
    // Quem já seria fantasma não entra na presença do canal de voz (senão
    // abrir o canal o revelaria antes/sem entrar na chamada).
    const hide = channel.type === "voice" && (await computeEffectiveGhost(user));
    if (!hide) await addPresence(channel.id, user, socket.id);
    const members = await withoutGhosts(channel.id, await listPresence(channel.id));
    io.to(channel.id).emit("presence:update", {
      channelId: channel.id,
      members,
    });

    // Em canais de voz, também entrega a lista atual de participantes da voz
    // (Redis) para quem acabou de entrar, mesmo sem estar conectado na
    // chamada - assim o roster já aparece preenchido.
    if (channel.type === "voice") {
      socket.emit("voice:update", await voiceSnapshot(socket, channel.id, socket.rooms.has(modsRoomOf(channel.server_id))));
    }

    return ack({ ok: true, members });
  });

  socket.on("channel:leave", async (channelId, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};
    const parsed = channelIdParamSchema.safeParse(channelId);
    if (!parsed.success) return ack({ error: "ID de canal inválido." });

    socket.leave(parsed.data);
    await removePresence(parsed.data, user.id, socket.id);
    const members = await withoutGhosts(parsed.data, await listPresence(parsed.data));
    io.to(parsed.data).emit("presence:update", {
      channelId: parsed.data,
      members,
    });
    return ack({ ok: true });
  });

  socket.on("disconnect", async () => {
    const affectedChannels = await removeSocketFromAllRooms(socket.id);
    for (const channelId of affectedChannels) {
      const members = await withoutGhosts(channelId, await listPresence(channelId));
      io.to(channelId).emit("presence:update", { channelId, members });
    }
  });
}
