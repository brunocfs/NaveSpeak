import { apiRequest } from './http.js';

export const createReport = ({ type, title, description }) =>
  apiRequest('/reports', { method: 'POST', body: JSON.stringify({ type, title, description }) });

export function listReports({ limit, before, status, type, userId } = {}) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', limit);
  if (before) qs.set('before', before);
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (userId) qs.set('userId', userId);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`/reports${suffix}`);
}

// Só admin (users.is_admin) - ver requireAdmin em server/src/routes/reports.routes.js.
export const updateReport = (id, { status, response }) =>
  apiRequest(`/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status, response }) });
