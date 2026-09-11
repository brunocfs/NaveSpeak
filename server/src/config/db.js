// Pool de conexão PostgreSQL. Credenciais vêm exclusivamente de variáveis de ambiente
// (nunca hardcoded aqui) e o usuário configurado em DB_USER deve ser um usuário
// de aplicação com privilégios mínimos (ver database/schema-postgre.sql) - nunca
// um superusuário. A conexão MySQL antiga foi preservada em db.mysql.js.
import pg from 'pg';
import { Gauge } from 'prom-client';
import { env } from './env.js';
import { logger, serializeError, shouldLog } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';
import { classifyError, markLogged, EXPECTED_DB_ERROR_CODES } from '../observability/errors.js';

const { Pool } = pg;

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: 10,
  // O pool do pg converte strings da coluna em JS por padrão; manter o
  // comportamento nativo evita surpresas com tipos numéricos grandes.
});

const DB_FIELDS = { database_system: 'postgresql' };
const VERBS = new Set(['select', 'insert', 'update', 'delete', 'with', 'begin', 'commit', 'rollback']);

// Nome de operação de baixa cardinalidade derivado do SQL (`select_users`,
// `update_refresh_tokens`) - nunca o SQL em si nem os valores dos parâmetros.
// Feito aqui, num ponto só, em vez de nomear cada query em cada repo.
export function operationName(sql) {
  const text = typeof sql === 'string' ? sql : (sql?.text ?? '');
  const verb = /^\s*([a-z]+)/i.exec(text)?.[1]?.toLowerCase();
  if (!verb || !VERBS.has(verb)) return 'other';
  const table = /\b(?:from|into|update)\s+"?([a-z_][a-z0-9_]*)/i.exec(text)?.[1]?.toLowerCase();
  return table ? `${verb}_${table}` : verb;
}

export function instrumentPool(target, { slowQueryMs }) {
  // Sem este handler, erro num cliente OCIOSO do pool (ex.: Postgres
  // reiniciou) é um 'error' sem listener e derruba o processo.
  target.on('error', (err) => {
    const c = classifyError(err, 'db');
    metrics.dbErrors.inc({ error_code: c.error_code });
    logger.error(
      { ...DB_FIELDS, event: 'database_connection_error', error_code: c.error_code, retryable: c.retryable, error: serializeError(err, { stack: false }) },
      'PostgreSQL idle client error'
    );
  });

  const rawQuery = target.query.bind(target);
  target.query = async function instrumentedQuery(...args) {
    if (typeof args[args.length - 1] === 'function') return rawQuery(...args); // estilo callback, não usado no projeto

    const operation = operationName(args[0]);
    const max = target.options?.max ?? 10;
    if (target.idleCount === 0 && target.totalCount >= max) {
      metrics.dbPoolExhausted.inc();
      const gate = shouldLog('database_pool_exhausted');
      if (gate) {
        logger.warn(
          { ...DB_FIELDS, ...gate, event: 'database_pool_exhausted', operation, pool_waiting: target.waitingCount, pool_max: max },
          'PostgreSQL pool exhausted; query is waiting for a client'
        );
      }
    }

    const startedAt = performance.now();
    try {
      const result = await rawQuery(...args);
      const durationMs = performance.now() - startedAt;
      metrics.dbDuration.observe({ operation }, durationMs / 1000);
      if (durationMs >= slowQueryMs) {
        logger.warn(
          { ...DB_FIELDS, event: 'database_query_slow', operation, duration_ms: Math.round(durationMs), threshold_ms: slowQueryMs },
          'Slow PostgreSQL query'
        );
      }
      return result;
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      metrics.dbDuration.observe({ operation }, durationMs / 1000);
      const c = classifyError(err, 'db');
      metrics.dbErrors.inc({ error_code: c.error_code });
      // Violação de constraint costuma ser fluxo tratado por quem chama (ex.:
      // createUser retenta colisão de discriminator) - só métrica aqui; se
      // ninguém tratar, o errorHandler/handler de socket registra.
      if (!EXPECTED_DB_ERROR_CODES.has(c.error_code)) {
        logger[c.retryable ? 'warn' : 'error'](
          {
            ...DB_FIELDS,
            event: 'database_operation_failed',
            operation,
            duration_ms: Math.round(durationMs),
            error_code: c.error_code,
            retryable: c.retryable,
            error: serializeError(err, { stack: !c.retryable }),
          },
          'PostgreSQL operation failed'
        );
        markLogged(err);
      }
      throw err;
    }
  };
  return target;
}

instrumentPool(pool, { slowQueryMs: env.LOG_SLOW_DB_QUERY_MS });

new Gauge({
  name: 'db_pool_connections',
  help: 'PostgreSQL pool clients by state',
  labelNames: ['state'],
  collect() {
    this.set({ state: 'total' }, pool.totalCount);
    this.set({ state: 'idle' }, pool.idleCount);
    this.set({ state: 'waiting' }, pool.waitingCount);
    this.set({ state: 'max' }, pool.options.max);
  },
});

export async function assertDbConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
