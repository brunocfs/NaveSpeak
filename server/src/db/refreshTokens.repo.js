import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

export async function storeRefreshToken({ userId, tokenHash, expiresAt }) {
  const id = randomUUID();
  const { rows } = await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [id, userId, tokenHash, expiresAt]
  );
  return rows[0].id;
}

export async function findValidRefreshToken(tokenHash) {
  const { rows } = await pool.query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(tokenHash) {
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);
}

export async function revokeAllRefreshTokensForUser(userId) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}
