// Conversa privada entre dois usuários. "Limpar histórico" é POR USUÁRIO
// (ver conversation_clears no schema): esconde só as mensagens antigas de
// quem limpou, sem apagar nenhuma linha nem afetar a visão do outro lado.
//
// IMPORTANTE: como messages.repo.js, esta função não checa amizade nem
// bloqueio - quem chama (sockets/dm.handler.js) é responsável por isso antes.
import { pool } from '../config/db.js';

const CONVERSATION_ROW = `
  SELECT pm.id, pm.content, pm.created_at,
         su.public_id AS sender_id, su.username AS sender_username, su.avatar_path AS "senderAvatarPath",
         ru.public_id AS recipient_id
  FROM private_messages pm
  INNER JOIN users su ON su.id = pm.sender_id
  INNER JOIN users ru ON ru.id = pm.recipient_id`;

export async function createPrivateMessage({ senderId, recipientId, content }) {
  const { rows: inserted } = await pool.query(
    'INSERT INTO private_messages (sender_id, recipient_id, content) VALUES ($1, $2, $3) RETURNING id',
    [senderId, recipientId, content]
  );
  const { rows } = await pool.query(`${CONVERSATION_ROW} WHERE pm.id = $1`, [inserted[0].id]);
  return rows[0];
}

export async function listConversation(userId, peerId, { limit = 50, beforeId = null } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const { rows: clearRows } = await pool.query(
    'SELECT cleared_before FROM conversation_clears WHERE user_id = $1 AND peer_id = $2',
    [userId, peerId]
  );
  const clearedBefore = clearRows[0]?.cleared_before ?? 0;

  const params = [userId, peerId, clearedBefore];
  let cursorClause = '';
  if (beforeId) {
    cursorClause = 'AND pm.id < $4';
    params.push(Number(beforeId));
  }
  const limitPlaceholder = `$${params.length + 1}`;
  params.push(cappedLimit);

  const { rows } = await pool.query(
    `${CONVERSATION_ROW}
     WHERE ((pm.sender_id = $1 AND pm.recipient_id = $2) OR (pm.sender_id = $2 AND pm.recipient_id = $1))
       AND pm.id > $3
       ${cursorClause}
     ORDER BY pm.id DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows.reverse(); // ordem cronológica para exibição
}

async function getConversationMaxId(userA, userB) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(id), 0) AS "maxId" FROM private_messages
     WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)`,
    [userA, userB]
  );
  return rows[0].maxId;
}

// Marca o maior id ATUAL da conversa como corte para userId - não apaga
// nenhuma linha; mensagens novas (id maior) voltam a aparecer normalmente.
export async function clearConversation(userId, peerId) {
  const maxId = await getConversationMaxId(userId, peerId);
  await pool.query(
    `INSERT INTO conversation_clears (user_id, peer_id, cleared_before)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, peer_id)
     DO UPDATE SET cleared_before = GREATEST(conversation_clears.cleared_before, EXCLUDED.cleared_before)`,
    [userId, peerId, maxId]
  );
}

// Avança o cursor de leitura (last_read_message_id) até a mensagem mais
// recente da conversa - chamado ao abrir a conversa e, com ela já aberta, a
// cada mensagem nova recebida (ver dm:message em FriendsPanel.jsx/
// DmPanel.jsx). Independente de clearConversation: limpar não marca como
// lido, e marcar como lido não esconde nada.
export async function markConversationRead(userId, peerId) {
  const maxId = await getConversationMaxId(userId, peerId);
  await pool.query(
    `INSERT INTO conversation_clears (user_id, peer_id, last_read_message_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, peer_id)
     DO UPDATE SET last_read_message_id = GREATEST(conversation_clears.last_read_message_id, EXCLUDED.last_read_message_id)`,
    [userId, peerId, maxId]
  );
}

// Data da última mensagem trocada (enviada OU recebida) por amigo - usado
// pra ordenar a lista de amigos (online primeiro, depois conversa mais
// recente; ver friends.routes.js). Chave = public_id do amigo.
export async function getLastMessageTimestamps(userId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS "peerId", MAX(pm.created_at) AS "lastMessageAt"
     FROM private_messages pm
     INNER JOIN users u ON u.id = CASE WHEN pm.sender_id = $1 THEN pm.recipient_id ELSE pm.sender_id END
     WHERE pm.sender_id = $1 OR pm.recipient_id = $1
     GROUP BY u.public_id`,
    [userId]
  );
  return rows;
}

// Quantidade de mensagens privadas não lidas por remetente (chave =
// public_id de quem enviou) - usado para o badge na lista de amigos. Só
// conta mensagens em que userId é o DESTINATÁRIO; nunca a própria mensagem
// enviada, e nunca mais que o cursor de leitura permitir.
export async function getUnreadCounts(userId) {
  const { rows } = await pool.query(
    `SELECT su.public_id AS "senderId", COUNT(*)::int AS count
     FROM private_messages pm
     INNER JOIN users su ON su.id = pm.sender_id
     LEFT JOIN conversation_clears cr ON cr.user_id = pm.recipient_id AND cr.peer_id = pm.sender_id
     WHERE pm.recipient_id = $1
       AND pm.id > COALESCE(cr.last_read_message_id, 0)
     GROUP BY su.public_id`,
    [userId]
  );
  return rows;
}
