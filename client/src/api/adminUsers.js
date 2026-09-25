import { apiRequest } from "./http.js";

// params: { q, online, page }
export const listUsers = ({ q = "", online = false, page = 1 } = {}) =>
  apiRequest(`/admin/users?${new URLSearchParams({ q, page, online: online ? "1" : "" })}`);

// durationHours ausente = ban permanente.
export const banUser = (userId, { reason, durationHours } = {}) =>
  apiRequest(`/admin/users/${userId}/ban`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || undefined, durationHours }),
  });

export const unbanUser = (userId) =>
  apiRequest(`/admin/users/${userId}/ban`, { method: "DELETE" });

export const disconnectUser = (userId) =>
  apiRequest(`/admin/users/${userId}/disconnect`, { method: "POST" });

export const getStats = () => apiRequest("/admin/stats");

// TURBO em massa. days = null -> sem expiração; quem já é TURBO soma ao tempo restante.
export const grantTurbo = (userIds, days) =>
  apiRequest("/admin/users/turbo", { method: "POST", body: JSON.stringify({ userIds, days }) });

export const revokeTurbo = (userIds) =>
  apiRequest("/admin/users/turbo/revoke", { method: "POST", body: JSON.stringify({ userIds }) });

// Override de benefícios de um usuário ({ nameStyle?: boolean }; chave ausente = segue o global).
export const setUserTurboBenefits = (userId, benefits) =>
  apiRequest(`/admin/users/${userId}/turbo-benefits`, { method: "PUT", body: JSON.stringify(benefits) });
