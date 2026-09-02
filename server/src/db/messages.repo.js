import { pool } from "../config/db.js";
import { redis } from "../config/redis.js";

const MESSAGE_CACHE_TTL_SECONDS = 30;

// Invalida o cache de histórico de um canal. O cache é por
// (channelId, limit, beforeId), então varremos as chaves com SCAN + DEL.
async function invalidateChannelMessageCache(channelId) {
  const pattern = `messages:${channelId}:*`;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* falha de cache não deve impedir o envio da mensagem */
  }
}

// Agregado em JSON dos anexos de uma mensagem, na ordem de seleção
// (position) - reaproveitado tanto no INSERT/SELECT de uma mensagem nova
// quanto na listagem paginada abaixo, pra nunca divergir o formato entre os
// dois. Vira [] (nunca null) quando a mensagem não tem anexo.
const ATTACHMENTS_AGG = `
  COALESCE(
    (SELECT json_agg(json_build_object('path', ma.path, 'name', ma.name, 'size', ma.size, 'mime', ma.mime) ORDER BY ma.position)
     FROM message_attachments ma WHERE ma.message_id = m.id),
    '[]'
  ) AS attachments`;

// IMPORTANTE: esta função não checa membership nem o tipo do canal - quem
// chama (rota HTTP ou handler de socket) é responsável por confirmar
// isRoomMember() e que o canal é do tipo 'text' antes. Manter a checagem de
// autorização fora do repositório e explícita em cada chamador evita que uma
// nova rota "esqueça" de checar.
export async function createMessage({ channelId, userId, content, attachments = [] }) {
  // userId é a PK interna (BIGINT) do usuário.
  const { rows: inserted } = await pool.query(
    "INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, $3) RETURNING id",
    [channelId, userId, content],
  );
  const messageId = inserted[0].id;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    await pool.query(
      "INSERT INTO message_attachments (message_id, path, name, size, mime, position) VALUES ($1, $2, $3, $4, $5, $6)",
      [messageId, att.path, att.name, att.size, att.mime, i],
    );
  }

  const { rows } = await pool.query(
    `SELECT m.id, m.channel_id, m.content, m.created_at,
            u.public_id AS user_id, u.username, u.avatar_path AS "avatarPath",
            ${ATTACHMENTS_AGG}
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.id = $1`,
    [messageId],
  );
  await invalidateChannelMessageCache(channelId);
  return rows[0];
}

export async function listMessagesForChannel(
  channelId,
  { limit = 50, beforeId = null } = {},
) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const params = [channelId];
  let cursorClause = "";
  if (beforeId) {
    cursorClause = "AND m.id < $2";
    params.push(Number(beforeId));
  }
  // O placeholder do LIMIT é o último parâmetro da lista.
  const limitPlaceholder = `$${params.length + 1}`;
  params.push(cappedLimit);

  const cacheKey = `messages:${channelId}:${cappedLimit}:${beforeId ?? "latest"}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {
    /* cache miss / erro - segue para o banco */
  }

  const { rows } = await pool.query(
    `SELECT m.id, m.channel_id, m.content, m.created_at,
            u.public_id AS user_id, u.username, u.avatar_path AS "avatarPath",
            ${ATTACHMENTS_AGG}
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = $1 ${cursorClause}
     ORDER BY m.id DESC
     LIMIT ${limitPlaceholder}`,
    params,
  );
  const result = rows.reverse(); // ordem cronológica para exibição

  try {
    await redis.set(cacheKey, JSON.stringify(result), "EX", MESSAGE_CACHE_TTL_SECONDS);
  } catch {
    /* falha de escrita no cache não deve quebrar a listagem */
  }
  return result;
}

async function getChannelMaxId(channelId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(id), 0) AS "maxId" FROM messages WHERE channel_id = $1`,
    [channelId],
  );
  return rows[0].maxId;
}

// Avança o cursor de leitura (channel_reads.last_read_message_id) até a
// mensagem mais recente do canal - chamado ao abrir o canal e, com ele já
// aberto, a cada mensagem nova recebida (ver ChatPanel.jsx/RoomPage.jsx).
// Mesmo raciocínio de markConversationRead em privateMessages.repo.js.
export async function markChannelRead(userId, channelId) {
  const maxId = await getChannelMaxId(channelId);
  await pool.query(
    `INSERT INTO channel_reads (user_id, channel_id, last_read_message_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel_id)
     DO UPDATE SET last_read_message_id = GREATEST(channel_reads.last_read_message_id, EXCLUDED.last_read_message_id)`,
    [userId, channelId, maxId],
  );
}

// Quantidade de mensagens não lidas por canal de um único servidor (chave =
// channelId) - usado para o badge individual de cada canal de texto dentro
// da sala (RoomPage.jsx). Nunca conta a própria mensagem do usuário como não
// lida.
export async function getUnreadCountsForServer(userId, serverId) {
  const { rows } = await pool.query(
    `SELECT m.channel_id AS "channelId", COUNT(*)::int AS count
     FROM messages m
     INNER JOIN channels c ON c.id = m.channel_id
     LEFT JOIN channel_reads cr ON cr.user_id = $1 AND cr.channel_id = m.channel_id
     WHERE c.server_id = $2
       AND m.user_id <> $1
       AND m.id > COALESCE(cr.last_read_message_id, 0)
     GROUP BY m.channel_id`,
    [userId, serverId],
  );
  return rows;
}

// Total de mensagens não lidas por SERVIDOR (soma de todos os canais de
// texto), para todo servidor em que o usuário é membro - usado no badge da
// lista de servidores da tela inicial (RoomsPage.jsx).
export async function getUnreadCountsByServer(userId) {
  const { rows } = await pool.query(
    `SELECT c.server_id AS "serverId", COUNT(*)::int AS count
     FROM messages m
     INNER JOIN channels c ON c.id = m.channel_id
     INNER JOIN room_members rm ON rm.room_id = c.server_id AND rm.user_id = $1
     LEFT JOIN channel_reads cr ON cr.user_id = $1 AND cr.channel_id = m.channel_id
     WHERE m.user_id <> $1
       AND m.id > COALESCE(cr.last_read_message_id, 0)
     GROUP BY c.server_id`,
    [userId],
  );
  return rows;
}
