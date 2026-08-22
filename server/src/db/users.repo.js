// Todas as queries usam placeholders posicionais ($1, $2, ...) do pg - o driver
// escapa os valores automaticamente, então concatenar entrada do usuário na
// string SQL nunca é necessário aqui. Isso é o que evita SQL Injection, não
// validação "por fora".
//
// IDs híbridos: `id` (BIGINT, interno) é a PK usada em FKs/joins; `public_id`
// (UUID) é o que vai para o cliente (tokens, respostas) e NUNCA é a PK. As
// funções retornam `id` = interno e `publicId` = UUID exposto.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

const USER_COLUMNS = `
  id,
  public_id AS "publicId",
  username,
  email,
  password_hash,
  failed_login_attempts,
  locked_until,
  created_at`;

export async function createUser({ username, email, passwordHash }) {
  const publicId = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO users (public_id, username, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, public_id AS "publicId"`,
    [publicId, username, email, passwordHash]
  );
  const row = rows[0];
  return { id: row.id, publicId: row.publicId, username, email };
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 LIMIT 1`,
    [username]
  );
  return rows[0] ?? null;
}

// Busca por PK interna (BIGINT). Usado internamente (ex.: refresh token -> user).
export async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

// Busca pelo UUID exposto publicamente. É o que o token JWT carrega no `sub`
// e o que chega do cliente, então é o ponto de entrada nas rotas/handlers.
export async function findUserByPublicId(publicId) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE public_id = $1 LIMIT 1`,
    [publicId]
  );
  return rows[0] ?? null;
}

export async function registerFailedLogin(userId) {
  // Bloqueia a conta por 15 minutos após 5 tentativas seguidas (mitiga força bruta).
  await pool.query(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
           ELSE locked_until
         END
     WHERE id = $1`,
    [userId]
  );
}

export async function clearFailedLogins(userId) {
  await pool.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
    [userId]
  );
}
