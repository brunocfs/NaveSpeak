import { captureLogs } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessCheck } from '../src/observability/health.js';
import { onShutdown, shutdown, isShuttingDown } from '../src/observability/shutdown.js';

test('readiness logs only state transitions, not every probe', async () => {
  let dbUp = true;
  let redisUp = true;
  const readiness = createReadinessCheck(
    {
      database: { essential: true, run: async () => { if (!dbUp) throw new Error('db down'); } },
      // Redis fora do ar com offline queue = comando pendurado -> timeout.
      redis: { essential: false, run: () => (redisUp ? Promise.resolve() : new Promise(() => {})) },
    },
    { timeoutMs: 30 }
  );

  const cap = captureLogs();
  const first = await readiness();
  for (let i = 0; i < 10; i += 1) await readiness();
  redisUp = false;
  const degraded = await readiness();
  await readiness();
  dbUp = false;
  const unavailable = await readiness();
  await readiness();
  cap.restore();

  assert.deepEqual([first.ready, first.status], [true, 'ok']);
  assert.deepEqual([degraded.ready, degraded.status], [true, 'degraded']);
  assert.equal(degraded.checks.redis.error_code, 'HEALTH_CHECK_TIMEOUT');
  assert.deepEqual([unavailable.ready, unavailable.status], [false, 'unavailable']);
  assert.deepEqual(
    cap.lines.map((l) => [l.event, l.previous_status, l.new_status]),
    [
      ['readiness_changed', null, 'ok'],
      ['readiness_changed', 'ok', 'degraded'],
      ['readiness_changed', 'degraded', 'unavailable'],
    ]
  );
});

test('graceful shutdown closes connections and exporters in order, survives a failing step, and exits', async () => {
  const closed = [];
  const exporter = {
    forceFlush: async () => closed.push('exporter_flush'),
    shutdown: async () => closed.push('exporter_shutdown'),
  };
  onShutdown('socket_io', async () => closed.push('socket_io'));
  onShutdown('telemetry_exporter', async () => {
    await exporter.forceFlush();
    await exporter.shutdown();
  });
  onShutdown('postgres_pool', async () => {
    throw new Error('pool end failed');
  });
  onShutdown('redis', async () => closed.push('redis'));

  const exits = [];
  const cap = captureLogs();
  await shutdown({ reason: 'sigterm', exit: (code) => exits.push(code) });
  await shutdown({ reason: 'sigterm', exit: (code) => exits.push(code) }); // idempotente
  cap.restore();

  assert.equal(isShuttingDown(), true);
  assert.deepEqual(closed, ['socket_io', 'exporter_flush', 'exporter_shutdown', 'redis']);
  assert.deepEqual(exits, [1]);
  assert.deepEqual(
    cap.lines.map((l) => l.event),
    ['service_shutdown_started', 'service_shutdown_step_failed', 'service_shutdown_completed']
  );
  assert.equal(cap.lines[1].step, 'postgres_pool');
});
