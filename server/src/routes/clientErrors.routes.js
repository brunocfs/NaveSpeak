// Coleta de erros/estados relevantes do client web (ErrorBoundary, HTTP 5xx,
// WebSocket, WebRTC - ver client/src/observability/telemetry.js). Autenticada,
// com rate limit por usuário e schema FECHADO: nada de conteúdo de formulário,
// token, mensagem, estado da aplicação ou payload livre - só campos curtos e
// enumerados. O texto do erro ainda passa pela redaction central do logger.
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { clientErrorsRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';
import { REQUEST_ID_PATTERN } from '../observability/http.js';

const shortToken = (max) => z.string().max(max).regex(/^[\w.:-]+$/);
const routePattern = z.string().max(200).regex(/^[\w/:.-]*$/);

const clientEventSchema = z
  .object({
    event: z.enum([
      'client_render_error',
      'client_unhandled_error',
      'client_http_error',
      'client_websocket_error',
      'webrtc_ice_connection_state_changed',
      'webrtc_peer_connection_failed',
      'webrtc_reconnect_attempted',
    ]),
    message: z.string().max(300).optional(),
    error_code: shortToken(64).optional(),
    http_status: z.number().int().min(0).max(599).optional(),
    http_route: routePattern.optional(),
    request_id: z.string().regex(REQUEST_ID_PATTERN).optional(),
    state: shortToken(32).optional(),
    transport_direction: z.enum(['send', 'recv']).optional(),
    page: routePattern.optional(),
    occurrences: z.number().int().min(1).max(10_000).optional(),
    app_version: z.string().max(32).regex(/^[\w.+-]+$/),
    browser: z.enum(['chrome', 'edge', 'firefox', 'safari', 'electron', 'other']),
    os: z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'other']),
  })
  .strict();

const INFO_EVENTS = new Set(['webrtc_reconnect_attempted', 'webrtc_ice_connection_state_changed']);

const router = Router();

router.post('/', requireAuth, clientErrorsRateLimiter, validateBody(clientEventSchema), (req, res) => {
  const { event, message, request_id: relatedRequestId, ...fields } = req.body;
  metrics.clientEvents.inc({ event });
  logger[INFO_EVENTS.has(event) ? 'info' : 'warn'](
    // request_id do log continua sendo o DESTA requisição; o que o client
    // mandou é o da chamada que falhou lá atrás.
    { ...fields, event, source: 'client', client_message: message, related_request_id: relatedRequestId },
    'Client event reported'
  );
  res.status(204).end();
});

export default router;
