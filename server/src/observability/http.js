// Correlação + access log + métricas HTTP. Um log por requisição, emitido no
// fim (evento específico conforme o resultado: http_request, not_found,
// authentication_required, authorization_denied, validation_failed,
// rate_limit_exceeded, internal_error, dependency_timeout...). Middlewares que
// sabem o MOTIVO (auth, permissão, validação, rate limit, errorHandler)
// preenchem `res.locals.log` / `res.locals.errorCode`; este arquivo só junta.
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { env } from '../config/env.js';
import { logger, runWithContext, shouldLog, scrubString } from './logger.js';
import { metrics, register } from './metrics.js';

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const HEALTH_ROUTES = new Set(['/health/live', '/health/ready', '/api/health']);
const STATIC_PREFIXES = ['/uploads/', '/updates/', '/assets/'];

// req.baseUrl é o caminho REAL já casado (`/api/rooms/5f0c.../channels`), não
// o padrão do mount. Volta pro padrão trocando cada valor de parâmetro pelo
// nome (`:roomId`); o que sobrar com cara de ID (dígito ou muito longo - os
// segmentos literais das rotas não têm) vira `:param`.
function patternFromBaseUrl(baseUrl, params) {
  const names = new Map(Object.entries(params ?? {}).map(([name, value]) => [String(value), name]));
  return baseUrl
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (names.has(segment)) return `:${names.get(segment)}`;
      return /\d/.test(segment) || segment.length > 32 ? ':param' : segment;
    })
    .join('/');
}

// Captura o padrão da rota (`/api/rooms/:roomId/channels/:channelId`) no
// instante em que o Express casa a rota. Ler req.baseUrl + req.route.path só
// no fim não serve: quando o handler faz next(err), o Express já restaurou
// req.baseUrl antes do errorHandler/`close` rodarem.
const originalDispatch = express.Route.prototype.dispatch;
express.Route.prototype.dispatch = function dispatchWithRoutePattern(req, res, done) {
  req.routePattern =
    typeof this.path === 'string'
      ? `${patternFromBaseUrl(req.baseUrl, req.params)}${this.path}`.replace(/(.)\/$/, '$1')
      : 'spa';
  return originalDispatch.call(this, req, res, done);
};

export const normalizeIp = (ip) => (typeof ip === 'string' ? ip.replace(/^::ffff:/, '') : undefined);

// Nunca devolve pedaço de URL arbitrária: só padrão de rota casada ou um
// balde fixo - scanner batendo em /wp-admin/xyz não cria série nova.
export function normalizeRoute(req, statusCode) {
  if (req.routePattern) return req.routePattern;
  const pathname = String(req.originalUrl ?? '').split('?')[0];
  const prefix = STATIC_PREFIXES.find((p) => pathname.startsWith(p));
  if (prefix) return `${prefix}*`;
  if (statusCode === 404) return 'unmatched';
  // Resposta dada por middleware do router antes de casar rota (ex.: 401 do
  // requireAuth em router.use) - só o mount é conhecido.
  if (req.baseUrl) return `${patternFromBaseUrl(req.baseUrl, req.params)}/*`;
  return 'unrouted';
}

const QUIET_WHEN_OK = new Set(['spa', 'unrouted', ...STATIC_PREFIXES.map((p) => `${p}*`)]);

function outcomeFor(status) {
  if (status < 400) return 'success';
  if (status === 401 || status === 403 || status === 429) return 'denied';
  if (status < 500) return 'invalid_request';
  return 'failure';
}

function eventFor(status, errorCode) {
  if (status >= 500 || status === 499) {
    if (errorCode?.endsWith('TIMEOUT')) return 'dependency_timeout';
    return errorCode ? 'internal_error' : 'http_request_failed';
  }
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'authorization_denied';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit_exceeded';
  return 'http_request';
}

