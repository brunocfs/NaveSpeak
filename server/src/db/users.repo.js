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

// TURBO ativo pra linha `a` de users (alias da tabela na query).
export const turboActiveSql = (a) => `COALESCE(${a}.turbo_until > NOW(), FALSE)`;

// Benefício TURBO efetivo: override do usuário (turbo_benefits) > catálogo
// global (app_settings) > ligado. A subquery do catálogo não depende da
// linha, então o Postgres roda uma vez por query (InitPlan), não por usuário.
// `key` é sempre constante do código (nunca entrada do usuário).
export const turboBenefitSql = (a, key) =>
  `(${turboActiveSql(a)} AND COALESCE((${a}.turbo_benefits->>'${key}')::boolean, (SELECT (turbo_benefits->>'${key}')::boolean FROM app_settings WHERE id = 1), TRUE))`;

// name_style que pode ir pra OUTROS usuários: só com o benefício ativo (ou
// conta do sistema, Zeno). Expirado continua salvo no banco e volta sozinho
// ao renovar. Toda query que expõe nome estilizado deve usar isto, nunca a
// coluna crua.
export const publicNameStyleSql = (a) =>
  `CASE WHEN ${a}.is_system OR ${turboBenefitSql(a, 'nameStyle')} THEN ${a}.name_style ELSE '{}'::jsonb END`;

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
  is_system AS "isSystem",
  name_style AS "nameStyle",
  (banned_until IS NOT NULL AND banned_until > NOW()) AS "isBanned",
  NULLIF(banned_until, 'infinity') AS "bannedUntil",
  ban_reason AS "banReason",
  ${turboActiveSql('users')} AS "isTurbo",
  NULLIF(turbo_until, 'infinity') AS "turboUntil",
  turbo_benefits AS "turboBenefits",
  ${turboBenefitSql('users', 'nameStyle')} AS "canStyleName",
  show_common_servers AS "showCommonServers",
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
export async function updateProfile(userId, { username, email, bio, nameStyle, showCommonServers } = {}) {
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
  // Objeto INTEIRO, não patch por campo dentro do JSON - quem chama sempre
  // manda o estilo completo (ver nameStyleSchema), então um UPDATE simples
  // basta; não precisa de jsonb_set/merge.
  if (nameStyle !== undefined) {
    sets.push(`name_style = $${i++}::jsonb`);
    values.push(JSON.stringify(nameStyle));
  }
  if (showCommonServers !== undefined) {
    sets.push(`show_common_servers = $${i++}`);
    values.push(showCommonServers);
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

// Admins da APLICAÇÃO (users.is_admin) - painel admin (adminAdmins.routes.js).
export async function listAdmins() {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE is_admin = TRUE ORDER BY LOWER(username)`
  );
  return rows;
}

export async function setAdmin(userId, isAdmin) {
  const { rows } = await pool.query(
    `UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING ${USER_COLUMNS}`,
    [isAdmin, userId]
  );
  return rows[0] ?? null;
}

// Ban/bloqueio da plataforma: until = Date (bloqueio temporário),
// 'infinity' (ban permanente) ou null (libera a conta).
export async function setBan(userId, { until, reason = null }) {
  const { rows } = await pool.query(
    `UPDATE users SET banned_until = $1, ban_reason = $2 WHERE id = $3 RETURNING ${USER_COLUMNS}`,
    [until, until ? reason : null, userId]
  );
  return rows[0] ?? null;
}

// Mensagem mostrada ao usuário banido/bloqueado (login, refresh, requests).
export function banMessage(user) {
  const base = user.bannedUntil
    ? `Conta suspensa até ${new Date(user.bannedUntil).toLocaleString('pt-BR')}`
    : 'Conta banida';
  return user.banReason ? `${base}. Motivo: ${user.banReason}` : `${base}.`;
}

// TURBO em massa (painel admin). days = null -> sem expiração. Quem já tem
// TURBO ativo soma ao tempo restante (GREATEST ignora NULL; 'infinity' +
// intervalo continua 'infinity'). Conta do sistema nunca recebe.
// Devolve os publicIds de fato atualizados.
export async function grantTurbo(publicIds, days) {
  const { rows } = await pool.query(
    `UPDATE users SET turbo_until = CASE
       WHEN $2::int IS NULL THEN 'infinity'::timestamp
       ELSE GREATEST(turbo_until, NOW()::timestamp) + make_interval(days => $2::int)
     END
     WHERE public_id = ANY($1::uuid[]) AND is_system = FALSE
     RETURNING public_id AS "publicId"`,
    [publicIds, days]
  );
  return rows.map((r) => r.publicId);
}

// Remove o TURBO na hora. name_style/turbo_benefits ficam guardados.
export async function revokeTurbo(publicIds) {
  const { rows } = await pool.query(
    `UPDATE users SET turbo_until = NULL
     WHERE public_id = ANY($1::uuid[]) AND is_system = FALSE
     RETURNING public_id AS "publicId"`,
    [publicIds]
  );
  return rows.map((r) => r.publicId);
}

// Override de benefícios de UM usuário - objeto inteiro (ver turboBenefitsSchema).
export async function setTurboBenefits(publicId, benefits) {
  const { rows } = await pool.query(
    `UPDATE users SET turbo_benefits = $1::jsonb
     WHERE public_id = $2 AND is_system = FALSE
     RETURNING public_id AS "publicId"`,
    [JSON.stringify(benefits), publicId]
  );
  return rows[0] ?? null;
}

// Lista paginada pro painel admin - busca só por username (nunca email).
// publicIds (opcional) restringe a um conjunto, ex.: quem está online.
export async function listUsersPage({ q = '', publicIds = null, limit = 50, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS}, COUNT(*) OVER() AS total
     FROM users
     WHERE is_system = FALSE
       AND ($1 = '' OR username ILIKE '%' || $1 || '%')
       AND ($2::uuid[] IS NULL OR public_id = ANY($2::uuid[]))
     ORDER BY LOWER(username), discriminator
     LIMIT $3 OFFSET $4`,
    [q, publicIds, limit, offset]
  );
  return { users: rows, total: Number(rows[0]?.total ?? 0) };
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
