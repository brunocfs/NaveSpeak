import { captureLogs, counterValue } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger, runWithContext, setContext, audit, shouldLog } from '../src/observability/logger.js';
import { metrics } from '../src/observability/metrics.js';
import { AppError } from '../src/observability/errors.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('every backend log line has timestamp, level, service, environment, version and event', () => {
  const cap = captureLogs();
  logger.info({ event: 'sample_event', duration_ms: 42 }, 'Sample');
  logger.warn('Log written without an event');
  cap.restore();

  assert.equal(cap.lines.length, 2);
  for (const line of cap.lines) {
    assert.match(line.timestamp, ISO_UTC);
    assert.ok(['info', 'warn'].includes(line.level));
    assert.equal(line.service, 'navespeak-api');
    assert.equal(line.environment, 'test');
    assert.equal(line.version, 'test-sha');
    assert.ok(line.event);
    assert.equal(typeof line.message, 'string');
  }
  assert.equal(cap.lines[0].duration_ms, 42);
  // Esquecer `event` não some com o log, mas fica fácil de achar e corrigir.
  assert.equal(cap.lines[1].event, 'unspecified_event');
});

test('sensitive keys are redacted at any depth, including media signaling fields', () => {
  const cap = captureLogs();
  logger.info(
    {
      event: 'redaction_check',
      password: 'SECRET-hunter2',
      newPassword: 'SECRET-new-pass',
      refresh_token: 'SECRET-refresh',
      accessToken: 'SECRET-access',
      headers: { authorization: 'SECRET-authz', cookie: 'refresh_token=SECRET-cookie' },
      nested: { deeper: { apiKey: 'SECRET-api-key', client_secret: 'SECRET-client' } },
      JWT_ACCESS_SECRET: 'SECRET-jwt-secret',
      customSecretField: 'SECRET-custom', // LOG_REDACT_PATHS
      iceParameters: { usernameFragment: 'SECRET-ufrag', password: 'SECRET-ice-pwd' },
      dtlsParameters: { fingerprints: [{ value: 'SECRET-fingerprint' }] },
      iceCandidates: [{ ip: '198.51.100.23' }],
      rtpParameters: { encodings: [{ ssrc: 'SECRET-ssrc' }] },
      sdp: 'SECRET-sdp',
      content: 'SECRET-private-chat',
      fileData: 'SECRET-base64',
      safe_field: 'visible',
    },
    'Redaction check'
  );
  cap.restore();

  const text = cap.text();
  assert.doesNotMatch(text, /SECRET-|198\.51\.100\.23/);
  assert.equal(cap.lines[0].password, '[REDACTED]');
  assert.equal(cap.lines[0].nested.deeper.apiKey, '[REDACTED]');
  assert.equal(cap.lines[0].safe_field, 'visible');
});

test('secrets embedded inside free-text values are masked', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ';
  const crlf = String.fromCharCode(13, 10);
  const sdpText = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 'a=candidate:1 1 udp 2122260223 192.0.2.44 54321 typ host'].join(crlf);
  const cap = captureLogs();
  logger.info(
    {
      event: 'string_scrub_check',
      detail: `token ${jwt} belongs to bob@example.com`,
      note: 'Authorization: Bearer abc.def.ghi',
      signaling: sdpText,
      ice_line: 'candidate:842163049 1 udp 1677729535 203.0.113.5 3478 typ srflx',
      upload: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      refresh_hash: 'a'.repeat(96),
      reason: 'login failed password=hunter2',
    },
    'String scrub check'
  );
  cap.restore();

  const text = cap.text();
  for (const secret of [jwt, 'bob@example.com', 'abc.def.ghi', '192.0.2.44', '203.0.113.5', 'iVBORw0KGgo', 'a'.repeat(96), 'hunter2']) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
});

