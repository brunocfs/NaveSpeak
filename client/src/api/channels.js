import { apiRequest } from './http.js';

export const createChannel = (roomId, channel) =>
  apiRequest(`/rooms/${roomId}/channels`, { method: 'POST', body: JSON.stringify(channel) });

export const updateChannel = (roomId, channelId, patch) =>
  apiRequest(`/rooms/${roomId}/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteChannel = (roomId, channelId) =>
  apiRequest(`/rooms/${roomId}/channels/${channelId}`, { method: 'DELETE' });
