import { apiRequest } from './http.js';
import { API_URL } from './config.js';

// filePath vem relativo ("backgrounds/<dir>/<uuid>.<ext>", ver
// backgrounds.routes.js), servido estático em /uploads.
export const backgroundSrc = (filePath) => `${API_URL}/uploads/${filePath}`;

// { defaults, mine, userServerUploadEnabled, maxUserBackgrounds }
export const listBackgrounds = () => apiRequest('/backgrounds');

const post = (path, { name, image }) =>
  apiRequest(path, { method: 'POST', body: JSON.stringify({ name, image }) });

// Padrões do sistema - só admin da aplicação (AdminBackgroundsSection.jsx).
export const uploadSystemBackground = (data) => post('/backgrounds/system', data);
export const deleteSystemBackground = (id) => apiRequest(`/backgrounds/system/${id}`, { method: 'DELETE' });

// Pessoais no servidor - só quando userServerUploadEnabled (recurso futuro
// pago; enquanto desligado o upload do usuário é local, ver
// utils/localBackgrounds.js).
export const uploadMyBackground = (data) => post('/backgrounds/mine', data);
export const deleteMyBackground = (id) => apiRequest(`/backgrounds/mine/${id}`, { method: 'DELETE' });
