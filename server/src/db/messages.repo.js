import { pool } from "../config/db.js";

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

  const { rows } = await pool.query(
    `SELECT m.id, m.room_id, m.content, m.created_at, u.public_id AS user_id, u.username
     FROM messages m INNER JOIN users u ON u.id = m.user_id
     WHERE m.room_id = $1 ${cursorClause}
     ORDER BY m.id DESC
     LIMIT ${limitPlaceholder}`,
    params,
  );
  return rows.reverse(); // ordem cronológica para exibição
}
