import rateLimit from "express-rate-limit";
import { redis } from "../config/redis.js";
import { metrics } from "../observability/metrics.js";

// Store de rate limit compartilhado no Redis - assim o limite é consistente
// entre várias instâncias do servidor (não por-instância como o store padrão
// em memória). Um contador por chave com TTL igual à janela. Se o Redis falhar,
// o limite simplesmente não bloqueia (fail-open) em vez de derrubar a rota.
// Implementa a interface `Store` do express-rate-limit v7 (increment,
// decrement, resetKey, init).
export class RedisRateLimitStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.init();
  }

  async increment(key) {
    const multi = redis.multi();
    multi.incr(key);
    multi.pttl(key);
    const [hits, pttl] = await multi.exec();
    const totalHits = Number(hits?.[1] ?? 0);
    // Se a chave ainda não tinha TTL (primeiro hit), define a janela.
    if (typeof pttl?.[1] !== "number" || pttl[1] <= 0) {
      await redis.pexpire(key, this.windowMs);
    }
    const resetTime = new Date(Date.now() + this.windowMs);
    return { totalHits, resetTime };
  }

  async decrement(key) {
    try {
      await redis.decr(key);
    } catch {
      /* fail-open */
    }
  }

  async resetKey(key) {
    await redis.del(key);
  }

  init() {}
}

// Mesma resposta de antes (status + message do limiter); só acrescenta
// métrica e o motivo pro access log. Log com limite de volume (throttleKey):
// um flood de 429 não pode virar um flood de linhas de log.
export function onLimitReached(limiter) {
  return (req, res, _next, options) => {
    metrics.rateLimited.inc({ limiter });
    res.locals.log = {
      event: "rate_limit_exceeded",
      limiter,
      level: "warn",
      security_relevant: true,
      throttleKey: limiter,
    };
    res.status(options.statusCode).send(options.message);
  };
}

const store = new RedisRateLimitStore(15 * 60 * 1000);

// Limita força bruta contra login/registro por IP. Além disso, users.repo.js
// aplica bloqueio de conta por usuário após tentativas falhas repetidas.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." },
  handler: onLimitReached("auth"),
  // Se o store (Redis) falhar, deixa a requisição passar em vez de quebrar o login.
  passOnStoreError: true,
  store,
});

// Store própria (janela diferente da de auth acima) - instâncias de
// RedisRateLimitStore não podem ser compartilhadas entre limiters com
// windowMs diferente, senão o TTL da chave no Redis fica errado.
const attachmentStore = new RedisRateLimitStore(10 * 60 * 1000);

// Limita upload de anexo de chat (attachments.routes.js) POR USUÁRIO (roda
// depois de requireAuth, então req.user já existe) - não por IP, pra não
// punir todo mundo atrás do mesmo NAT/proxy corporativo.
export const attachmentUploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Você está enviando arquivos rápido demais. Aguarde um pouco." },
  handler: onLimitReached("attachment_upload"),
  passOnStoreError: true,
  store: attachmentStore,
  keyGenerator: (req) => `attach:${req.user?.internalId ?? req.ip}`,
});

// Coleta de erro do client (routes/clientErrors.routes.js), por usuário.
export const clientErrorsRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições." },
  handler: onLimitReached("client_errors"),
  passOnStoreError: true,
  store: new RedisRateLimitStore(10 * 60 * 1000),
  keyGenerator: (req) => `client-errors:${req.user?.internalId ?? req.ip}`,
});
