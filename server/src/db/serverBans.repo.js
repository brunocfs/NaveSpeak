// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { pool } from '../config/db.js';

// Banir remove a membership atual (se houver) E registra o banimento -
// distinto de só expulsar (rooms.repo.js não tem "unban" implícito: sem
// linha aqui, o convite volta a funcionar normalmente).
export async function banUser({ serverId, userId, bannedBy, reason = null }) {
  await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [serverId, userId]);
  await pool.query(
    `INSERT INTO server_bans (server_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4)
     ON CONFLICT (server_id, user_id) DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason`,
    [serverId, userId, bannedBy, reason]
  );
}

export async function unbanUser(serverId, userId) {
  await pool.query('DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
}

export async function isBanned(serverId, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM server_bans WHERE server_id = $1 AND user_id = $2 LIMIT 1',
    [serverId, userId]
  );
  return rows.length > 0;
}

export async function listBans(serverId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS id, u.username, u.avatar_path AS "avatarPath",
            b.reason, b.created_at AS "bannedAt"
     FROM server_bans b
     INNER JOIN users u ON u.id = b.user_id
     WHERE b.server_id = $1
     ORDER BY b.created_at DESC`,
    [serverId]
  );
  return rows;
}
