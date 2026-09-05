import { apiRequest } from './http.js';

export const getRoom = (roomId) => apiRequest(`/rooms/${roomId}`);

export const updateRoom = (roomId, { name, icon, description } = {}) =>
  apiRequest(`/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify({ name, icon, description }) });

export const updateServerSettings = (roomId, settings) =>
  apiRequest(`/rooms/${roomId}/settings`, { method: 'PATCH', body: JSON.stringify(settings) });

// Convites de servidor - múltiplos por servidor (ver server_invites no
// schema), listados/gerenciados na aba "Convites" de ServerSettingsModal.jsx
// e usados pelo atalho rápido ServerUserInvite.jsx. Gerar um novo NUNCA
// apaga/substitui os existentes.
export const listInvites = (roomId) => apiRequest(`/rooms/${roomId}/invites`);

export const createInvite = (roomId) =>
  apiRequest(`/rooms/${roomId}/invites`, { method: 'POST' });

export const revokeInvite = (roomId, inviteId) =>
  apiRequest(`/rooms/${roomId}/invites/${inviteId}/revoke`, { method: 'POST' });

export const deleteInvite = (roomId, inviteId) =>
  apiRequest(`/rooms/${roomId}/invites/${inviteId}`, { method: 'DELETE' });

// Preview público (pra quem já está logado) do convite - usado pela página
// /join/:code (ServerInvitePage.jsx), ANTES de decidir entrar.
export const getInvitePreview = (code) =>
  apiRequest(`/rooms/invite/${encodeURIComponent(code)}`);

export const joinRoomByInvite = (inviteCode) =>
  apiRequest('/rooms/join', { method: 'POST', body: JSON.stringify({ inviteCode }) });

export const kickMember = (roomId, userId) =>
  apiRequest(`/rooms/${roomId}/members/${userId}`, { method: 'DELETE' });

export const listBans = (roomId) => apiRequest(`/rooms/${roomId}/bans`);

export const banMember = (roomId, userId, reason) =>
  apiRequest(`/rooms/${roomId}/bans/${userId}`, { method: 'POST', body: JSON.stringify({ reason }) });

export const unbanMember = (roomId, userId) =>
  apiRequest(`/rooms/${roomId}/bans/${userId}`, { method: 'DELETE' });
