import { apiRequest } from './http.js';

export const listFriends = () => apiRequest('/friends');
export const listFriendRequests = () => apiRequest('/friends/requests');
export const listBlockedUsers = () => apiRequest('/friends/blocks');

// `tag` no formato "usuario#12345" (identificador público único - username
// sozinho pode se repetir entre contas, ver server/src/db/users.repo.js).
export const sendFriendRequest = (tag) =>
  apiRequest('/friends/requests', { method: 'POST', body: JSON.stringify({ tag }) });

export const acceptFriendRequest = (requestId) =>
  apiRequest(`/friends/requests/${requestId}/accept`, { method: 'POST' });

export const declineFriendRequest = (requestId) =>
  apiRequest(`/friends/requests/${requestId}/decline`, { method: 'POST' });

export const removeFriend = (userId) => apiRequest(`/friends/${userId}`, { method: 'DELETE' });

export const blockUser = (tag) =>
  apiRequest('/friends/blocks', { method: 'POST', body: JSON.stringify({ tag }) });

export const unblockUser = (userId) => apiRequest(`/friends/blocks/${userId}`, { method: 'DELETE' });
