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
import { randomDiscriminator } from '../utils/discriminator.js';

const USER_COLUMNS = `
  id,
  public_id AS "publicId",
  username,
  discriminator,
  email,
  password_hash,
  bio,
  avatar_path AS "avatarPath",
  status,
  is_admin AS "isAdmin",
  failed_login_attempts,
  locked_until,
  created_at,
  updated_at`;

// Username NÃO é mais único sozinho (várias contas podem escolher o mesmo) -
// o identificador único é o par (LOWER(username), discriminator), reforçado
// pelo índice uq_users_username_discriminator no banco. Sorteia um
// discriminator de 5 dígitos e retenta só quando a colisão foi NESSE índice
// (nunca mascara um email duplicado, que usa outra constraint, como se fosse
// discriminador).
const MAX_DISCRIMINATOR_ATTEMPTS = 20;

export async function createUser({ username, email, passwordHash }) {
  const publicId = randomUUID();
  for (let attempt = 0; attempt < MAX_DISCRIMINATOR_ATTEMPTS; attempt++) {
    const discriminator = randomDiscriminator();
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (public_id, username, discriminator, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, public_id AS "publicId"`,
        [publicId, username, discriminator, email, passwordHash]
      );
      const row = rows[0];
      return { id: row.id, publicId: row.publicId, username, discriminator, email };
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'uq_users_username_discriminator') {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Não foi possível gerar um identificador único para este username. Tente novamente.');
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

// Busca pelo identificador público único "username#12345" (username sozinho
// não é mais garantia de conta única - ver discriminator acima). Usado no
// login por tag, e em friends.routes.js (pedido de amizade/bloqueio por tag).
export async function findUserByTag(username, discriminator) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE LOWER(username) = LOWER($1) AND discriminator = $2 LIMIT 1`,
    [username, discriminator]
  );
  return rows[0] ?? null;
}

// Checa se (username, discriminator) já pertence a OUTRO usuário - chamado
// só quando o usuário está trocando de username no PATCH de perfil
// (users.routes.js), pra recusar antes de bater no índice único do banco
// caso o novo username combinado com o discriminator ATUAL dele já exista em
// outra conta (raro, mas possível).
export async function isTagTakenByAnotherUser(username, discriminator, excludeUserId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND discriminator = $2 AND id <> $3 LIMIT 1`,
    [username, discriminator, excludeUserId]
  );
  return rows.length > 0;
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

// Update PARCIAL: só entra no SET o campo que veio definido (undefined =
// "não mexer nesse campo") - é isso que permite PATCH /api/users/me aceitar
// só username, só bio, ou qualquer combinação, sem sobrescrever o resto com
// null. A checagem de username/email já em uso é responsabilidade de quem
// chama (users.routes.js), igual ao padrão de auth.routes.js no cadastro.
export async function updateProfile(userId, { username, email, bio } = {}) {
  const sets = [];
  const values = [];
  let i = 1;

  if (username !== undefined) {
    sets.push(`username = $${i++}`);
    values.push(username);
  }
  if (email !== undefined) {
    sets.push(`email = $${i++}`);
    values.push(email);
  }
  if (bio !== undefined) {
    sets.push(`bio = $${i++}`);
    values.push(bio || null);
  }
  sets.push('updated_at = NOW()');

  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${USER_COLUMNS}`,
    values
  );
  return rows[0] ?? null;
}

export async function updateAvatarPath(userId, avatarPath) {
  const { rows } = await pool.query(
    `UPDATE users SET avatar_path = $1, updated_at = NOW() WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [avatarPath, userId]
  );
  return rows[0] ?? null;
}

export async function updatePasswordHash(userId, passwordHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, userId]
  );
}

// Preferência de status (online/busy/away/invisible) - validada antes de
// chegar aqui (ver validation/schemas.js). Não mexe em updated_at: é um
// estado de presença, não um dado de perfil editado pelo usuário.
export async function updateUserStatus(userId, status) {
  const { rows } = await pool.query(
    `UPDATE users SET status = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [status, userId]
  );
  return rows[0] ?? null;
}
