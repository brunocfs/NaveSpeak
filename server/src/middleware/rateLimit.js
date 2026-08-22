import rateLimit from 'express-rate-limit';

// Limita força bruta contra login/registro por IP. Além disso, users.repo.js
// aplica bloqueio de conta por usuário após tentativas falhas repetidas.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
