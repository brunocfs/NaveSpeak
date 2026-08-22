import { pool } from '../config/db.js';

// IMPORTANTE: esta função não checa membership - quem chama (rota HTTP ou
// handler de socket) é responsável por confirmar isRoomMember() antes. Manter
// a checagem de autorização fora do repositório e explícita em cada chamador
// evita que uma nova rota "esqueça" de checar.
export async function createMessage({ roomId, userId, content }) {
  const [result] = await pool.execute(
    'INSERT INTO messages (room_id, user_id, content) VALUES (?, ?, ?)',
    [roomId, userId, content]
  );
  const [rows] = await pool.execute(
    `SELECT m.id, m.room_id, m.content, m.created_at, u.id AS user_id, u.username
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.id = ?`,
    [result.insertId]
  );
  return rows[0];
}

export async function listMessagesForRoom(roomId, { limit = 50, beforeId = null } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const params = [roomId];
  let cursorClause = '';
  if (beforeId) {
    cursorClause = 'AND m.id < ?';
    params.push(Number(beforeId));
  }
  params.push(cappedLimit);

  const [rows] = await pool.execute(
    `SELECT m.id, m.room_id, m.content, m.created_at, u.id AS user_id, u.username
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? ${cursorClause}
     ORDER BY m.id DESC
     LIMIT ?`,
    params
  );
  return rows.reverse(); // ordem cronológica para exibição
}
