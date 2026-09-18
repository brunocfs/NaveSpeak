import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { validateBody } from '../middleware/validate.js';
import {
  usernameFieldSchema,
  emailFieldSchema,
  passwordFieldSchema,
  registrationInviteCodeSchema,
} from '../validation/schemas.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'node:crypto';
import {
  createUser,
  findUserByEmail,
  findUserByTag,
  findUserById,
  findUserByPublicId,
  registerFailedLogin,
  clearFailedLogins,
  updatePasswordHash,
} from '../db/users.repo.js';
import { consumeInvite, recordInviteRedemption } from '../db/invites.repo.js';
import {
  storeRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../db/refreshTokens.repo.js';
import {
  createPasswordReset,
  findValidPasswordReset,
  registerFailedAttempt,
  markPasswordResetUsed,
} from '../db/passwordResets.repo.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { formatTag, parseTag } from '../utils/discriminator.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from '../utils/tokens.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { audit, setContext } from '../observability/logger.js';

const router = Router();

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

// Regras de username/email/senha vivem em validation/schemas.js - reusadas
// aqui e na edição de perfil (users.routes.js), uma única fonte de verdade.
// Todo o resto do "tratamento" de input acontece aqui, no servidor - nunca
// confiar só na validação do formulário no cliente. inviteCode é opcional no
// SCHEMA (o formato é validado se vier) - a exigência de fato (INVITE_ONLY)
// é checada no handler, não aqui, porque depende de env em runtime.
const registerSchema = z.object({
  username: usernameFieldSchema,
  email: emailFieldSchema,
  password: passwordFieldSchema,
  inviteCode: registrationInviteCodeSchema.optional(),
});

const identifierFieldSchema = z.string().trim().min(1, 'Informe usuário#tag ou email.').max(255);

const loginSchema = z.object({
  identifier: identifierFieldSchema,
  password: z.string().min(1).max(200),
});

// "Esqueci minha senha" - reusa o mesmo identificador do login (usuário#tag
// ou email). Resposta é sempre genérica (ver handler) pra não revelar se o
// identificador existe na base.
const forgotPasswordSchema = z.object({
  identifier: identifierFieldSchema,
});

const resetCodeFieldSchema = z.string().trim().regex(/^\d{6}$/, 'Código deve ter 6 dígitos.');

const resetPasswordSchema = z.object({
  identifier: identifierFieldSchema,
  code: resetCodeFieldSchema,
  newPassword: passwordFieldSchema,
});

function toPublicUser(user, status = 'online') {
  return {
    id: user.publicId,
    username: user.username,
    tag: formatTag(user.username, user.discriminator),
    status: user.status ?? status,
    avatarPath: user.avatarPath ?? null,
    isAdmin: Boolean(user.isAdmin),
  };
}

// Mesmo identificador aceito no login (usuário#tag ou email) - reusado por
// login, forgot-password e reset-password pra não divergir a lógica de
// "o que é um identificador válido" em três lugares.
async function findUserByIdentifier(identifier) {
  if (identifier.includes('@')) {
    return findUserByEmail(identifier.toLowerCase());
  }
  const tag = parseTag(identifier);
  if (!tag) return null;
  return findUserByTag(tag.username, tag.discriminator);
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTokenExpiryDate().getTime() - Date.now(),
  });
}

// Exportada para users.routes.js reusar ao trocar a senha (emite uma sessão
// nova pro dispositivo atual depois de revogar todas as outras - ver
// PUT /api/users/me/password).
export async function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, hash } = generateRefreshToken();
  // user.id aqui é a PK interna (BIGINT) usada na FK refresh_tokens.user_id.
  await storeRefreshToken({ userId: user.id, tokenHash: hash, expiresAt: refreshTokenExpiryDate() });
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

// Exposta sem auth - a tela de cadastro (client) usa isso para decidir se
// mostra/exige o campo de convite ANTES de o usuário preencher o resto do
// formulário. INVITE_ONLY é lido do .env (config/env.js), reavaliado a cada
// chamada (não precisa reiniciar o processo pra refletir uma mudança feita
// antes do boot, mas troca em runtime exigiria reiniciar mesmo assim - env
// só é lido uma vez no processo).
router.get('/config', (req, res) => {
  res.json({ inviteOnly: env.INVITE_ONLY });
});

