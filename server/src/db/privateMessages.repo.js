// Conversa privada entre dois usuários. "Limpar histórico" é POR USUÁRIO
// (ver conversation_clears no schema): esconde só as mensagens antigas de
// quem limpou, sem apagar nenhuma linha nem afetar a visão do outro lado.
//
// IMPORTANTE: como messages.repo.js, esta função não checa amizade nem
// bloqueio - quem chama (sockets/dm.handler.js) é responsável por isso antes.
import { pool } from '../config/db.js';

// Mesmo raciocínio de ATTACHMENTS_AGG em messages.repo.js.
const ATTACHMENTS_AGG = `
  COALESCE(
    (SELECT json_agg(json_build_object('path', pma.path, 'name', pma.name, 'size', pma.size, 'mime', pma.mime) ORDER BY pma.position)
     FROM private_message_attachments pma WHERE pma.private_message_id = pm.id),
    '[]'
  ) AS attachments`;

const CONVERSATION_ROW = `
  SELECT pm.id, pm.content, pm.created_at,
         su.public_id AS sender_id, su.username AS sender_username, su.avatar_path AS "senderAvatarPath",
         su.is_system AS "senderIsSystem",
         su.name_style AS "senderNameStyle",
         ru.public_id AS recipient_id,
         ${ATTACHMENTS_AGG}
  FROM private_messages pm
  INNER JOIN users su ON su.id = pm.sender_id
  INNER JOIN users ru ON ru.id = pm.recipient_id`;

export async function createPrivateMessage({ senderId, recipientId, content, attachments = [] }) {
  const { rows: inserted } = await pool.query(
    'INSERT INTO private_messages (sender_id, recipient_id, content) VALUES ($1, $2, $3) RETURNING id',
    [senderId, recipientId, content]
  );
  const messageId = inserted[0].id;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    await pool.query(
      'INSERT INTO private_message_attachments (private_message_id, path, name, size, mime, position) VALUES ($1, $2, $3, $4, $5, $6)',
      [messageId, att.path, att.name, att.size, att.mime, i]
    );
  }

  const { rows } = await pool.query(`${CONVERSATION_ROW} WHERE pm.id = $1`, [messageId]);
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

// Todo peer com quem o usuário já trocou pelo menos uma mensagem privada
// (amigo ou não), mais recente primeiro - alimenta a aba "Mensagens" do
// painel lateral (RoomsPage.jsx), que agora é um inbox único (ver
// dm.handler.js: DM não depende mais só de amizade). Bloqueio em qualquer
// direção esconde o peer da lista por completo, mesmo raciocínio de
// loadPeer em routes/dm.routes.js.
export async function listConversationPeers(userId) {
  const { rows } = await pool.query(
    `SELECT u.public_id AS id, u.username, u.discriminator, u.avatar_path AS "avatarPath",
            u.is_system AS "isSystem", u.name_style AS "nameStyle",
            MAX(pm.created_at) AS "lastMessageAt"
     FROM private_messages pm
     INNER JOIN users u ON u.id = CASE WHEN pm.sender_id = $1 THEN pm.recipient_id ELSE pm.sender_id END
     WHERE (pm.sender_id = $1 OR pm.recipient_id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks b
         WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
            OR (b.blocker_id = u.id AND b.blocked_id = $1)
       )
     GROUP BY u.public_id, u.username, u.discriminator, u.avatar_path, u.is_system, u.name_style
     ORDER BY "lastMessageAt" DESC`,
    [userId]
  );
  return rows;
}

// Comunicado oficial pra TODOS os usuários (menos o próprio remetente e
// qualquer outra conta is_system) num único round-trip - só usado pelo
// painel admin (routes/adminBroadcasts.routes.js), nunca pelo dm:send de
// socket normal. Primeiro bulk insert do projeto: em vez de um loop de
// createPrivateMessage (1 INSERT por destinatário), um INSERT...SELECT só
// varrendo a tabela users. RETURNING não alcança colunas de JOIN, por isso
// o CTE: insere e, na mesma query, junta de volta o public_id de cada
// destinatário (pra emitir "dm:message" via socket - ver rota).
//
// `attachments`: cada anexo é o MESMO arquivo em disco, referenciado por N
// linhas de private_message_attachments (uma por destinatário, mesma
// estrutura de uma mensagem normal) - 1 query por anexo (não por
// destinatário), inserindo via unnest() sobre os ids já retornados acima.
export async function createSystemBroadcast({ senderId, content, attachments = [] }) {
  const { rows } = await pool.query(
    `WITH inserted AS (
       INSERT INTO private_messages (sender_id, recipient_id, content)
       SELECT $1, u.id, $2 FROM users u WHERE u.id <> $1 AND u.is_system = false
       RETURNING id, recipient_id, created_at
     )
     SELECT i.id, i.created_at, u.public_id AS "recipientPublicId"
     FROM inserted i INNER JOIN users u ON u.id = i.recipient_id`,
    [senderId, content]
  );

  if (attachments.length > 0 && rows.length > 0) {
    const messageIds = rows.map((r) => r.id);
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      await pool.query(
        `INSERT INTO private_message_attachments (private_message_id, path, name, size, mime, position)
         SELECT t.id, $2, $3, $4, $5, $6 FROM unnest($1::bigint[]) AS t(id)`,
        [messageIds, att.path, att.name, att.size, att.mime, i]
      );
    }
  }

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
