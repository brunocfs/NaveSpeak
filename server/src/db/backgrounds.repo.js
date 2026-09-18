// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
// user_id NULL = fundo PADRÃO do sistema; preenchido = fundo pessoal.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

const COLUMNS = 'id, name, file_path AS "filePath", created_at AS "createdAt"';

export async function listSystemBackgrounds() {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM backgrounds WHERE user_id IS NULL ORDER BY created_at ASC`);
  return rows;
}

export async function listUserBackgrounds(userId) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM backgrounds WHERE user_id = $1 ORDER BY created_at ASC`, [userId]);
  return rows;
}

export async function countUserBackgrounds(userId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM backgrounds WHERE user_id = $1', [userId]);
  return rows[0]?.count ?? 0;
}

// `userId` null busca entre os do sistema - impede apagar o fundo de outro
// usuário (ou um do sistema) só adivinhando o UUID.
export async function findBackground(id, userId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM backgrounds WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2 LIMIT 1`,
    [id, userId]
  );
  return rows[0] ?? null;
}

export async function createBackground({ id = randomUUID(), userId, name, filePath }) {
  await pool.query('INSERT INTO backgrounds (id, user_id, name, file_path) VALUES ($1, $2, $3, $4)', [id, userId, name, filePath]);
  return findBackground(id, userId);
}

export async function deleteBackground(id) {
  await pool.query('DELETE FROM backgrounds WHERE id = $1', [id]);
}
