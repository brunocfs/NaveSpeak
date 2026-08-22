import { pool } from "../config/db.js";
import { redis } from "../config/redis.js";

const MESSAGE_CACHE_TTL_SECONDS = 30;

// Invalida o cache de histórico de uma sala. O cache é por
// (roomId, limit, beforeId), então varremos as chaves com SCAN + DEL.
async function invalidateRoomMessageCache(roomId) {
  const pattern = `messages:${roomId}:*`;
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

// IMPORTANTE: esta função não checa membership - quem chama (rota HTTP ou
// handler de socket) é responsável por confirmar isRoomMember() antes. Manter
// a checagem de autorização fora do repositório e explícita em cada chamador
// evita que uma nova rota "esqueça" de checar.
export async function createMessage({ roomId, userId, content }) {
  // userId é a PK interna (BIGINT) do usuário.
  const { rows: inserted } = await pool.query(
    "INSERT INTO messages (room_id, user_id, content) VALUES ($1, $2, $3) RETURNING id",
    [roomId, userId, content],
  );
  const { rows } = await pool.query(
    `SELECT m.id, m.room_id, m.content, m.created_at, u.public_id AS user_id, u.username
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.id = $1`,
    [inserted[0].id],
  );
  await invalidateRoomMessageCache(roomId);
  return rows[0];
}

export async function listMessagesForRoom(
  roomId,
  { limit = 50, beforeId = null } = {},
) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const params = [roomId];
  let cursorClause = "";
  if (beforeId) {
    cursorClause = "AND m.id < $2";
    params.push(Number(beforeId));
  }
  // O placeholder do LIMIT é o último parâmetro da lista.
  const limitPlaceholder = `$${params.length + 1}`;
  params.push(cappedLimit);

  const cacheKey = `messages:${roomId}:${cappedLimit}:${beforeId ?? "latest"}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {
    /* cache miss / erro - segue para o banco */
  }

  const { rows } = await pool.query(
    `SELECT m.id, m.room_id, m.content, m.created_at, u.public_id AS user_id, u.username
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.room_id = $1 ${cursorClause}
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
