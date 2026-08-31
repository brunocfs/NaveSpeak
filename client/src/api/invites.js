import { apiRequest } from './http.js';

// Pública (sem checagem de admin no servidor) - usada por InviteRedirectPage
// e RegisterPage para validar um código antes/durante o cadastro.
export const checkInvite = (code) => apiRequest(`/invites/check/${encodeURIComponent(code)}`);

// As de baixo exigem admin (users.is_admin) - o servidor devolve 403 pra
// quem não é, o painel (AdminInvitesPage.jsx) só é alcançável por quem já é.
export const listInvites = () => apiRequest('/invites');

export const createInvite = (payload) =>
  apiRequest('/invites', { method: 'POST', body: JSON.stringify(payload) });

export const revokeInvite = (id) => apiRequest(`/invites/${id}`, { method: 'DELETE' });
