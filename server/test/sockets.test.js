import { captureLogs, counterValue } from './helpers.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { instrumentConnection, logSocketAuthFailure } from '../src/observability/sockets.js';
import { logger } from '../src/observability/logger.js';
import { metrics } from '../src/observability/metrics.js';

let httpServer;
let io;
let url;

before(async () => {
  httpServer = createServer();
  io = new Server(httpServer);
  // Mesmo formato do handshake real (sockets/index.js), sem banco.
  io.use((socket, next) => {
    if (socket.handshake.auth?.token !== 'valid-test-token') {
      logSocketAuthFailure(socket, 'token_invalid');
      return next(new Error('unauthorized'));
    }
    socket.data.user = { id: 'user-test-1' };
    return next();
  });
  io.on('connection', (socket) => {
    instrumentConnection(socket);
    socket.on('media:connectTransport', async (payload, ack) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info({ event: 'transport_connect_handled' }, 'Transport connect handled');
      ack({ ok: true });
    });
    socket.on('media:produce', async () => {
      throw new Error('mediasoup internal failure');
    });
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  url = `http://127.0.0.1:${httpServer.address().port}`;
});

after(() => {
  io.close();
});

async function connect(token) {
  const client = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  await Promise.race([once(client, 'connect'), once(client, 'connect_error')]);
  return client;
}

const SIGNALING_PAYLOAD = {
  channelId: 'c0ffee00-0000-4000-8000-000000000000',
  dtlsParameters: { role: 'client', fingerprints: [{ algorithm: 'sha-256', value: 'AB:CD:SECRET-FINGERPRINT' }] },
  iceParameters: { usernameFragment: 'SECRET-UFRAG', password: 'SECRET-ICE-PASSWORD' },
  iceCandidates: [{ ip: '198.51.100.7', port: 40000 }],
  sdp: 'v=0 SECRET-SDP',
  content: 'SECRET-CHAT-MESSAGE',
};

test('handlers run with connection context and payloads (SDP/ICE/DTLS/messages) never reach the logs', async () => {
  const cap = captureLogs();
  const client = await connect('valid-test-token');
  const reply = await client.timeout(2000).emitWithAck('media:connectTransport', SIGNALING_PAYLOAD);
  const handled = await cap.waitFor((l) => l.event === 'transport_connect_handled');
  const opened = await cap.waitFor((l) => l.event === 'websocket_connection_opened');
  client.disconnect();
  const closed = await cap.waitFor((l) => l.event === 'websocket_connection_closed');
  cap.restore();

  assert.deepEqual(reply, { ok: true });
  assert.equal(opened.connection_id, client.id ?? handled.connection_id);
  assert.equal(handled.connection_id, opened.connection_id);
  assert.equal(handled.user_id, 'user-test-1');
  assert.equal(handled.websocket_event, 'media:connectTransport');
  assert.equal(closed.connection_id, opened.connection_id);
  assert.equal(closed.close_reason, 'client_namespace_disconnect');
  assert.equal(typeof closed.duration_ms, 'number');
  assert.doesNotMatch(cap.text(), /SECRET-|198\.51\.100\.7/);
});

test('a throwing handler is logged with stack, acked with a generic error and does not crash the process', async () => {
  const before = await counterValue(metrics.wsHandlerErrors, { event: 'media:produce', error_code: 'INTERNAL_ERROR' });
  const cap = captureLogs();
  const client = await connect('valid-test-token');
  const reply = await client.timeout(2000).emitWithAck('media:produce', SIGNALING_PAYLOAD);
  const failure = await cap.waitFor((l) => l.event === 'websocket_handler_failed');
  client.disconnect();
  cap.restore();

  assert.deepEqual(reply, { error: 'Erro interno do servidor.' });
  assert.equal(failure.level, 'error');
  assert.equal(failure.websocket_event, 'media:produce');
  assert.match(failure.error.stack, /mediasoup internal failure/);
  assert.equal(await counterValue(metrics.wsHandlerErrors, { event: 'media:produce', error_code: 'INTERNAL_ERROR' }), before + 1);
  assert.doesNotMatch(cap.text(), /SECRET-/);
});

test('unknown events are counted and logged without their payload', async () => {
  const cap = captureLogs();
  const client = await connect('valid-test-token');
  client.emit('admin:dropDatabase', { token: 'SECRET-EVIL', note: 'SECRET-NOTE' });
  const rejected = await cap.waitFor((l) => l.event === 'websocket_message_rejected');
  client.disconnect();
  cap.restore();

  assert.equal(rejected.reason_code, 'unknown_event');
  assert.equal(rejected.websocket_event, 'admin:dropDatabase');
  assert.doesNotMatch(cap.text(), /SECRET-/);
});

test('handshake authentication failures are logged without the token', async () => {
  const cap = captureLogs();
  const client = await connect('SECRET-forged-token');
  const failure = await cap.waitFor((l) => l.event === 'websocket_authentication_failed');
  client.close();
  cap.restore();

  assert.equal(client.connected, false);
  assert.equal(failure.reason_code, 'token_invalid');
  assert.equal(failure.security_relevant, true);
  assert.equal(failure.source_ip, '127.0.0.1');
  assert.doesNotMatch(cap.text(), /SECRET-/);
});
