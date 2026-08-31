import { apiRequest } from './http.js';

export const createReport = ({ type, title, description }) =>
  apiRequest('/reports', { method: 'POST', body: JSON.stringify({ type, title, description }) });

export function listReports({ limit, before } = {}) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', limit);
  if (before) qs.set('before', before);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`/reports${suffix}`);
}
