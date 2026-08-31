// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';
import { addDefaultChannelsForServer } from './channels.repo.js';

function generateInviteCode() {
  return randomBytes(6).toString('hex').toUpperCase(); // 12 caracteres
}

export async function createRoom({ name, createdBy }) {
  const id = randomUUID();
  const inviteCode = generateInviteCode();
  // createdBy é a PK interna (BIGINT) do usuário - vem de req.user.internalId.
  await pool.query(
    'INSERT INTO rooms (id, name, invite_code, created_by) VALUES ($1, $2, $3, $4)',
    [id, name, inviteCode, createdBy]
  );
  await addRoomMember({ roomId: id, userId: createdBy });
  // Já cria os canais padrão (texto "geral" + voz "Voz") para o servidor não
  // abrir sem nenhum canal.
  await addDefaultChannelsForServer(id);
  return { id, name, invite_code: inviteCode, created_by: createdBy };
}

// created_by é exposto como o public_id do usuário (UUID), nunca a PK interna.
const ROOM_WITH_CREATOR = `
  SELECT r.id, r.name, r.invite_code, r.icon_path, u.public_id AS created_by, r.created_at
  FROM rooms r
  LEFT JOIN users u ON u.id = r.created_by`;

export async function findRoomById(roomId) {
  const { rows } = await pool.query(
    `${ROOM_WITH_CREATOR} WHERE r.id = $1 LIMIT 1`,
    [roomId]
  );
  return rows[0] ?? null;
}

export async function findRoomByInviteCode(inviteCode) {
  const { rows } = await pool.query(
    `${ROOM_WITH_CREATOR} WHERE r.invite_code = $1 LIMIT 1`,
    [inviteCode]
  );
  return rows[0] ?? null;
}

// Lista só as salas em que o usuário é membro - é essa junção com
// room_members, e não o formato do ID, que impede um usuário de ver salas
// alheias.
export async function listRoomsForUser(userId) {
  const { rows } = await pool.query(
    `${ROOM_WITH_CREATOR}
     INNER JOIN room_members rm ON rm.room_id = r.id
     WHERE rm.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function isRoomMember(roomId, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1',
    [roomId, userId]
  );
  return rows.length > 0;
}

export async function addRoomMember({ roomId, userId }) {
  // ON CONFLICT DO NOTHING: idempotente, entrar de novo em uma sala que já é
  // membro não é erro (equivalente ao INSERT IGNORE do MySQL).
  await pool.query(
    `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [roomId, userId]
  );
}

export async function removeRoomMember(roomId, userId) {
  await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
}

// PATCH parcial: name/iconPath undefined = não mexe naquele campo (iconPath
// null é um valor válido - "remover ícone", distinto de undefined).
export async function updateRoomProfile(roomId, { name, iconPath } = {}) {
  const fields = [];
  const values = [];
  let i = 1;
  if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
  if (iconPath !== undefined) { fields.push(`icon_path = $${i++}`); values.push(iconPath); }
  if (fields.length > 0) {
    values.push(roomId);
    await pool.query(`UPDATE rooms SET ${fields.join(', ')} WHERE id = $${i}`, values);
  }
  return findRoomById(roomId);
}

export async function regenerateInviteCode(roomId) {
  const inviteCode = generateInviteCode();
  await pool.query('UPDATE rooms SET invite_code = $2 WHERE id = $1', [roomId, inviteCode]);
  return findRoomById(roomId);
}

export async function listRoomMembers(roomId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS id, u.username, u.avatar_path AS "avatarPath"
     FROM room_members rm
     INNER JOIN users u ON u.id = rm.user_id
     WHERE rm.room_id = $1`,
    [roomId]
  );
  return rows;
}
