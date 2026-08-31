import { apiRequest } from './http.js';

export const listRoles = (roomId) => apiRequest(`/rooms/${roomId}/roles`);

export const createRole = (roomId, role) =>
  apiRequest(`/rooms/${roomId}/roles`, { method: 'POST', body: JSON.stringify(role) });

export const updateRole = (roomId, roleId, patch) =>
  apiRequest(`/rooms/${roomId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteRole = (roomId, roleId) =>
  apiRequest(`/rooms/${roomId}/roles/${roleId}`, { method: 'DELETE' });

export const assignRole = (roomId, roleId, userId) =>
  apiRequest(`/rooms/${roomId}/roles/${roleId}/members/${userId}`, { method: 'POST' });

export const unassignRole = (roomId, roleId, userId) =>
  apiRequest(`/rooms/${roomId}/roles/${roleId}/members/${userId}`, { method: 'DELETE' });

// Rótulos em PT das 9 permissões (PERMISSIONS em server/src/utils/permissions.js)
// - única fonte usada pelos checkboxes de RoleEditor e pelas checagens de
// `myPermissions` espalhadas pelo client.
export const PERMISSION_LABELS = {
  ADMINISTRATOR: 'Administração total',
  MOVE_MEMBERS: 'Mover usuários',
  MUTE_MEMBERS: 'Mutar o áudio do usuário',
  DISCONNECT_MEMBERS: 'Desconectar o usuário',
  DISABLE_MEDIA: 'Desligar a mídia do usuário',
  MANAGE_CHANNELS: 'Gerenciar canais',
  BAN_MEMBERS: 'Banir/expulsar usuários',
  CREATE_INVITE: 'Criar convites para o servidor',
  MANAGE_SERVER: 'Alterar nome/imagem do servidor',
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS);

// `myPermissions` (vindo de GET /rooms/:roomId) é ['ADMINISTRATOR'] quando o
// usuário é dono/admin (o servidor não lista as 9 à toa nesse caso) - esta
// função é o único lugar que sabe expandir isso, todo o resto do client
// chama hasPermission em vez de inspecionar o array direto.
export function hasPermission(myPermissions, key) {
  if (!myPermissions) return false;
  return myPermissions.includes('ADMINISTRATOR') || myPermissions.includes(key);
}
