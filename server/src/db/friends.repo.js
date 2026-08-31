// Amizade: uma linha por par de usuários (ver índice único normalizado no
// schema), nunca duas para o mesmo par. status 'pending' = requesterId pediu
// e aguarda resposta de addresseeId; 'accepted' = os dois são amigos.
// Recusar uma solicitação, cancelar uma enviada e remover uma amizade já
// aceita são a MESMA operação (DELETE da linha) - sem histórico de recusas.
//
// IMPORTANTE: como messages.repo.js, esta função não checa bloqueio nem
// autoadição - quem chama (rota HTTP) é responsável por isso antes.
import { pool } from '../config/db.js';

const FRIENDSHIP_COLUMNS = 'id, requester_id, addressee_id, status, created_at, responded_at';

export async function findExistingFriendship(userA, userB) {
  const { rows } = await pool.query(
    `SELECT ${FRIENDSHIP_COLUMNS} FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)
     LIMIT 1`,
    [userA, userB]
  );
  return rows[0] ?? null;
}

export async function findFriendshipById(id) {
  const { rows } = await pool.query(
    `SELECT ${FRIENDSHIP_COLUMNS} FROM friendships WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

// Cria a solicitação requesterId -> addresseeId. Se o destinatário já tinha
// mandado uma solicitação pendente pro remetente (os dois se adicionaram ao
// mesmo tempo), aceita direto em vez de criar uma segunda linha - o índice
// único do par não deixaria mesmo, já que reflete o mesmo par.
export async function sendFriendRequest(requesterId, addresseeId) {
  const existing = await findExistingFriendship(requesterId, addresseeId);
  if (existing) {
    if (existing.status === 'accepted') return { alreadyFriends: true, row: existing };
    if (existing.requester_id === addresseeId) {
      const { rows } = await pool.query(
        `UPDATE friendships SET status = 'accepted', responded_at = NOW()
         WHERE id = $1 RETURNING ${FRIENDSHIP_COLUMNS}`,
        [existing.id]
      );
      return { autoAccepted: true, row: rows[0] };
    }
    return { alreadyPending: true, row: existing };
  }

  const { rows } = await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING ${FRIENDSHIP_COLUMNS}`,
    [requesterId, addresseeId]
  );
  return { created: true, row: rows[0] };
}

export async function acceptFriendRequest(requestId) {
  const { rows } = await pool.query(
    `UPDATE friendships SET status = 'accepted', responded_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING ${FRIENDSHIP_COLUMNS}`,
    [requestId]
  );
  return rows[0] ?? null;
}

// Usada tanto para recusar/cancelar uma solicitação pendente quanto para
// desfazer uma amizade já aceita - em ambos os casos é só apagar a linha.
export async function deleteFriendshipById(id) {
  const { rowCount } = await pool.query('DELETE FROM friendships WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function removeFriendBetween(userA, userB) {
  const { rowCount } = await pool.query(
    `DELETE FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [userA, userB]
  );
  return rowCount > 0;
}

export async function areFriends(userA, userB) {
  const { rows } = await pool.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
     LIMIT 1`,
    [userA, userB]
  );
  return rows.length > 0;
}

// Amigos (aceitos) com os dados públicos do OUTRO usuário do par - nunca o
// id interno.
export async function listFriends(userId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS id, u.username, u.discriminator, u.avatar_path AS "avatarPath", f.responded_at AS since
     FROM friendships f
     INNER JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
     ORDER BY f.responded_at DESC`,
    [userId]
  );
  return rows;
}

// public_id dos amigos aceitos - usado só para notificação de presença
// (sockets/online.handler.js), que precisa saber a quais rooms pessoais
// (user:<publicId>) emitir online/offline.
export async function listFriendPublicIds(userId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS id
     FROM friendships f
     INNER JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)`,
    [userId]
  );
  return rows.map((r) => r.id);
}

export async function listIncomingRequests(userId) {
  const { rows } = await pool.query(
    `SELECT f.id, u.public_id AS "userId", u.username, f.created_at
     FROM friendships f
     INNER JOIN users u ON u.id = f.requester_id
     WHERE f.status = 'pending' AND f.addressee_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function listOutgoingRequests(userId) {
  const { rows } = await pool.query(
    `SELECT f.id, u.public_id AS "userId", u.username, f.created_at
     FROM friendships f
     INNER JOIN users u ON u.id = f.addressee_id
     WHERE f.status = 'pending' AND f.requester_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return rows;
}
