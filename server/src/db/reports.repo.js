// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { pool } from '../config/db.js';

const REPORT_ROW = `
  SELECT r.id, r.type, r.title, r.description, r.created_at,
         u.public_id AS "userId", u.username, u.avatar_path AS "avatarPath"
  FROM reports r
  INNER JOIN users u ON u.id = r.user_id`;

// userId aqui é a PK interna (BIGINT) do usuário - quem chama (rotas HTTP)
// é responsável por vir de req.user.internalId, nunca de um ID cru do body.
export async function createReport({ userId, type, title, description }) {
  const { rows: inserted } = await pool.query(
    'INSERT INTO reports (user_id, type, title, description) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, type, title, description]
  );
  const { rows } = await pool.query(`${REPORT_ROW} WHERE r.id = $1`, [inserted[0].id]);
  return rows[0];
}

// Lista mais recentes primeiro, com paginação simples por cursor (mesmo
// padrão de listMessagesForChannel em messages.repo.js) - todo usuário
// autenticado pode ver todos os reports (app é de grupo fechado, ver
// reports.routes.js).
export async function listReports({ limit = 50, beforeId = null } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const params = [];
  let cursorClause = '';
  if (beforeId) {
    cursorClause = 'WHERE r.id < $1';
    params.push(Number(beforeId));
  }
  const limitPlaceholder = `$${params.length + 1}`;
  params.push(cappedLimit);

  const { rows } = await pool.query(
    `${REPORT_ROW} ${cursorClause}
     ORDER BY r.id DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}