test('log injection: user-controlled newlines and control characters cannot forge log lines', () => {
  const cap = captureLogs();
  const esc = String.fromCharCode(27);
  logger.info(
    { event: 'injection_check', username: `eve\n{"level":"fatal","event":"forged"}${esc}[31mred` },
    `User supplied ${esc}[2J message`
  );
  cap.restore();

  assert.equal(cap.raw.length, 1);
  assert.equal(cap.raw[0].trimEnd().split('\n').length, 1, 'one physical line per log entry');
  assert.equal(cap.lines[0].event, 'injection_check');
  assert.ok(!cap.lines[0].username.includes(esc));
  assert.ok(!cap.lines[0].message.includes(esc));
});

test('unexpected errors keep their stack trace; expected errors do not', () => {
  const cap = captureLogs();
  logger.error({ event: 'internal_error', error: new Error('database exploded') }, 'Unexpected failure');
  logger.warn({ event: 'validation_failed', error: new AppError('VALIDATION_FAILED', { status: 400 }) }, 'Expected failure');
  cap.restore();

  assert.equal(cap.lines[0].error.type, 'Error');
  assert.match(cap.lines[0].error.stack, /database exploded/);
  assert.equal(cap.lines[1].error.type, 'AppError');
  assert.equal(cap.lines[1].error.stack, undefined);
});

test('correlation context survives async boundaries and is enriched after authentication', async () => {
  const cap = captureLogs();
  await runWithContext({ request_id: 'req-test-00000001', trace_id: 'a'.repeat(32) }, async () => {
    logger.info({ event: 'before_auth' }, 'Before auth');
    setContext({ user_id: 'user-123' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    logger.info({ event: 'after_auth' }, 'After auth');
  });
  logger.info({ event: 'outside_request' }, 'Outside');
  cap.restore();

  const [before, after, outside] = cap.lines;
  assert.equal(before.request_id, 'req-test-00000001');
  assert.equal(before.user_id, undefined);
  assert.equal(after.request_id, 'req-test-00000001');
  assert.equal(after.user_id, 'user-123');
  assert.equal(outside.request_id, undefined);
});

test('shouldLog caps repetitive events per window and reports what was suppressed', async () => {
  const opts = { max: 2, windowMs: 30 };
  assert.deepEqual(shouldLog('test_flood', opts), { suppressed_count: 0 });
  assert.ok(shouldLog('test_flood', opts));
  assert.equal(shouldLog('test_flood', opts), null);
  assert.equal(shouldLog('test_flood', opts), null);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(shouldLog('test_flood', opts), { suppressed_count: 2 });
});

test('audit events are security relevant and counted', async () => {
  const before = await counterValue(metrics.securityEvents, { event: 'login_failed', outcome: 'failure' });
  const cap = captureLogs();
  audit('login_failed', { outcome: 'failure', reason_code: 'invalid_password', auth_method: 'password', user_id: 'user-9' });
  cap.restore();

  const [line] = cap.lines;
  assert.equal(line.event, 'login_failed');
  assert.equal(line.level, 'warn');
  assert.equal(line.security_relevant, true);
  assert.equal(line.outcome, 'failure');
  assert.equal(line.actor_type, 'anonymous');
  assert.equal(await counterValue(metrics.securityEvents, { event: 'login_failed', outcome: 'failure' }), before + 1);
});

test('the process keeps running when the log consumer (stdout pipe) goes away', async () => {
  const loggerUrl = pathToFileURL(new URL('../src/observability/logger.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
  const script = [
    `const { logger, flushLogs } = await import(${JSON.stringify(loggerUrl)});`,
    `for (let i = 0; i < 5000; i++) logger.info({ event: 'pipe_check', i }, 'Pipe check');`,
    `await new Promise((resolve) => setTimeout(resolve, 100));`,
    `flushLogs();`,
    `process.stderr.write('still-alive');`,
  ].join(' ');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LOG_LEVEL: 'info' },
  });
  child.stdout.destroy(); // coletor "caiu"
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0, stderr);
  assert.match(stderr, /still-alive/);
});
