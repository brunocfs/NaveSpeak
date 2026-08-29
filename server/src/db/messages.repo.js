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

// IMPORTANTE: esta função não checa membership nem o tipo do canal - quem
// chama (rota HTTP ou handler de socket) é responsável por confirmar
// isRoomMember() e que o canal é do tipo 'text' antes. Manter a checagem de
// autorização fora do repositório e explícita em cada chamador evita que uma
// nova rota "esqueça" de checar.
export async function createMessage({ channelId, userId, content }) {
  // userId é a PK interna (BIGINT) do usuário.
  const { rows: inserted } = await pool.query(
    "INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, $3) RETURNING id",
    [channelId, userId, content],
  );
  const { rows } = await pool.query(
    `SELECT m.id, m.channel_id, m.content, m.created_at, u.public_id AS user_id, u.username
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.id = $1`,
    [inserted[0].id],
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
    `SELECT m.id, m.channel_id, m.content, m.created_at, u.public_id AS user_id, u.username
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
