// Instrumentação do Socket.IO: contexto por conexão/evento, ciclo de vida,
// erro de handler capturado num lugar só. Nunca loga payload de evento
// (mensagem, SDP/ICE/DTLS, parâmetros RTP) - só nome do evento, IDs e estado.
import { env } from '../config/env.js';
import { logger, runWithContext, shouldLog, scrubString } from './logger.js';
import { metrics } from './metrics.js';
import { classifyError, logError, GENERIC_PUBLIC_MESSAGE } from './errors.js';
import { normalizeIp } from './http.js';

const CLOSE_REASONS = new Set([
  'io server disconnect',
  'io client disconnect',
  'ping timeout',
  'transport close',
  'transport error',
  'parse error',
  'forced close',
  'forced server close',
  'server namespace disconnect',
  'client namespace disconnect',
  'server shutting down',
]);

// Mesma regra do Express com `trust proxy` = N saltos: o IP do cliente é o
// N-ésimo da direita no X-Forwarded-For (o resto pode ter sido forjado).
export function socketClientIp(socket) {
  const hops = env.TRUST_PROXY;
  const forwarded = socket.handshake?.headers?.['x-forwarded-for'];
  if (hops && typeof forwarded === 'string') {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) return normalizeIp(parts[Math.max(parts.length - hops, 0)]);
  }
  return normalizeIp(socket.handshake?.address);
}

export function logSocketAuthFailure(socket, reason) {
  metrics.wsAuthFailures.inc({ reason });
  metrics.securityEvents.inc({ event: 'websocket_authentication_failed', outcome: 'failure' });
  const gate = shouldLog(`websocket_authentication_failed:${reason}`);
  if (!gate) return;
  logger[reason === 'token_expired' ? 'info' : 'warn'](
    {
      ...gate,
      event: 'websocket_authentication_failed',
      connection_id: socket.id,
      reason_code: reason,
      auth_method: 'jwt',
      outcome: 'failure',
      security_relevant: true,
      source_ip: socketClientIp(socket),
    },
    'WebSocket authentication failed'
  );
}

// Chamar no início do io.on('connection'), ANTES de registrar os handlers.
export function instrumentConnection(socket) {
  const base = { connection_id: socket.id, user_id: socket.data.user?.id, source_ip: socketClientIp(socket) };
  const openedAt = Date.now();

  // Todo socket.on() daqui pra frente roda dentro do contexto da conexão e
  // tem erro capturado: antes, um await rejeitado fora de try num handler
  // async virava unhandledRejection e derrubava o processo inteiro.
  const on = socket.on.bind(socket);
  socket.on = (event, handler) =>
    on(event, (...args) =>
      runWithContext({ ...base, websocket_event: event }, async () => {
        try {
          await handler(...args);
        } catch (err) {
          metrics.wsHandlerErrors.inc({ event, error_code: classifyError(err).error_code });
          logError('websocket_handler_failed', err, {}, 'WebSocket handler failed');
          const ack = args[args.length - 1];
          // socket.io ignora um segundo ack, então é seguro mesmo que o handler já tenha respondido.
          if (typeof ack === 'function') ack({ error: GENERIC_PUBLIC_MESSAGE });
        }
      })
    );

  // Evento sem handler: continua ignorado (como antes), agora contado.
  socket.use(([event], next) => {
    if (socket.listenerCount(event) === 0) {
      metrics.wsRejected.inc({ reason: 'unknown_event' });
      const gate = shouldLog('websocket_message_rejected:unknown_event');
      if (gate) {
        logger.warn(
          { ...base, ...gate, event: 'websocket_message_rejected', reason_code: 'unknown_event', websocket_event: scrubString(String(event), 64) },
          'WebSocket message rejected'
        );
      }
    }
    next();
  });

  metrics.wsOpened.inc();
  metrics.wsActive.inc();
  logger.debug({ ...base, event: 'websocket_authentication_succeeded', auth_method: 'jwt', outcome: 'success' }, 'WebSocket authenticated');
  logger.info({ ...base, event: 'websocket_connection_opened', transport: socket.conn?.transport?.name }, 'WebSocket connection opened');

  socket.on('disconnect', (reason) => {
    const closeReason = CLOSE_REASONS.has(reason) ? reason.replace(/ /g, '_') : 'other';
    metrics.wsActive.dec();
    metrics.wsClosed.inc({ reason: closeReason });
    logger.info(
      { event: 'websocket_connection_closed', close_reason: closeReason, duration_ms: Date.now() - openedAt },
      'WebSocket connection closed'
    );
  });
}

// Flood de mensagens por socket (chat/DM) - contado sempre, logado com limite.
export function logSocketRateLimited(limiter) {
  metrics.rateLimited.inc({ limiter });
  const gate = shouldLog(`websocket_rate_limit_exceeded:${limiter}`);
  if (gate) {
    logger.warn(
      { ...gate, event: 'websocket_rate_limit_exceeded', limiter, outcome: 'denied', security_relevant: true },
      'WebSocket rate limit exceeded'
    );
  }
}
