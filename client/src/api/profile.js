import { apiRequest } from './http.js';

export const getProfile = () => apiRequest('/users/me');

export const updateProfile = (fields) =>
  apiRequest('/users/me', { method: 'PATCH', body: JSON.stringify(fields) });

export const changePassword = (currentPassword, newPassword) =>
  apiRequest('/users/me/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

// `dataUrl` é o resultado de FileReader.readAsDataURL(file) - já vem como
// "data:image/png;base64,..." pronto para o corpo JSON esperado pelo
// servidor (ver users.routes.js, que não usa multer/multipart).
export const uploadAvatar = (dataUrl) =>
  apiRequest('/users/me/avatar', { method: 'POST', body: JSON.stringify({ image: dataUrl }) });

export const removeAvatar = () => apiRequest('/users/me/avatar', { method: 'DELETE' });

// Troca o status de presença (online/busy/away/invisible) - ver
// StatusSelector.jsx e PresenceContext.jsx.
export const updateStatus = (status) =>
  apiRequest('/users/me/status', { method: 'PATCH', body: JSON.stringify({ status }) });
