// Status ONLINE global por usuário, independente de canal/servidor: um único
// Hash em vez de um por sala. Reaproveita os mesmos scripts Lua
// presenceAdd/presenceRemove (config/redis.js) que já garantem atomicidade
// entre múltiplos sockets (abas) do mesmo usuário - a forma do dado é
// idêntica à presença por sala (username + socketIds[]), só que com uma
// única chave fixa em vez de uma por roomId/channelId.
//
// Por cima disso, este módulo também guarda a PREFERÊNCIA de presença
// (online/busy/away/invisible, escolhida pelo usuário e persistida em
// users.status - ver users.repo.js) e a flag efêmera de INATIVIDADE (15min
// sem uso, detectada no cliente - ver PresenceContext.jsx e o evento
// socket 'presence:idle' em online.handler.js). As duas juntas decidem o
// status "de verdade" (getOwnStatus) e o que os OUTROS usuários enxergam
// (getPublicStatus - invisível sempre aparece como offline pra eles).
import { redis } from '../config/redis.js';

const ONLINE_KEY = 'presence:online:members';
const STATUS_KEY = 'presence:online:status';

const VALID_PREFERENCES = new Set(['online', 'busy', 'away', 'invisible']);

export async function markOnline(user, socketId) {
  try {
    await redis.presenceAdd(ONLINE_KEY, user.id, socketId, user.username);
  } catch {
    // Fail-open: sem Redis, o status online fica desativado.
  }
}

// Retorna true se esse era o último socket do usuário (ele ficou offline).
export async function markOffline(userId, socketId) {
  try {
    const becameOffline = (await redis.presenceRemove(ONLINE_KEY, userId, socketId)) === 1;
    if (becameOffline) {
      // Sem isso, a preferência/idle de uma sessão anterior "vazaria" pra
      // próxima conexão antes do markOnline seguinte rodar de novo.
      await redis.hdel(STATUS_KEY, userId).catch(() => {});
    }
    return becameOffline;
  } catch {
    return false;
  }
}

export async function isOnline(userId) {
  try {
    return (await redis.hexists(ONLINE_KEY, userId)) === 1;
  } catch {
    return false;
  }
}

export async function listOnlineUserIds() {
  try {
    return await redis.hkeys(ONLINE_KEY);
  } catch {
    return [];
  }
}

async function getStatusEntry(userId) {
  try {
    const raw = await redis.hget(STATUS_KEY, userId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Chamado ao conectar (espelha users.status) e ao trocar de status pelo
// seletor (users.routes.js PATCH /me/status) - preserva a flag `idle` já
// registrada (trocar de aba não deve fingir que o usuário voltou a se mexer).
export async function setPreference(userId, preference) {
  if (!VALID_PREFERENCES.has(preference)) return;
  try {
    const current = await getStatusEntry(userId);
    const entry = { preference, idle: current?.idle ?? false };
    await redis.hset(STATUS_KEY, userId, JSON.stringify(entry));
  } catch {
    // Fail-open: sem Redis, o status escolhido só fica valendo no banco.
  }
}

// Chamado pelo evento socket 'presence:idle' (ver online.handler.js) -
// idle=true só rebaixa quem está com preferência 'online' para 'away' (ver
// getOwnStatus); quem escolheu busy/away/invisible não é afetado.
export async function setIdle(userId, idle) {
  try {
    const current = await getStatusEntry(userId);
    if (!current) return; // não conectado - nada a atualizar
    await redis.hset(STATUS_KEY, userId, JSON.stringify({ ...current, idle: Boolean(idle) }));
  } catch {
    // Fail-open.
  }
}

// Status "de verdade", nunca colapsa invisível - só pra o PRÓPRIO usuário
// decidir o que exibir (o seletor sempre mostra a preferência escolhida, não
// isto - ver StatusSelector.jsx).
export async function getOwnStatus(userId) {
  const online = await isOnline(userId);
  if (!online) return 'offline';
  const entry = await getStatusEntry(userId);
  const preference = entry?.preference ?? 'online';
  if (preference === 'online' && entry?.idle) return 'away';
  return preference;
}

// Status PÚBLICO - o que os OUTROS usuários enxergam. 'invisible' vira
// 'offline' aqui: é a única diferença em relação a getOwnStatus.
export async function getPublicStatus(userId) {
  const status = await getOwnStatus(userId);
  return status === 'invisible' ? 'offline' : status;
}

// Snapshot inicial para quem acabou de entrar num servidor (ver
// presence.handler.js "server:join") - só usuários efetivamente visíveis
// (status público != 'offline') entram no mapa, igual ao antigo
// listOnlineUserIds só listar quem está conectado.
export async function listPublicStatuses() {
  const ids = await listOnlineUserIds();
  const result = {};
  for (const id of ids) {
    const status = await getPublicStatus(id);
    if (status !== 'offline') result[id] = status;
  }
  return result;
}
