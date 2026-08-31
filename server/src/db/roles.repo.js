// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { sanitizePermissionsBitmask } from '../utils/permissions.js';

export async function createRole({ serverId, name, color = '#99AAB5', permissions = 0, position = 0 }) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, serverId, name, color, sanitizePermissionsBitmask(permissions), position]
  );
  return findRoleById(id);
}

export async function listRolesForServer(serverId) {
  const { rows } = await pool.query(
    `SELECT id, server_id, name, color, permissions, position, created_at
     FROM roles WHERE server_id = $1 ORDER BY position DESC, created_at ASC`,
    [serverId]
  );
  return rows;
}

export async function findRoleById(roleId) {
  const { rows } = await pool.query(
    `SELECT id, server_id, name, color, permissions, position, created_at
     FROM roles WHERE id = $1 LIMIT 1`,
    [roleId]
  );
  return rows[0] ?? null;
}

export async function updateRole(roleId, { name, color, permissions, position } = {}) {
  const fields = [];
  const values = [];
  let i = 1;
  if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
  if (color !== undefined) { fields.push(`color = $${i++}`); values.push(color); }
  if (permissions !== undefined) { fields.push(`permissions = $${i++}`); values.push(sanitizePermissionsBitmask(permissions)); }
  if (position !== undefined) { fields.push(`position = $${i++}`); values.push(position); }
  if (fields.length === 0) return findRoleById(roleId);

  values.push(roleId);
  await pool.query(`UPDATE roles SET ${fields.join(', ')} WHERE id = $${i}`, values);
  return findRoleById(roleId);
}

export async function deleteRole(roleId) {
  // role_members (cascade) e channels.*_role_id (ON DELETE SET NULL) já
  // cobrem a limpeza - ver database/schema-postgre.sql.
  await pool.query('DELETE FROM roles WHERE id = $1', [roleId]);
}

export async function assignRole(roleId, userId) {
  await pool.query(
    'INSERT INTO role_members (role_id, user_id) VALUES ($1, $2) ON CONFLICT (role_id, user_id) DO NOTHING',
    [roleId, userId]
  );
}

export async function unassignRole(roleId, userId) {
  await pool.query('DELETE FROM role_members WHERE role_id = $1 AND user_id = $2', [roleId, userId]);
}

// Confere que um conjunto de ids de role (ex.: view/send/share de um canal)
// realmente pertence a ESTE servidor - sem isso, MANAGE_CHANNELS permitiria
// referenciar a role de OUTRO servidor (não é escalação de privilégio - o
// roleIds de ninguém bate com uma role alheia, então o canal só ficaria
// travado à toa para todo mundo - mas é uma referência sem sentido que vale
// rejeitar cedo, com um erro claro, em vez de deixar acontecer). `roleIds`
// pode conter null/undefined (misturado com ids reais) - só os não-nulos
// são checados.
export async function assertRolesBelongToServer(roleIds, serverId) {
  const ids = [...new Set(roleIds.filter(Boolean))];
  if (ids.length === 0) return true;
  const { rows } = await pool.query(
    'SELECT id FROM roles WHERE server_id = $1 AND id = ANY($2::uuid[])',
    [serverId, ids]
  );
  return rows.length === ids.length;
}

// Ids (não objetos) das roles de um usuário num servidor - usado pela
// checagem de acesso a canal (canAccessChannel) e pelo agrupamento da lista
// de membros no client.
export async function listRoleIdsForUser(serverId, userId) {
  const { rows } = await pool.query(
    `SELECT r.id FROM roles r
     INNER JOIN role_members rm ON rm.role_id = r.id
     WHERE r.server_id = $1 AND rm.user_id = $2`,
    [serverId, userId]
  );
  return rows.map((r) => r.id);
}

// OR de todas as permissões de todas as roles do usuário nesse servidor - 0
// se ele não tiver nenhuma role. Não considera a regra do dono (isso é
// responsabilidade de permissions.js#checkPermission, que recebe este valor
// pronto).
export async function getUserPermissionBitmask(serverId, userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(BIT_OR(r.permissions), 0) AS bitmask
     FROM roles r
     INNER JOIN role_members rm ON rm.role_id = r.id
     WHERE r.server_id = $1 AND rm.user_id = $2`,
    [serverId, userId]
  );
  return Number(rows[0]?.bitmask ?? 0);
}

// Membros do servidor com suas roles (agregadas em array JSON) - usado pela
// lista de membros do client para agrupar por role e tingir o nome com a cor
// da role mais alta (position). Roles vêm ordenadas por position DESC, então
// roles[0] já é a "mais alta" quando existir.
export async function listMembersWithRoles(serverId) {
  const { rows } = await pool.query(
    `SELECT
       u.public_id AS id,
       u.username,
       u.avatar_path AS "avatarPath",
       COALESCE(
         json_agg(
           json_build_object('id', r.id, 'name', r.name, 'color', r.color, 'position', r.position)
           ORDER BY r.position DESC
         ) FILTER (WHERE r.id IS NOT NULL),
         '[]'
       ) AS roles
     FROM room_members rm
     INNER JOIN users u ON u.id = rm.user_id
     LEFT JOIN role_members rmem ON rmem.user_id = rm.user_id
     LEFT JOIN roles r ON r.id = rmem.role_id AND r.server_id = rm.room_id
     WHERE rm.room_id = $1
     GROUP BY u.public_id, u.username, u.avatar_path`,
    [serverId]
  );
  return rows;
}
