// Bitmask de permissoes de servidor - compartilhado entre rotas HTTP
// (middleware/permissions.js) e sockets (mediasoup.handler.js, chat.handler.js).
// Cabe folgado num INTEGER do Postgres (32 bits), so usamos 9 flags.
export const PERMISSIONS = {
  ADMINISTRATOR: 1 << 0, // Administração total - implica todas as outras
  MOVE_MEMBERS: 1 << 1, // Mover usuários entre canais de voz
  MUTE_MEMBERS: 1 << 2, // Mutar o áudio do usuário
  DISCONNECT_MEMBERS: 1 << 3, // Desconectar o usuário da voz
  DISABLE_MEDIA: 1 << 4, // Desligar a mídia do usuário (webcam/tela)
  MANAGE_CHANNELS: 1 << 5, // Criar/editar/remover canais e sua config de acesso
  BAN_MEMBERS: 1 << 6, // Banir/expulsar usuários
  CREATE_INVITE: 1 << 7, // Criar/regenerar convite do servidor
  MANAGE_SERVER: 1 << 8, // Alterar nome/imagem do servidor e configurações gerais
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce((acc, bit) => acc | bit, 0);

// Mascara so com os bits conhecidos acima - usada ao gravar `roles.permissions`
// pra nunca persistir um bit que o cliente tenha mandado por engano/malícia.
export function sanitizePermissionsBitmask(value) {
  const n = Number.isInteger(value) ? value : 0;
  return n & ALL_PERMISSIONS;
}

export function hasFlag(bitmask, flag) {
  return (Number(bitmask) & flag) === flag;
}

// Dono do servidor tem tudo, sempre, independente de role - regra especial
// pedida explicitamente (ver rooms.created_by, exposto como public_id em
// room.created_by pelas rotas). `room` precisa trazer created_by já como
// public_id (é o formato usado em toda a API); `user` é req.user/socket.data.user.
export function isServerOwner(room, user) {
  return Boolean(room?.created_by && user?.id && room.created_by === user.id);
}

// `bitmask` é o combinado (OR) de todas as roles do usuário no servidor -
// ver roles.repo.js#getUserPermissionBitmask.
export function checkPermission({ room, user, bitmask, flag }) {
  if (isServerOwner(room, user)) return true;
  if (hasFlag(bitmask, PERMISSIONS.ADMINISTRATOR)) return true;
  return hasFlag(bitmask, flag);
}

// Lista de chaves de PERMISSIONS que o usuário efetivamente tem - devolvida
// pelo GET /rooms/:roomId (myPermissions) pro client decidir o que mostrar.
// Dono/ADMINISTRATOR aparecem só como ['ADMINISTRATOR'] (o client trata como
// "libera tudo"), evitando listar as 9 flags à toa.
export function permissionKeysFor({ room, user, bitmask }) {
  if (isServerOwner(room, user) || hasFlag(bitmask, PERMISSIONS.ADMINISTRATOR)) {
    return ['ADMINISTRATOR'];
  }
  return Object.keys(PERMISSIONS).filter((key) => hasFlag(bitmask, PERMISSIONS[key]));
}

// Acesso por canal (ver/enviar/compartilhar mídia): dono/ADMINISTRATOR
// sempre passa; sem role exigida (coluna NULL) passa igual ao comportamento
// atual (qualquer membro); senão exige que `roleIds` (roles do usuário
// nesse servidor) contenha a role exigida pelo canal.
// Chaves camelCase - casam com os aliases de channels.repo.js (view_role_id
// AS "viewRoleId" etc.), não com o nome da coluna no banco.
const ACTION_COLUMN = {
  view: 'viewRoleId',
  send: 'sendRoleId',
  share: 'shareRoleId',
};

export function canAccessChannel({ channel, room, user, bitmask, roleIds, action }) {
  if (isServerOwner(room, user)) return true;
  if (hasFlag(bitmask, PERMISSIONS.ADMINISTRATOR)) return true;
  const requiredRoleId = channel[ACTION_COLUMN[action]];
  if (!requiredRoleId) return true;
  return (roleIds ?? []).includes(requiredRoleId);
}
