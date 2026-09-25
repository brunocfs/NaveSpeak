// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { pool } from '../config/db.js';

const REPORT_ROW = `
  SELECT r.id, r.type, r.title, r.description, r.status, r.admin_response AS "adminResponse", r.created_at,
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
// reports.routes.js). status/type/userId (public_id de quem reportou) são
// filtros opcionais pro painel de listagem.
export async function listReports({ limit = 50, beforeId = null, status = null, type = null, userId = null } = {}) {
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const params = [];
  const clauses = [];
  if (beforeId) {
    params.push(Number(beforeId));
    clauses.push(`r.id < $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`r.status = $${params.length}`);
  }
  if (type) {
    params.push(type);
    clauses.push(`r.type = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    clauses.push(`u.public_id = $${params.length}`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  params.push(cappedLimit);
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await pool.query(
    `${REPORT_ROW} ${whereClause}
     ORDER BY r.id DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

// Atualização da equipe (status e/ou resposta) - id é o BIGINT interno já
// exposto como "id" na listagem (reports não tem public_id próprio).
// Retorna null se o report não existir, pra rota decidir o 404.
export async function updateReport(id, { status, response }) {
  const sets = [];
  const params = [];
  if (status !== undefined) {
    params.push(status);
    sets.push(`status = $${params.length}`);
  }
  if (response !== undefined) {
    params.push(response);
    sets.push(`admin_response = $${params.length}`);
  }
  params.push(Number(id));
  await pool.query(`UPDATE reports SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  const { rows } = await pool.query(`${REPORT_ROW} WHERE r.id = $1`, [Number(id)]);
  return rows[0] ?? null;
}
