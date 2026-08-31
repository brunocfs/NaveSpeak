import { listRoomsForUser } from '../db/rooms.repo.js';
import { markOnline, markOffline, setPreference, setIdle } from './onlineStore.js';
import { listPendingCallInvites } from './callsStore.js';
import { broadcastUserStatus } from './presenceBroadcast.js';

// Status ONLINE global (independente de canal/servidor - ver onlineStore.js),
// junto com o STATUS de presença (online/busy/away/invisible - ver
// StatusSelector.jsx e o PATCH /api/users/me/status em users.routes.js).
//
// Assim que o socket autentica, o usuário entra em TODAS as rooms socket.io
// dos servidores dele (não só a que estiver navegando no momento via
// server:join) - é isso que permite a UI mostrar o status de qualquer amigo/
// membro em qualquer servidor do usuário sem precisar abrir cada um. O
// evento só é reemitido para essas rooms, então usuários de servidores
// diferentes nunca veem o status uns dos outros.
export function registerOnlineHandlers(io, socket) {
  const user = socket.data.user;

  // Toda conexão entra na própria "room pessoal" (user:<publicId>) - é assim
  // que outro usuário alcança este socket sem compartilhar servidor: pedido
  // de amizade (friends.routes.js), status de amigo e mensagem privada
  // (dm.handler.js) são todos entregues nela.
  socket.join(`user:${user.id}`);

  (async () => {
    await markOnline(user, socket.id);
    // Preferência gravada no banco (users.status) vira a preferência
    // efêmera desta conexão no Redis - dali em diante só é alterada pelo
    // PATCH /me/status (setPreference) ou pela inatividade (setIdle).
    await setPreference(user.id, user.status ?? 'online');

    const rooms = await listRoomsForUser(user.internalId);
    const roomIds = rooms.map((r) => r.id);
    for (const roomId of roomIds) socket.join(roomId);

    // Se o usuário escolheu 'invisible', o status público emitido aqui já
    // sai como 'offline' (ver onlineStore.getPublicStatus) - ninguém vê
    // "online" indevidamente.
    await broadcastUserStatus(io, user);

    // Reentrega convites de chamada privada ainda não respondidos - cobre
    // quem recebeu a chamada offline e só vê o socket.emit ao vivo (evento
    // já perdido) depois de reconectar (ver calls.handler.js/callsStore.js).
    const pendingCalls = await listPendingCallInvites(user.id);
    for (const invite of pendingCalls) {
      socket.emit('call:invite', invite);
    }
  })();

  // Emitido pelo PresenceContext.jsx quando detecta 15min de inatividade
  // (DOM, ou powerMonitor.getSystemIdleTime no Electron) e de novo quando a
  // atividade volta. Só rebaixa pra 'away' quem está com preferência
  // 'online' (ver onlineStore.getOwnStatus) - busy/away/invisible escolhidos
  // manualmente não são mexidos por inatividade.
  socket.on('presence:idle', async (payload) => {
    await setIdle(user.id, Boolean(payload?.idle));
    await broadcastUserStatus(io, user);
  });

  socket.on('disconnect', async () => {
    const wentOffline = await markOffline(user.id, socket.id);
    if (!wentOffline) return; // outro socket (aba) do mesmo usuário ainda está conectado

    await broadcastUserStatus(io, user);
  });
}
