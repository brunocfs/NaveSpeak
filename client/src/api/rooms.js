import { apiRequest } from './http.js';

export const getRoom = (roomId) => apiRequest(`/rooms/${roomId}`);

export const updateRoom = (roomId, { name, icon } = {}) =>
  apiRequest(`/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify({ name, icon }) });

export const updateServerSettings = (roomId, settings) =>
  apiRequest(`/rooms/${roomId}/settings`, { method: 'PATCH', body: JSON.stringify(settings) });

export const regenerateInvite = (roomId) =>
  apiRequest(`/rooms/${roomId}/invite/regenerate`, { method: 'POST' });

export const kickMember = (roomId, userId) =>
  apiRequest(`/rooms/${roomId}/members/${userId}`, { method: 'DELETE' });

export const listBans = (roomId) => apiRequest(`/rooms/${roomId}/bans`);

export const banMember = (roomId, userId, reason) =>
  apiRequest(`/rooms/${roomId}/bans/${userId}`, { method: 'POST', body: JSON.stringify({ reason }) });

export const unbanMember = (roomId, userId) =>
  apiRequest(`/rooms/${roomId}/bans/${userId}`, { method: 'DELETE' });
