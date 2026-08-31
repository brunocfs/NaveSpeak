// Bloqueio é DIRECIONAL: A bloquear B não implica B bloquear A. Um bloqueio
// em qualquer direção do par impede nova solicitação de amizade e nova
// mensagem privada entre os dois (checagem em routes/sockets, nunca só pelo
// formato do ID) e remove a amizade existente entre eles, se houver.
import { pool } from '../config/db.js';
import { removeFriendBetween } from './friends.repo.js';

export async function blockUser(blockerId, blockedId) {
  await pool.query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [blockerId, blockedId]
  );
  await removeFriendBetween(blockerId, blockedId);
}

export async function unblockUser(blockerId, blockedId) {
  const { rowCount } = await pool.query(
    'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [blockerId, blockedId]
  );
  return rowCount > 0;
}

export async function isBlocked(blockerId, blockedId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2 LIMIT 1',
    [blockerId, blockedId]
  );
  return rows.length > 0;
}

export async function isBlockedEitherDirection(userA, userB) {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [userA, userB]
  );
  return rows.length > 0;
}

export async function listBlockedUsers(blockerId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS id, u.username, b.created_at
     FROM user_blocks b
     INNER JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id = $1
     ORDER BY b.created_at DESC`,
    [blockerId]
  );
  return rows;
}
