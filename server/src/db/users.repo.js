// Todas as queries usam placeholders (?) do mysql2 - o driver escapa os valores
// automaticamente, então concatenar entrada do usuário na string SQL nunca é
// necessário aqui. Isso é o que evita SQL Injection, não validação "por fora".
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

export async function createUser({ username, email, passwordHash }) {
  const id = randomUUID();
  await pool.execute(
    'INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)',
    [id, username, email, passwordHash]
  );
  return { id, username, email };
}

export async function findUserByEmail(email) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] ?? null;
}

export async function findUserByUsername(username) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] ?? null;
}

export async function findUserById(id) {
  const [rows] = await pool.execute(
    'SELECT id, username, email, created_at FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] ?? null;
}

export async function registerFailedLogin(userId) {
  // Bloqueia a conta por 15 minutos após 5 tentativas seguidas (mitiga força bruta).
  await pool.execute(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= 5 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE)
           ELSE locked_until
         END
     WHERE id = ?`,
    [userId]
  );
}

export async function clearFailedLogins(userId) {
  await pool.execute(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
    [userId]
  );
}
