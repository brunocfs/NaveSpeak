import { isRoomMember } from "../db/rooms.repo.js";
import { findChannelById, listChannelsForServer } from "../db/channels.repo.js";
import { channelIdParamSchema, roomIdParamSchema } from "../validation/schemas.js";
import { listVoicePresence } from "./voicePresence.js";
import { listOnlineUserIds } from "./onlineStore.js";
import {
  addPresence,
  removePresence,
  removeSocketFromAllRooms,
  listPresence,
} from "./presenceStore.js";

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

    // Abrir um servidor não é entrar em nenhum canal específico (isso é
    // channel:join), mas a UI precisa mostrar de cara quem já está em cada
    // canal de voz - lê o roster de cada um direto do Redis, sem precisar
    // que o socket esteja conectado à chamada nem à sala socket.io do canal.
    const channels = await listChannelsForServer(parsed.data);
    const voiceChannels = channels.filter((channel) => channel.type === "voice");
    for (const channel of voiceChannels) {
      const participants = await listVoicePresence(channel.id);
      socket.emit("voice:update", { channelId: channel.id, participants });
    }

    // Snapshot inicial do status ONLINE global (independente de canal/
    // servidor, ver onlineStore.js) - dali em diante o cliente acompanha
    // pelos eventos user:online/user:offline emitidos para esta room.
    return ack({ ok: true, onlineUserIds: await listOnlineUserIds() });
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

    socket.join(channel.id);
    await addPresence(channel.id, user, socket.id);
    const members = await listPresence(channel.id);
    io.to(channel.id).emit("presence:update", {
      channelId: channel.id,
      members,
    });

    // Em canais de voz, também entrega a lista atual de participantes da voz
    // (Redis) para quem acabou de entrar, mesmo sem estar conectado na
    // chamada - assim o roster já aparece preenchido.
    if (channel.type === "voice") {
      const participants = await listVoicePresence(channel.id);
      socket.emit("voice:update", { channelId: channel.id, participants });
    }

    return ack({ ok: true, members });
  });

  socket.on("channel:leave", async (channelId, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};
    const parsed = channelIdParamSchema.safeParse(channelId);
    if (!parsed.success) return ack({ error: "ID de canal inválido." });

    socket.leave(parsed.data);
    await removePresence(parsed.data, user.id, socket.id);
    const members = await listPresence(parsed.data);
    io.to(parsed.data).emit("presence:update", {
      channelId: parsed.data,
      members,
    });
    return ack({ ok: true });
  });

  socket.on("disconnect", async () => {
    const affectedChannels = await removeSocketFromAllRooms(socket.id);
    for (const channelId of affectedChannels) {
      const members = await listPresence(channelId);
      io.to(channelId).emit("presence:update", { channelId, members });
    }
  });
}
