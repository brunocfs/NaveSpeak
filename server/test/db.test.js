import { captureLogs, counterValue } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentPool, operationName } from '../src/config/db.js';
import { metrics } from '../src/observability/metrics.js';
import { isLogged } from '../src/observability/errors.js';

function fakePool(query, state = {}) {
  const handlers = {};
  return {
    options: { max: 2 },
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    ...state,
    on(event, fn) {
      handlers[event] = fn;
    },
    emit(event, arg) {
      handlers[event]?.(arg);
    },
    query,
  };
}

const pgError = (code, message) => Object.assign(new Error(message), { code, severity: 'ERROR' });

test('operation names are low-cardinality and never contain SQL values', () => {
  assert.equal(operationName('SELECT id, email FROM users WHERE email = $1 LIMIT 1'), 'select_users');
  assert.equal(operationName('\n  UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1'), 'update_refresh_tokens');
  assert.equal(operationName('INSERT INTO messages (channel_id, content) VALUES ($1, $2)'), 'insert_messages');
  assert.equal(operationName({ text: 'DELETE FROM server_bans WHERE server_id = $1' }), 'delete_server_bans');
  assert.equal(operationName('SELECT 1'), 'select');
  assert.equal(operationName("DROP TABLE users; -- 'bob@example.com'"), 'other');
});

test('failed queries log a sanitized database_operation_failed once, without SQL or parameters', async () => {
  const pool = instrumentPool(
    fakePool(async () => {
      throw pgError('57014', 'canceling statement due to statement timeout');
    }),
    { slowQueryMs: 1000 }
  );
  const cap = captureLogs();
  const err = await pool.query('SELECT * FROM users WHERE email = $1', ['bob@example.com']).catch((e) => e);
  cap.restore();

  assert.equal(cap.lines.length, 1);
  const [line] = cap.lines;
  assert.equal(line.event, 'database_operation_failed');
  assert.equal(line.database_system, 'postgresql');
  assert.equal(line.operation, 'select_users');
  assert.equal(line.error_code, 'DB_TIMEOUT');
  assert.equal(line.retryable, true);
  assert.equal(typeof line.duration_ms, 'number');
  assert.ok(isLogged(err), 'upper layers must not log it again');
  assert.ok(!cap.text().includes('bob@example.com'));
  assert.ok(!cap.text().includes('WHERE email'));
});

test('constraint violations are counted but left to the caller (not logged here)', async () => {
  const before = await counterValue(metrics.dbErrors, { error_code: 'DB_UNIQUE_VIOLATION' });
  const pool = instrumentPool(
    fakePool(async () => {
      throw pgError('23505', 'duplicate key value violates unique constraint "uq_users_username_discriminator"');
    }),
    { slowQueryMs: 1000 }
  );
  const cap = captureLogs();
  const err = await pool.query('INSERT INTO users (username) VALUES ($1)', ['bob']).catch((e) => e);
  cap.restore();

  assert.equal(cap.lines.length, 0);
  assert.equal(isLogged(err), false);
  assert.equal(await counterValue(metrics.dbErrors, { error_code: 'DB_UNIQUE_VIOLATION' }), before + 1);
});

test('slow queries above the configured threshold are logged as warnings', async () => {
  const pool = instrumentPool(
    fakePool(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { rows: [] };
    }),
    { slowQueryMs: 20 }
  );
  const cap = captureLogs();
  await pool.query('SELECT * FROM messages WHERE channel_id = $1', ['c1']);
  cap.restore();

  assert.equal(cap.lines[0].event, 'database_query_slow');
  assert.equal(cap.lines[0].level, 'warn');
  assert.equal(cap.lines[0].operation, 'select_messages');
  assert.equal(cap.lines[0].threshold_ms, 20);
});

test('pool exhaustion and idle client errors are reported', async () => {
  const pool = instrumentPool(fakePool(async () => ({ rows: [] }), { totalCount: 2, idleCount: 0, waitingCount: 3 }), {
    slowQueryMs: 1000,
  });
  const cap = captureLogs();
  await pool.query('SELECT 1');
  pool.emit('error', pgError('57P01', 'terminating connection due to administrator command'));
  cap.restore();

  const exhausted = cap.lines.find((l) => l.event === 'database_pool_exhausted');
  assert.equal(exhausted.pool_waiting, 3);
  const idle = cap.lines.find((l) => l.event === 'database_connection_error');
  assert.equal(idle.error_code, 'DB_UNAVAILABLE');
  assert.equal(idle.level, 'error');
});
