// Queries parametrizadas (?) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';

function generateInviteCode() {
  return randomBytes(6).toString('hex').toUpperCase(); // 12 caracteres
}

export async function createRoom({ name, createdBy }) {
  const id = randomUUID();
  const inviteCode = generateInviteCode();
  await pool.execute(
    'INSERT INTO rooms (id, name, invite_code, created_by) VALUES (?, ?, ?, ?)',
    [id, name, inviteCode, createdBy]
  );
  await addRoomMember({ roomId: id, userId: createdBy });
  return { id, name, invite_code: inviteCode, created_by: createdBy };
}

export async function findRoomById(roomId) {
  const [rows] = await pool.execute('SELECT * FROM rooms WHERE id = ? LIMIT 1', [roomId]);
  return rows[0] ?? null;
}

export async function findRoomByInviteCode(inviteCode) {
  const [rows] = await pool.execute('SELECT * FROM rooms WHERE invite_code = ? LIMIT 1', [inviteCode]);
  return rows[0] ?? null;
}

// Lista só as salas em que o usuário é membro - é essa junção com
// room_members, e não o formato do ID, que impede um usuário de ver salas
// alheias.
export async function listRoomsForUser(userId) {
  const [rows] = await pool.execute(
    `SELECT r.id, r.name, r.invite_code, r.created_by, r.created_at
     FROM rooms r
     INNER JOIN room_members rm ON rm.room_id = r.id
     WHERE rm.user_id = ?
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function isRoomMember(roomId, userId) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? LIMIT 1',
    [roomId, userId]
  );
  return rows.length > 0;
}

export async function addRoomMember({ roomId, userId }) {
  // INSERT IGNORE: idempotente, entrar de novo em uma sala que já é membro não é erro.
  await pool.execute('INSERT IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', [roomId, userId]);
}

export async function listRoomMembers(roomId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.username
     FROM room_members rm
     INNER JOIN users u ON u.id = rm.user_id
     WHERE rm.room_id = ?`,
    [roomId]
  );
  return rows;
}
