// Erros com código estável. `error_code` é o que vai pra log/alerta/métrica;
// `public_message` é a única coisa que o cliente vê (em pt-BR, igual ao resto
// da API). A causa original fica em `cause`, só para o log.
import { logger, serializeError } from './logger.js';

const LOGGED = Symbol('observability.logged');
export const markLogged = (err) => {
  if (err && typeof err === 'object') err[LOGGED] = true;
  return err;
};
export const isLogged = (err) => Boolean(err?.[LOGGED]);

export const GENERIC_PUBLIC_MESSAGE = 'Erro interno do servidor.';
const UNAVAILABLE_PUBLIC_MESSAGE = 'Serviço temporariamente indisponível. Tente novamente.';

export class AppError extends Error {
  constructor(
    errorCode,
    { status = 500, publicMessage, retryable = false, expected = status < 500, cause, message } = {}
  ) {
    super(message ?? errorCode, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.error_code = errorCode;
    this.status = status;
    this.public_message = publicMessage ?? (status >= 500 ? GENERIC_PUBLIC_MESSAGE : 'Requisição inválida.');
    this.retryable = retryable;
    // Esperado = causado por entrada/estado do cliente: sem stack no log.
    this.expected = expected;
  }
}

const result = (error_code, status, { retryable = false, expected = status < 500, public_message } = {}) => ({
  error_code,
  status,
  retryable,
  expected,
  public_message:
    public_message ?? (status === 503 ? UNAVAILABLE_PUBLIC_MESSAGE : status >= 500 ? GENERIC_PUBLIC_MESSAGE : 'Requisição inválida.'),
});

// SQLSTATE -> código estável (https://www.postgresql.org/docs/current/errcodes-appendix.html)
const PG_CODES = {
  23505: ['DB_UNIQUE_VIOLATION', 500],
  23503: ['DB_FOREIGN_KEY_VIOLATION', 500],
  23502: ['DB_NOT_NULL_VIOLATION', 500],
  23514: ['DB_CHECK_VIOLATION', 500],
  '22P02': ['DB_INVALID_INPUT', 500],
  '40P01': ['DB_DEADLOCK', 503, true],
  40001: ['DB_SERIALIZATION_FAILURE', 503, true],
  57014: ['DB_TIMEOUT', 503, true],
  53300: ['DB_TOO_MANY_CONNECTIONS', 503, true],
  '57P01': ['DB_UNAVAILABLE', 503, true],
  '57P03': ['DB_UNAVAILABLE', 503, true],
  '28P01': ['DB_AUTH_FAILED', 503],
  28000: ['DB_AUTH_FAILED', 503],
};
export const EXPECTED_DB_ERROR_CODES = new Set([
  'DB_UNIQUE_VIOLATION',
  'DB_FOREIGN_KEY_VIOLATION',
  'DB_NOT_NULL_VIOLATION',
  'DB_CHECK_VIOLATION',
  'DB_INVALID_INPUT',
]);

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN']);

// `dependency` diz de onde veio o erro quando só pelo objeto não dá pra saber
// (ECONNREFUSED do pg e do ioredis são idênticos).
export function classifyError(err, dependency) {
  if (err instanceof AppError) {
    return {
      error_code: err.error_code,
      status: err.status,
      retryable: err.retryable,
      expected: err.expected,
      public_message: err.public_message,
    };
  }
  if (!err || typeof err !== 'object') return result('INTERNAL_ERROR', 500);

  // body-parser / express
  if (err.type === 'entity.parse.failed') return result('INVALID_JSON', 400, { public_message: 'Dados inválidos.' });
  if (err.type === 'entity.too.large') {
    return result('PAYLOAD_TOO_LARGE', 413, { public_message: 'Requisição grande demais.' });
  }
  if (err.expose === true && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return result('REQUEST_INVALID', err.status, { public_message: 'Requisição inválida.' });
  }

  // jsonwebtoken
  if (err.name === 'TokenExpiredError') return result('TOKEN_EXPIRED', 401, { public_message: 'Sessão inválida ou expirada.' });
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return result('TOKEN_INVALID', 401, { public_message: 'Sessão inválida ou expirada.' });
  }

  const message = String(err.message ?? '');

  if (dependency === 'redis' || /^(ReplyError|MaxRetriesPerRequestError|ParserError)$/.test(err.name)) {
    if (/timed? ?out/i.test(message) || err.code === 'ETIMEDOUT') return result('REDIS_TIMEOUT', 503, { retryable: true });
    if (err.name === 'ReplyError') return result('REDIS_COMMAND_ERROR', 500);
    if (err.name === 'MaxRetriesPerRequestError' || /connection is closed/i.test(message) || NETWORK_CODES.has(err.code)) {
      return result('REDIS_UNAVAILABLE', 503, { retryable: true });
    }
    if (dependency === 'redis') return result('REDIS_ERROR', 500);
  }

  if (dependency === 'db' || (typeof err.code === 'string' && err.severity)) {
    const mapped = PG_CODES[err.code];
    if (mapped) return result(mapped[0], mapped[1], { retryable: Boolean(mapped[2]) });
    if (typeof err.code === 'string' && err.code.startsWith('08')) return result('DB_CONNECTION_ERROR', 503, { retryable: true });
    if (/timeout exceeded when trying to connect/i.test(message)) return result('DB_POOL_TIMEOUT', 503, { retryable: true });
    if (/timeout/i.test(message) || err.code === 'ETIMEDOUT') return result('DB_TIMEOUT', 503, { retryable: true });
    if (NETWORK_CODES.has(err.code) || /connection terminated/i.test(message)) {
      return result('DB_CONNECTION_ERROR', 503, { retryable: true });
    }
    if (dependency === 'db') return result('DB_ERROR', 500);
  }

  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return result('REQUEST_INVALID', err.status);
  }
  return result('INTERNAL_ERROR', 500);
}

// Loga um erro na camada que tem contexto - uma vez só: se uma camada de
// baixo (ex.: instrumentação do PostgreSQL) já registrou, não repete.
export function logError(event, err, fields = {}, message = 'Operation failed') {
  if (isLogged(err)) return;
  const c = classifyError(err);
  logger[c.expected ? 'warn' : 'error'](
    {
      event,
      error_code: c.error_code,
      retryable: c.retryable,
      ...fields,
      error: serializeError(err, { stack: !c.expected }),
    },
    message
  );
  markLogged(err);
}
