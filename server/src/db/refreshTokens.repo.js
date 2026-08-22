import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

export async function storeRefreshToken({ userId, tokenHash, expiresAt }) {
  const id = randomUUID();
  await pool.execute(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [id, userId, tokenHash, expiresAt]
  );
  return id;
}

export async function findValidRefreshToken(tokenHash) {
  const [rows] = await pool.execute(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(tokenHash) {
  await pool.execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [tokenHash]);
}

export async function revokeAllRefreshTokensForUser(userId) {
  await pool.execute(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
}
