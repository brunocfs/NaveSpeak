import { apiRequest } from './http.js';
import { API_URL } from './config.js';

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

// Banner do perfil (benefício profileBanner) - mesmo formato do avatar.
export const uploadBanner = (dataUrl) =>
  apiRequest('/users/me/banner', { method: 'POST', body: JSON.stringify({ image: dataUrl }) });

export const removeBanner = () => apiRequest('/users/me/banner', { method: 'DELETE' });

// banners/<id>.<ext> é sobrescrito no mesmo caminho - `version` (updatedAt)
// força o navegador a recarregar depois de trocar.
export const bannerSrc = (bannerPath, version) =>
  bannerPath ? `${API_URL}/uploads/${bannerPath}${version ? `?v=${new Date(version).getTime()}` : ''}` : null;

// Som de entrada (benefício joinSound) = um som já existente num servidor do
// usuário. options: [{ serverId, serverName, sounds: [{ id, name, filePath,
// durationMs, eligible, personal }] }].
export const listJoinSoundOptions = () => apiRequest('/users/me/join-sound/options');

export const setJoinSound = (soundId) =>
  apiRequest('/users/me/join-sound', { method: 'PUT', body: JSON.stringify({ soundId }) });

export const removeJoinSound = () => apiRequest('/users/me/join-sound', { method: 'DELETE' });

// Marca o popup "Você agora é TURBO!" como visto (turbo.welcomePending -> false).
export const markTurboWelcomeSeen = () =>
  apiRequest('/users/me/turbo/welcome-seen', { method: 'POST' });

export const removeAvatar = () => apiRequest('/users/me/avatar', { method: 'DELETE' });

// Troca o status de presença (online/busy/away/invisible) - ver
// StatusSelector.jsx e PresenceContext.jsx.
export const updateStatus = (status) =>
  apiRequest('/users/me/status', { method: 'PATCH', body: JSON.stringify({ status }) });

// Cartão público de outro usuário (preview de perfil) - nome estilizado e
// TURBO já filtrados pelo servidor.
export const getUserCard = (userId) => apiRequest(`/users/${userId}/profile`);
