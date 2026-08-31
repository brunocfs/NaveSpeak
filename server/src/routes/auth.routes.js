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
import {
  createUser,
  findUserByEmail,
  findUserByTag,
  findUserById,
  findUserByPublicId,
  registerFailedLogin,
  clearFailedLogins,
} from '../db/users.repo.js';
import { consumeInvite, recordInviteRedemption } from '../db/invites.repo.js';
import {
  storeRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
} from '../db/refreshTokens.repo.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { formatTag, parseTag } from '../utils/discriminator.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from '../utils/tokens.js';

const router = Router();

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth';

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

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Informe usuário#tag ou email.').max(255),
  password: z.string().min(1).max(200),
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
        return res.status(400).json({ error: 'Convite obrigatório para se cadastrar.' });
      }
      invite = await consumeInvite(inviteCode);
      if (!invite) {
        return res.status(400).json({ error: 'Convite inválido, expirado, revogado ou sem usos restantes.' });
      }
    }

    // Mensagem genérica (não revela SE foi o email que já existe) - mesmo
    // princípio já aplicado no handler de login logo abaixo. Username não
    // entra mais nessa checagem: pode se repetir entre contas (ver
    // discriminator em users.repo.js#createUser).
    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'Não foi possível concluir o cadastro com esses dados.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ username, email, passwordHash });
    if (invite) await recordInviteRedemption(invite.id, user.id);

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

    let user;
    if (identifier.includes('@')) {
      user = await findUserByEmail(identifier.toLowerCase());
    } else {
      const tag = parseTag(identifier);
      if (!tag) return genericError(); // username sozinho não é mais um identificador válido
      user = await findUserByTag(tag.username, tag.discriminator);
    }

    if (!user) return genericError();

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Conta temporariamente bloqueada. Tente novamente mais tarde.' });
    }

    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      await registerFailedLogin(user.id);
      return genericError();
    }

    await clearFailedLogins(user.id);
    const accessToken = await issueSession(res, user);
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
    if (!token) return res.status(401).json({ error: 'Sem sessão ativa.' });

    const hash = hashRefreshToken(token);
    const stored = await findValidRefreshToken(hash);
    if (!stored) {
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
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    const accessToken = await issueSession(res, user);
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

export default router;
