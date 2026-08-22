import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { validateBody } from '../middleware/validate.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
  findUserById,
  registerFailedLogin,
  clearFailedLogins,
} from '../db/users.repo.js';
import {
  storeRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
} from '../db/refreshTokens.repo.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from '../utils/tokens.js';

const router = Router();

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth';

// Senha: mínimo 10 caracteres, pelo menos uma letra e um número. Todo o resto
// do "tratamento" de input acontece aqui, no servidor - nunca confiar só na
// validação do formulário no cliente.
const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,32}$/, 'Username deve ter 3-32 caracteres (letras, números, _).'),
  email: z.string().trim().toLowerCase().email('Email inválido.').max(255),
  password: z
    .string()
    .min(10, 'Senha deve ter pelo menos 10 caracteres.')
    .max(200)
    .regex(/[A-Za-z]/, 'Senha deve conter ao menos uma letra.')
    .regex(/[0-9]/, 'Senha deve conter ao menos um número.'),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Informe usuário ou email.').max(255),
  password: z.string().min(1).max(200),
});

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTokenExpiryDate().getTime() - Date.now(),
  });
}

async function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, hash } = generateRefreshToken();
  await storeRefreshToken({ userId: user.id, tokenHash: hash, expiresAt: refreshTokenExpiryDate() });
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

router.post('/register', authRateLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // Mensagem genérica em ambos os casos (username já existe vs. email já
    // existe) para não permitir enumerar quais usernames/emails já têm conta
    // - mesmo princípio já aplicado no handler de login logo abaixo.
    if ((await findUserByUsername(username)) || (await findUserByEmail(email))) {
      return res.status(409).json({ error: 'Não foi possível concluir o cadastro com esses dados.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ username, email, passwordHash });
    const accessToken = await issueSession(res, user);

    return res.status(201).json({ accessToken, user: { id: user.id, username: user.username } });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', authRateLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const user = identifier.includes('@')
      ? await findUserByEmail(identifier.toLowerCase())
      : await findUserByUsername(identifier);

    // Mensagem genérica em ambos os casos (usuário inexistente vs senha errada)
    // para não permitir enumerar quais usernames/emails existem.
    const genericError = () => res.status(401).json({ error: 'Credenciais inválidas.' });

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
    return res.json({ accessToken, user: { id: user.id, username: user.username } });
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

    const user = await findUserById(stored.user_id);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    const accessToken = await issueSession(res, user);
    return res.json({ accessToken, user: { id: user.id, username: user.username } });
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
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
});

export default router;
