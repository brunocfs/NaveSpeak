import { apiRequest } from './http.js';

// Todas as conversas de DM com histórico (amigo ou não), mais recente
// primeiro - ver GET /api/dm (server/src/routes/dmConversations.routes.js).
export const listConversations = () => apiRequest('/dm');

export function listConversation(userId, { limit, before } = {}) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', limit);
  if (before) qs.set('before', before);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`/dm/${userId}${suffix}`);
}

export const clearConversation = (userId) => apiRequest(`/dm/${userId}`, { method: 'DELETE' });

export const markConversationRead = (userId) => apiRequest(`/dm/${userId}/read`, { method: 'POST' });
