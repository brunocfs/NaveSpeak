// Métricas Prometheus (prom-client). Regra de ouro: labels só com valores de
// um conjunto FECHADO e pequeno (rota normalizada, método, status, código de
// erro estável, nome de comando). Nunca user_id, room_id, connection_id, URL
// completa ou texto de mensagem - isso explode a cardinalidade da série
// temporal (ver docs/observability.md#métricas e test/metrics.test.js).
import client from 'prom-client';

export const register = client.register;

// CPU, memória, heap, event loop lag, GC, handles, process_start_time_seconds
// (reinícios = changes(process_start_time_seconds[1h]) no PromQL).
client.collectDefaultMetrics({ register });

const counter = (name, help, labelNames = []) => new client.Counter({ name, help, labelNames });
const gauge = (name, help, labelNames = []) => new client.Gauge({ name, help, labelNames });
const histogram = (name, help, labelNames, buckets) => new client.Histogram({ name, help, labelNames, buckets });

export const metrics = {
  httpRequests: counter('http_requests_total', 'HTTP requests completed', ['method', 'route', 'status_code']),
  httpDuration: histogram(
    'http_request_duration_seconds',
    'HTTP request duration',
    ['method', 'route', 'status_code'],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ),
  httpInFlight: gauge('http_requests_in_flight', 'HTTP requests in progress'),

  wsActive: gauge('websocket_connections_active', 'Open WebSocket connections'),
  wsOpened: counter('websocket_connections_opened_total', 'WebSocket connections opened'),
  wsClosed: counter('websocket_connections_closed_total', 'WebSocket connections closed', ['reason']),
  wsAuthFailures: counter('websocket_auth_failures_total', 'WebSocket handshake authentication failures', ['reason']),
  wsRejected: counter('websocket_messages_rejected_total', 'WebSocket messages rejected', ['reason']),
  wsHandlerErrors: counter('websocket_handler_errors_total', 'WebSocket handler failures', ['event', 'error_code']),

  voiceSessionsActive: gauge('voice_sessions_active', 'Active voice sessions (peers connected to a media room)'),
  voiceRoomsActive: gauge('voice_rooms_active', 'Active mediasoup rooms'),
  voiceSessionDuration: histogram(
    'voice_session_duration_seconds',
    'Voice session duration',
    ['reason'],
    [10, 60, 300, 900, 1800, 3600, 7200, 14400]
  ),
  voiceJoinDenied: counter('voice_join_denied_total', 'Voice room joins denied', ['reason']),
  webrtcStateChanges: counter('webrtc_transport_state_changes_total', 'Server-side WebRTC transport state changes', ['type', 'state']),
  webrtcFailures: counter('webrtc_failures_total', 'WebRTC negotiation/transport failures', ['stage']),

  dbDuration: histogram(
    'db_query_duration_seconds',
    'PostgreSQL query duration',
    ['operation'],
    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
  ),
  dbErrors: counter('db_errors_total', 'PostgreSQL errors', ['error_code']),
  dbPoolExhausted: counter('db_pool_exhausted_total', 'Queries issued while the PostgreSQL pool had no idle client'),

  redisDuration: histogram(
    'redis_command_duration_seconds',
    'Redis command duration',
    ['command'],
    [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1]
  ),
  redisErrors: counter('redis_errors_total', 'Redis errors', ['client', 'error_code']),
  redisReconnects: counter('redis_reconnects_total', 'Redis reconnection attempts', ['client']),
  redisUp: gauge('redis_connection_up', '1 when the Redis client is ready', ['client']),
  cacheRequests: counter('cache_requests_total', 'Cache lookups', ['cache', 'result']),

  securityEvents: counter('security_events_total', 'Security/audit events', ['event', 'outcome']),
  rateLimited: counter('rate_limit_exceeded_total', 'Requests/messages blocked by rate limiting', ['limiter']),
  clientEvents: counter('client_events_total', 'Error/state events reported by the web client', ['event']),
  healthStatus: gauge('health_check_status', '1 = dependency check passing', ['check']),
};
