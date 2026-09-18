import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

// Um único código válido por vez por usuário: pedir um novo código invalida
// qualquer código anterior ainda não usado (evita acumular vários códigos
// válidos em paralelo se o usuário pedir reenvio).
export async function createPasswordReset({ userId, codeHash, expiresAt }) {
  const id = randomUUID();
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await pool.query(
    'INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [id, userId, codeHash, expiresAt]
  );
  return id;
}

export async function findValidPasswordReset(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM password_resets
     WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function registerFailedAttempt(id) {
  await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [id]);
}

export async function markPasswordResetUsed(id) {
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [id]);
}
