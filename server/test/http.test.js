import { captureLogs } from './helpers.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { z } from 'zod';
import { requestContext, metricsHandler } from '../src/observability/http.js';
import { logger } from '../src/observability/logger.js';
import { register } from '../src/observability/metrics.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { validateBody } from '../src/middleware/validate.js';
import { requireAuth } from '../src/middleware/auth.js';

const UUID = '5f0c8a4e-2b7d-4c1e-9a3f-0d6b1e2c3a4b';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
let server;
let baseUrl;

before(async () => {
  // Mesma ordem de middlewares do src/index.js.
  const app = express();
  app.use(requestContext);
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/metrics', metricsHandler);
  app.use(express.json());

  const items = express.Router();
  items.get('/:itemId', async (req, res) => {
    logger.info({ event: 'item_lookup_started' }, 'Item lookup started');
    await new Promise((resolve) => setTimeout(resolve, 2));
    logger.info({ event: 'item_lookup_finished' }, 'Item lookup finished');
    res.json({ ok: true });
  });
  items.get('/:itemId/boom', async (req, res, next) => {
    try {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    } catch (err) {
      next(err);
    }
  });
  items.post('/', validateBody(z.object({ name: z.string().min(3), password: z.string().min(20) })), (req, res) =>
    res.status(201).json({})
  );
  app.use('/api/items', items);

  // Mount com parâmetro, igual a /api/rooms/:roomId/channels no index.js.
  const channels = express.Router({ mergeParams: true });
  channels.use((req, res, next) => (req.get('x-deny') ? res.status(403).json({ error: 'nope' }) : next()));
  channels.get('/:channelId', (req, res) => res.json({ ok: true }));
  app.use('/api/rooms/:roomId/channels', channels);

  app.get('/api/private', requireAuth, (req, res) => res.json({}));
  app.use(notFoundHandler);
  app.use(errorHandler);

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('request id is generated, returned and shared by every log of the request; query string never logged', async () => {
  const cap = captureLogs();
  const res = await fetch(`${baseUrl}/api/items/${UUID}?email=bob@example.com&token=SECRET-query-token`);
  const requestId = res.headers.get('x-request-id');
  const access = await cap.waitFor((l) => l.event === 'http_request' && l.request_id === requestId);
  cap.restore();

  assert.equal(res.status, 200);
  assert.match(requestId, /^req-[0-9a-f-]{36}$/);
  const requestLines = cap.lines.filter((l) => l.request_id === requestId);
  assert.deepEqual(
    requestLines.map((l) => l.event),
    ['item_lookup_started', 'item_lookup_finished', 'http_request']
  );
  assert.equal(new Set(requestLines.map((l) => l.trace_id)).size, 1);
  assert.equal(access.http_route, '/api/items/:itemId');
  assert.equal(access.http_method, 'GET');
  assert.equal(access.http_status_code, 200);
  assert.equal(access.outcome, 'success');
  assert.equal(typeof access.duration_ms, 'number');
  const text = cap.text();
  assert.ok(!text.includes('SECRET-query-token'));
  assert.ok(!text.includes('bob@example.com'));
  assert.ok(!text.includes(UUID), 'raw ids never go into the route');
});

test('well-formed incoming request ids are accepted; malformed ones are replaced', async () => {
  const cap = captureLogs();
  const good = await fetch(`${baseUrl}/api/items/${UUID}`, { headers: { 'x-request-id': 'edge-proxy-1234abcd' } });
  const bad = await fetch(`${baseUrl}/api/items/${UUID}`, { headers: { 'x-request-id': 'bad id {"level":"fatal"}' } });
  await cap.waitFor((l) => l.event === 'http_request' && l.request_id === bad.headers.get('x-request-id'));
  cap.restore();

  assert.equal(good.headers.get('x-request-id'), 'edge-proxy-1234abcd');
  assert.match(bad.headers.get('x-request-id'), /^req-/);
  assert.ok(!cap.text().includes('"level":"fatal"'));
});

test('W3C traceparent is preserved as trace_id', async () => {
  const cap = captureLogs();
  const res = await fetch(`${baseUrl}/api/items/${UUID}`, {
    headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
  });
  const access = await cap.waitFor((l) => l.event === 'http_request' && l.request_id === res.headers.get('x-request-id'));
  cap.restore();

  assert.equal(access.trace_id, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(access.parent_span_id, '00f067aa0ba902b7');
  assert.match(access.span_id, /^[0-9a-f]{16}$/);
  assert.notEqual(access.span_id, '00f067aa0ba902b7');
});

test('internal errors: generic public body with request id, stack in the log, no secrets anywhere', async () => {
  const cap = captureLogs();
  const res = await fetch(`${baseUrl}/api/items/${UUID}/boom`);
  const body = await res.json();
  const access = await cap.waitFor((l) => l.event === 'internal_error');
  cap.restore();

  assert.equal(res.status, 500);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'requestId']);
  assert.equal(body.error, 'Erro interno do servidor.');
  assert.equal(body.requestId, res.headers.get('x-request-id'));
  assert.ok(!JSON.stringify(body).includes('ECONNREFUSED'));

  assert.equal(access.level, 'error');
  assert.equal(access.error_code, 'INTERNAL_ERROR');
  assert.equal(access.http_route, '/api/items/:itemId/boom', 'route pattern survives next(err)');
  assert.match(access.error.stack, /ECONNREFUSED/);
  assert.equal(cap.lines.filter((l) => l.request_id === body.requestId).length, 1, 'error logged once');
  assert.ok(!cap.text().includes('hunter2'));
});

test('validation failures are info-level and log field names, never values', async () => {
  const cap = captureLogs();
  const res = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x', password: 'SECRET-too-short' }),
  });
  const access = await cap.waitFor((l) => l.event === 'validation_failed');
  cap.restore();

  assert.equal(res.status, 400);
  assert.equal(access.level, 'info');
  assert.equal(access.outcome, 'invalid_request');
  assert.deepEqual(access.validation_fields.sort(), ['name', 'password']);
  assert.ok(!cap.text().includes('SECRET-too-short'));
});

