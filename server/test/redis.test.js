import { captureLogs, counterValue } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { instrumentRedis } from '../src/config/redis.js';
import { metrics } from '../src/observability/metrics.js';

function fakeClient(name) {
  const client = new EventEmitter();
  client.sendCommand = (command) => command.promise;
  return instrumentRedis(client, name);
}

test('connection state is logged only on transitions', () => {
  const client = fakeClient('test_transitions');
  const cap = captureLogs();
  client.emit('ready');
  client.emit('close');
  client.emit('close'); // já estava fora - não repete
  client.emit('ready');
  cap.restore();

  assert.deepEqual(
    cap.lines.map((l) => l.event),
    ['redis_connected', 'redis_connection_lost', 'redis_connection_restored']
  );
});

test('repeated connection errors are rate limited in logs but fully counted', async () => {
  const client = fakeClient('test_flood');
  const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });
  const cap = captureLogs();
  for (let i = 0; i < 25; i += 1) client.emit('error', refused());
  cap.restore();

  assert.ok(cap.lines.length <= 5);
  assert.equal(cap.lines[0].event, 'redis_connection_error');
  assert.equal(cap.lines[0].error_code, 'REDIS_UNAVAILABLE');
  assert.equal(await counterValue(metrics.redisErrors, { client: 'test_flood', error_code: 'REDIS_UNAVAILABLE' }), 25);
});

test('failed commands log only the command name, never keys or values', async () => {
  const client = fakeClient('test_commands');
  const cap = captureLogs();
  const command = {
    name: 'GET',
    args: ['session:SECRET-session-key'],
    promise: Promise.reject(new Error('Command timed out')),
  };
  await client.sendCommand(command).catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  cap.restore();

  // CLIENT SETINFO recusado por Redis antigo (enviado pelo próprio ioredis) não é ruído de log.
  const setinfo = { name: 'client', args: ['SETINFO', 'lib-name', 'ioredis'], promise: Promise.reject(Object.assign(new Error('ERR Syntax error'), { name: 'ReplyError' })) };
  await client.sendCommand(setinfo).catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cap.lines.filter((l) => l.operation === 'client').length, 0);

  const line = cap.lines.find((l) => l.event === 'redis_command_failed');
  assert.equal(line.operation, 'get');
  assert.equal(line.error_code, 'REDIS_TIMEOUT');
  assert.equal(line.retryable, true);
  assert.ok(!cap.text().includes('SECRET-session-key'));
});
