import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, classifyError, GENERIC_PUBLIC_MESSAGE } from '../src/observability/errors.js';

const pgError = (code, message = 'x-internal-detail') => Object.assign(new Error(message), { code, severity: 'ERROR' });

test('PostgreSQL errors map to stable codes with retryable flag', () => {
  const cases = [
    [pgError('23505'), 'DB_UNIQUE_VIOLATION', false],
    [pgError('23503'), 'DB_FOREIGN_KEY_VIOLATION', false],
    [pgError('40P01'), 'DB_DEADLOCK', true],
    [pgError('40001'), 'DB_SERIALIZATION_FAILURE', true],
    [pgError('57014', 'canceling statement due to statement timeout'), 'DB_TIMEOUT', true],
    [pgError('53300'), 'DB_TOO_MANY_CONNECTIONS', true],
    [pgError('08006'), 'DB_CONNECTION_ERROR', true],
    [new Error('timeout exceeded when trying to connect'), 'DB_POOL_TIMEOUT', true, 'db'],
    [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }), 'DB_CONNECTION_ERROR', true, 'db'],
  ];
  for (const [err, code, retryable, dependency] of cases) {
    const c = classifyError(err, dependency);
    assert.equal(c.error_code, code, `${err.code ?? err.message}`);
    assert.equal(c.retryable, retryable, code);
    assert.ok(c.status >= 500, code);
    assert.ok(!c.public_message.includes('x-internal-detail'));
  }
});

test('Redis errors map to stable codes', () => {
  const reply = Object.assign(new Error('WRONGTYPE Operation against a key'), { name: 'ReplyError' });
  assert.equal(classifyError(reply, 'redis').error_code, 'REDIS_COMMAND_ERROR');
  assert.equal(classifyError(new Error('Command timed out'), 'redis').error_code, 'REDIS_TIMEOUT');
  assert.equal(classifyError(new Error('Connection is closed.'), 'redis').error_code, 'REDIS_UNAVAILABLE');
  const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  assert.equal(classifyError(refused, 'redis').error_code, 'REDIS_UNAVAILABLE');
  assert.equal(classifyError(refused, 'redis').retryable, true);
});

test('client-caused errors are expected (no stack) with 4xx status', () => {
  const expired = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
  assert.deepEqual(
    [classifyError(expired).error_code, classifyError(expired).status, classifyError(expired).expected],
    ['TOKEN_EXPIRED', 401, true]
  );
  const badJson = Object.assign(new Error('Unexpected end of JSON input'), { type: 'entity.parse.failed', status: 400, expose: true });
  assert.equal(classifyError(badJson).error_code, 'INVALID_JSON');
  assert.equal(classifyError(badJson).status, 400);
  const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413, expose: true });
  assert.equal(classifyError(tooLarge).error_code, 'PAYLOAD_TOO_LARGE');
});

test('AppError carries code, status, retryable flag and a safe public message', () => {
  const cause = new Error('upstream said: password=hunter2');
  const err = new AppError('DEPENDENCY_UNAVAILABLE', { status: 503, retryable: true, publicMessage: 'Tente novamente.', cause });
  const c = classifyError(err);
  assert.deepEqual(c, {
    error_code: 'DEPENDENCY_UNAVAILABLE',
    status: 503,
    retryable: true,
    expected: false,
    public_message: 'Tente novamente.',
  });
  assert.equal(err.cause, cause);
});

test('unknown errors never expose internals to the client', () => {
  const c = classifyError(new Error('ENOENT: /srv/navespeak/secret/path'));
  assert.equal(c.error_code, 'INTERNAL_ERROR');
  assert.equal(c.status, 500);
  assert.equal(c.public_message, GENERIC_PUBLIC_MESSAGE);
});
