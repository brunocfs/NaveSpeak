import { apiRequest } from './http.js';
import { API_URL } from './config.js';

// Mesmo esquema de avatarSrc (Avatar.jsx) - filePath vem relativo
// ("soundboard/<serverId>/<uuid>.<ext>", ver rooms.routes.js), servido
// estático em /uploads (server/src/index.js).
export const soundboardSrc = (filePath) => `${API_URL}/uploads/${filePath}`;

// Lista aberta a qualquer membro do servidor (ver GET /rooms/:roomId/soundboard
// em rooms.routes.js) - TOCAR de fato exige a permissão USE_SOUNDBOARD,
// checada no servidor via socket (soundboard:play, ver
// MediaSessionContext.jsx#triggerSoundboardSound).
export const listSounds = (roomId) => apiRequest(`/rooms/${roomId}/soundboard`);

export const uploadSound = (roomId, { name, fileData }) =>
  apiRequest(`/rooms/${roomId}/soundboard`, { method: 'POST', body: JSON.stringify({ name, fileData }) });

export const deleteSound = (roomId, soundId) =>
  apiRequest(`/rooms/${roomId}/soundboard/${soundId}`, { method: 'DELETE' });

// Limites globais (admin da aplicação) - GET/PATCH /api/admin/settings,
// ver AdminSoundboardSettingsPage.jsx.
export const getAppSettings = () => apiRequest('/admin/settings');
export const updateAppSettings = (patch) =>
  apiRequest('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) });