function logRequest(req, res, ctx, startedAt) {
  metrics.httpInFlight.dec();
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  // 499 = cliente fechou a conexão antes da resposta terminar.
  const status = res.writableFinished ? res.statusCode : 499;
  const route = normalizeRoute(req, status);
  const labels = { method: req.method, route, status_code: String(status) };
  metrics.httpRequests.inc(labels);
  metrics.httpDuration.observe(labels, durationMs / 1000);

  // Probes: só métrica (transições de readiness são logadas em health.js).
  if (HEALTH_ROUTES.has(route) || (route === '/metrics' && status === 200)) return;

  const { event: explicitEvent, level: explicitLevel, throttleKey, ...details } = res.locals.log ?? {};
  const errorCode = res.locals.errorCode ?? null;
  const event = explicitEvent ?? eventFor(status, errorCode);
  const outcome = outcomeFor(status);
  const slow = durationMs >= env.LOG_SLOW_REQUEST_MS;

  if (event === 'http_request' && status < 400 && !slow && Math.random() >= env.LOG_SAMPLE_RATE) return;
  if (details.security_relevant) metrics.securityEvents.inc({ event, outcome });

  // Eventos que um atacante consegue gerar em massa (flood de 429/401) são
  // limitados por janela; a métrica continua contando tudo.
  const gate = throttleKey ? shouldLog(`${event}:${throttleKey}`) : {};
  if (!gate) return;

  // Arquivo estático/bundle servido com sucesso: só em debug.
  const level =
    explicitLevel ?? (status >= 500 ? 'error' : slow ? 'warn' : QUIET_WHEN_OK.has(route) && status < 400 ? 'debug' : 'info');
  const withBodies = logger.isLevelEnabled('debug');

  logger[level](
    {
      ...ctx,
      ...gate,
      event,
      http_method: req.method,
      http_route: route,
      http_status_code: status,
      duration_ms: Math.round(durationMs * 100) / 100,
      response_size_bytes: Number(res.getHeader('content-length')) || undefined,
      outcome,
      error_code: errorCode,
      retryable: res.locals.retryable,
      slow: slow || undefined,
      ...details,
      error: res.locals.error,
      request_body: env.LOG_REQUEST_BODY && withBodies ? req.body : undefined,
      response_body: env.LOG_RESPONSE_BODY && withBodies ? res.locals.responseBody : undefined,
    },
    status >= 500 ? 'Request failed' : 'Request completed'
  );
}

export function requestContext(req, res, next) {
  const incomingId = req.get('x-request-id');
  const requestId = incomingId && REQUEST_ID_PATTERN.test(incomingId) ? incomingId : `req-${randomUUID()}`;
  const ctx = { request_id: requestId };

  const activeSpan = trace.getActiveSpan()?.spanContext();
  if (activeSpan && isSpanContextValid(activeSpan)) {
    ctx.trace_id = activeSpan.traceId;
    ctx.span_id = activeSpan.spanId;
  } else {
    // Sem OpenTelemetry: preserva o trace do chamador (W3C traceparent) ou
    // cria um, pra busca por trace_id funcionar do mesmo jeito.
    const parent = TRACEPARENT_PATTERN.exec(req.get('traceparent') ?? '');
    const validParent = parent && !/^0+$/.test(parent[1]) && !/^0+$/.test(parent[2]);
    ctx.trace_id = validParent ? parent[1] : randomBytes(16).toString('hex');
    ctx.span_id = randomBytes(8).toString('hex');
    if (validParent) ctx.parent_span_id = parent[2];
  }
  ctx.source_ip = normalizeIp(req.ip);
  const userAgent = req.get('user-agent');
  if (userAgent) ctx.user_agent = scrubString(userAgent, 200);

  res.setHeader('X-Request-Id', requestId);
  metrics.httpInFlight.inc();
  if (env.LOG_RESPONSE_BODY) {
    const json = res.json.bind(res);
    res.json = (body) => {
      res.locals.responseBody = body;
      return json(body);
    };
  }
  const startedAt = process.hrtime.bigint();
  res.once('close', () => logRequest(req, res, ctx, startedAt));
  runWithContext(ctx, next);
}

const sha256 = (value) => createHash('sha256').update(value).digest();

// /metrics: exige METRICS_TOKEN (Bearer) quando configurado; sem token, só
// fica aberto fora de produção. Resposta 404 (não 401) pra não anunciar a rota.
export async function metricsHandler(req, res) {
  const token = env.METRICS_TOKEN;
  const allowed = token
    ? timingSafeEqual(sha256(req.get('authorization') ?? ''), sha256(`Bearer ${token}`))
    : env.NODE_ENV !== 'production';
  if (!env.METRICS_ENABLED || !allowed) {
    res.locals.log = { event: 'authorization_denied', reason_code: 'metrics_access_denied', security_relevant: true };
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }
  res.set('Content-Type', register.contentType);
  return res.send(await register.metrics());
}
