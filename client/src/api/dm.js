import { apiRequest } from './http.js';

export function listConversation(userId, { limit, before } = {}) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', limit);
  if (before) qs.set('before', before);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`/dm/${userId}${suffix}`);
}

export const clearConversation = (userId) => apiRequest(`/dm/${userId}`, { method: 'DELETE' });

export const markConversationRead = (userId) => apiRequest(`/dm/${userId}/read`, { method: 'POST' });