router.post('/register', authRateLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { username, email, password, inviteCode } = req.body;

    // Convite exigido só quando INVITE_ONLY=true (ver GET /config acima) -
    // consumido de forma atômica (consumeInvite) ANTES de criar a conta, o
    // que impede duas requisições concorrentes de passarem pelo mesmo último
    // uso disponível. Se a criação da conta falhar depois disso (raro - ver
    // comentário em invites.repo.js#consumeInvite), o uso já foi gasto; é um
    // trade-off aceito em troca de nunca ultrapassar o limite do convite.
    let invite = null;
    if (env.INVITE_ONLY) {
      if (!inviteCode) {
        audit('registration_denied', { outcome: 'denied', reason_code: 'invite_required', level: 'info' });
        return res.status(400).json({ error: 'Convite obrigatório para se cadastrar.' });
      }
      invite = await consumeInvite(inviteCode);
      if (!invite) {
        audit('registration_denied', { outcome: 'denied', reason_code: 'invalid_invite', throttleKey: 'invalid_invite' });
        return res.status(400).json({ error: 'Convite inválido, expirado, revogado ou sem usos restantes.' });
      }
    }

    // Mensagem genérica (não revela SE foi o email que já existe) - mesmo
    // princípio já aplicado no handler de login logo abaixo. Username não
    // entra mais nessa checagem: pode se repetir entre contas (ver
    // discriminator em users.repo.js#createUser).
    if (await findUserByEmail(email)) {
      audit('registration_denied', { outcome: 'denied', reason_code: 'email_in_use', level: 'info' });
      return res.status(409).json({ error: 'Não foi possível concluir o cadastro com esses dados.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ username, email, passwordHash });
    setContext({ user_id: user.publicId });
    if (invite) {
      await recordInviteRedemption(invite.id, user.id);
      audit('invite_accepted', { resource_type: 'registration_invite', resource_id: invite.id });
    }
    audit('user_registered', { user_id: user.publicId, auth_method: 'password' });

    const accessToken = await issueSession(res, user);

    return res.status(201).json({ accessToken, user: toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', authRateLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    // Mensagem genérica em todos os casos (identificador com formato
    // inválido, usuário inexistente, ou senha errada) para não permitir
    // enumerar quais contas existem.
    const genericError = () => res.status(401).json({ error: 'Credenciais inválidas.' });
    // O motivo real (conta inexistente x senha errada) só vai pro log de
    // auditoria - nunca pro cliente. Identificador/senha nunca são logados.
    const loginFailed = (reasonCode, fields = {}) =>
      audit('login_failed', { outcome: 'failure', auth_method: 'password', reason_code: reasonCode, throttleKey: reasonCode, ...fields });

    let user;
    if (identifier.includes('@')) {
      user = await findUserByEmail(identifier.toLowerCase());
    } else {
      const tag = parseTag(identifier);
      if (!tag) {
        loginFailed('invalid_identifier');
        return genericError(); // username sozinho não é mais um identificador válido
      }
      user = await findUserByTag(tag.username, tag.discriminator);
    }

    if (!user) {
      loginFailed('unknown_account');
      return genericError();
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      loginFailed('account_locked', { user_id: user.publicId });
      return res.status(423).json({ error: 'Conta temporariamente bloqueada. Tente novamente mais tarde.' });
    }

    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      await registerFailedLogin(user.id);
      loginFailed('invalid_password', { user_id: user.publicId });
      // Mesmo limite de users.repo.js#registerFailedLogin (5 tentativas).
      if ((user.failed_login_attempts ?? 0) + 1 >= 5) {
        audit('account_locked', { outcome: 'failure', user_id: user.publicId, reason_code: 'too_many_failed_logins' });
      }
      return genericError();
    }

    await clearFailedLogins(user.id);
    setContext({ user_id: user.publicId });
    const accessToken = await issueSession(res, user);
    audit('login_succeeded', { user_id: user.publicId, auth_method: 'password' });
    return res.json({
      accessToken,
      user: toPublicUser(user),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      res.locals.log = { event: 'authentication_required', reason_code: 'missing_refresh_token' };
      return res.status(401).json({ error: 'Sem sessão ativa.' });
    }

    const hash = hashRefreshToken(token);
    const stored = await findValidRefreshToken(hash);
    if (!stored) {
      // Refresh token expirado, revogado ou REUTILIZADO depois da rotação
      // (sinal clássico de token roubado) - vale olhar em volume.
      audit('token_refresh_failed', { outcome: 'failure', reason_code: 'invalid_or_revoked_refresh_token', throttleKey: 'invalid' });
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    // Rotação: o token antigo é revogado e nunca mais pode ser reutilizado -
    // se um refresh token vazado for usado depois do dono legítimo já ter
    // rotacionado, ele será rejeitado aqui.
    await revokeRefreshToken(hash);

    // stored.user_id é a PK interna (BIGINT) - busca por ela, não pelo UUID.
    const user = await findUserById(stored.user_id);
    if (!user) {
      audit('token_refresh_failed', { outcome: 'failure', reason_code: 'user_not_found' });
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    setContext({ user_id: user.publicId });
    const accessToken = await issueSession(res, user);
    audit('session_refreshed', { user_id: user.publicId });
    return res.json({
      accessToken,
      user: toPublicUser(user),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      await revokeRefreshToken(hashRefreshToken(token));
    }
    audit('logout', { reason_code: token ? 'session_revoked' : 'no_active_session' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // req.user.id é o public_id (UUID) - busca por ele.
    const user = await findUserByPublicId(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({
      user: {
        ...toPublicUser(user),
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    return next(err);
  }
});

const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const FORGOT_PASSWORD_GENERIC_RESPONSE = {
  message: 'Se o usuário existir, enviamos um código de redefinição para o email cadastrado.',
};

router.post('/forgot-password', authRateLimiter, validateBody(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { identifier } = req.body;
    const user = await findUserByIdentifier(identifier);

    // Mesma resposta sempre, exista ou não o usuário - senão o endpoint vira
    // um oráculo de enumeração de contas (ver mesmo princípio no login).
    if (!user) {
      audit('password_reset_requested', { outcome: 'denied', reason_code: 'unknown_account' });
      return res.json(FORGOT_PASSWORD_GENERIC_RESPONSE);
    }

    // Código de 6 dígitos (000000-999999) - só o hash fica no banco (ver
    // db/passwordResets.repo.js), igual ao padrão de refresh token.
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = hashRefreshToken(code);
    await createPasswordReset({
      userId: user.id,
      codeHash,
      expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
    });

    const result = await sendPasswordResetEmail({ to: user.email, code });
    audit('password_reset_requested', { outcome: result.sent ? 'success' : 'failure', user_id: user.publicId, reason_code: result.sent ? undefined : 'email_send_failed' });

    return res.json(FORGOT_PASSWORD_GENERIC_RESPONSE);
  } catch (err) {
    return next(err);
  }
});

router.post('/reset-password', authRateLimiter, validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    const { identifier, code, newPassword } = req.body;
    const genericError = () => res.status(400).json({ error: 'Código inválido ou expirado.' });

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      audit('password_reset_failed', { outcome: 'failure', reason_code: 'unknown_account' });
      return genericError();
    }

    const reset = await findValidPasswordReset(user.id);
    if (!reset || reset.attempts >= RESET_MAX_ATTEMPTS) {
      audit('password_reset_failed', { outcome: 'failure', user_id: user.publicId, reason_code: reset ? 'too_many_attempts' : 'no_pending_reset' });
      return genericError();
    }

    if (hashRefreshToken(code) !== reset.code_hash) {
      await registerFailedAttempt(reset.id);
      audit('password_reset_failed', { outcome: 'failure', user_id: user.publicId, reason_code: 'invalid_code' });
      return genericError();
    }

    const passwordHash = await hashPassword(newPassword);
    await updatePasswordHash(user.id, passwordHash);
    await markPasswordResetUsed(reset.id);
    // Mesmo motivo de PUT /api/users/me/password (users.routes.js): uma
    // troca de senha revoga toda sessão existente, inclusive a de quem
    // eventualmente já tinha roubado a conta.
    await revokeAllRefreshTokensForUser(user.id);
    audit('password_reset_succeeded', { user_id: user.publicId, sessions_revoked: true });

    return res.json({ message: 'Senha redefinida. Faça login com a nova senha.' });
  } catch (err) {
    return next(err);
  }
});

export default router;