test('malformed JSON is a validation failure without stack trace', async () => {
  const cap = captureLogs();
  const res = await fetch(`${baseUrl}/api/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":' });
  const body = await res.json();
  const access = await cap.waitFor((l) => l.event === 'validation_failed' && l.reason_code === 'invalid_json');
  cap.restore();

  assert.equal(res.status, 400);
  assert.equal(body.error, 'Dados inválidos.');
  assert.equal(access.error.stack, undefined);
});

test('authentication failures are classified and never log the token', async () => {
  const cap = captureLogs();
  await fetch(`${baseUrl}/api/private`);
  await fetch(`${baseUrl}/api/private`, { headers: { authorization: 'Bearer SECRET-garbage-token' } });
  const missing = await cap.waitFor((l) => l.event === 'authentication_required' && l.reason_code === 'missing_token');
  const invalid = await cap.waitFor((l) => l.event === 'authentication_required' && l.reason_code === 'token_invalid');
  cap.restore();

  assert.equal(missing.level, 'info');
  assert.equal(missing.outcome, 'denied');
  assert.equal(invalid.level, 'warn');
  assert.equal(invalid.security_relevant, true);
  assert.ok(!cap.text().includes('SECRET-garbage-token'));
});

test('unknown paths are bucketed and health probes produce no log lines', async () => {
  const cap = captureLogs();
  const res = await fetch(`${baseUrl}/wp-admin/setup-config-${Date.now()}.php`);
  const notFound = await cap.waitFor((l) => l.event === 'not_found');
  for (let i = 0; i < 10; i += 1) await fetch(`${baseUrl}/health/live`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  cap.restore();

  assert.equal(res.status, 404);
  assert.equal(notFound.http_route, 'unmatched');
  assert.equal(cap.lines.filter((l) => String(l.http_route).startsWith('/health')).length, 0);
});

test('routes mounted with parameters are normalized to their pattern', async () => {
  const channelId = '9b2e7c1d-3f4a-4b5c-8d6e-7f8a9b0c1d2e';
  const cap = captureLogs();
  const ok = await fetch(`${baseUrl}/api/rooms/${UUID}/channels/${channelId}`);
  const denied = await fetch(`${baseUrl}/api/rooms/${UUID}/channels/${channelId}`, { headers: { 'x-deny': '1' } });
  const okLog = await cap.waitFor((l) => l.request_id === ok.headers.get('x-request-id') && l.http_status_code);
  const deniedLog = await cap.waitFor((l) => l.request_id === denied.headers.get('x-request-id') && l.http_status_code);
  cap.restore();

  assert.equal(okLog.http_route, '/api/rooms/:roomId/channels/:channelId');
  assert.equal(deniedLog.http_route, '/api/rooms/:roomId/channels/*');
  assert.equal(deniedLog.event, 'authorization_denied');
  assert.ok(!cap.text().includes(UUID));
});

test('metrics use normalized routes and no high-cardinality labels', async () => {
  await fetch(`${baseUrl}/api/items/${UUID}`);
  await fetch(`${baseUrl}/nope/${UUID}`);
  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.equal(res.status, 200);
  assert.match(text, /http_requests_total\{method="GET",route="\/api\/items\/:itemId",status_code="200"\}/);
  assert.match(text, /route="unmatched"/);

  const forbiddenLabels = new Set(['user_id', 'room_id', 'channel_id', 'connection_id', 'session_id', 'request_id', 'trace_id', 'url', 'path', 'message', 'ip']);
  for (const metric of await register.getMetricsAsJSON()) {
    for (const value of metric.values) {
      for (const [label, labelValue] of Object.entries(value.labels ?? {})) {
        assert.ok(!forbiddenLabels.has(label), `${metric.name} uses forbidden label ${label}`);
        assert.ok(!UUID_PATTERN.test(String(labelValue)), `${metric.name}{${label}} holds a raw id`);
      }
    }
  }
});
