// Logger central (Pino) - JSON compacto em stdout, sempre com service/
// environment/version/event, contexto de correlação (request_id, trace_id,
// connection_id...) vindo do AsyncLocalStorage, e redaction feita AQUI, numa
// única camada - nunca confie em cada chamada lembrar de mascarar o que loga.
//
// Convenções (ver docs/observability.md):
// - logger.info({ event: 'snake_case_estavel', ...campos }, 'Mensagem curta em inglês')
// - Nunca logue `err.message` como mensagem: passe o erro em `error` e deixe
//   o serializer decidir o que sai (stack só em erro inesperado).
//
// Lê process.env direto (não importa config/env.js) porque env.js usa este
// logger para reportar configuração inválida - env.js valida os mesmos
// valores e derruba o processo se estiverem errados.
import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { metrics } from './metrics.js';

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export const serviceInfo = {
  service: process.env.SERVICE_NAME || 'navespeak-api',
  environment: process.env.NODE_ENV || 'development',
  version: process.env.SERVICE_VERSION || 'local',
};

// ---- Redaction -------------------------------------------------------------

// Chaves comparadas normalizadas (minúsculas, sem _ - .), por SUFIXO: pega
// `password`, `currentPassword`, `new_password`, `refresh_token`,
// `JWT_ACCESS_SECRET`... Inclui campos de mídia/sinalização (SDP, ICE, DTLS,
// RTP) e conteúdo livre de usuário (mensagem, imagem/anexo em base64).
const BASE_SENSITIVE_SUFFIXES = [
  'password', 'passwd', 'secret', 'token', 'apikey', 'privatekey', 'authorization', 'cookie',
  'credential', 'credentials', 'sdp', 'candidate', 'candidates', 'iceparameters', 'dtlsparameters',
  'rtpparameters', 'rtpcapabilities', 'cardnumber', 'cvv', 'mfacode', 'otp', 'content', 'filedata',
  'image', 'icon', 'body', 'headers',
];
const normalizeKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const sensitiveSuffixes = [
  ...BASE_SENSITIVE_SUFFIXES,
  ...String(process.env.LOG_REDACT_PATHS ?? '')
    .split(',')
    .map(normalizeKey)
    .filter(Boolean),
];
// Campos que o próprio logger gera a partir de valores já tratados - nunca
// podem ser mascarados por coincidência de sufixo.
const ALLOWED_KEYS = new Set(['requestbody', 'responsebody']);

export function isSensitiveKey(key) {
  const k = normalizeKey(key);
  if (ALLOWED_KEYS.has(k)) return false;
  return sensitiveSuffixes.some((suffix) => k.endsWith(suffix));
}

const MAX_STRING = 2048;
const STRING_SCRUBBERS = [
  [/eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, '[REDACTED_JWT]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [REDACTED]'],
  [/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g, '[REDACTED_DATA_URL]'],
  [/(^|\r?\n)v=0\r?\n[\s\S]*/g, '$1[REDACTED_SDP]'],
  [/\bcandidate:[^\r\n"]*/gi, 'candidate:[REDACTED]'],
  [/\b[a-f0-9]{64,}\b/gi, '[REDACTED_HEX]'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[REDACTED_EMAIL]'],
  [/\b(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[REDACTED]'],
];
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Remove segredos conhecidos, caracteres de controle (log injection em
// saída "pretty"/terminal - o JSON já escapa \n) e limita o tamanho.
export function scrubString(value, max = MAX_STRING) {
  let s = String(value).replace(CONTROL_CHARS, '');
  for (const [pattern, replacement] of STRING_SCRUBBERS) s = s.replace(pattern, replacement);
  return s.length > max ? `${s.slice(0, max)}…[TRUNCATED]` : s;
}

// Erro -> objeto seguro. Stack só quando `stack` (erro inesperado do backend);
// pg/nodemailer/etc. penduram campos extras (detail, parameters, query) que
// podem carregar valores - nenhum deles é copiado.
export function serializeError(err, { stack = true } = {}) {
  if (!(err instanceof Error)) return { type: typeof err, message: scrubString(String(err), 500) };
  const out = { type: err.name || 'Error', message: scrubString(err.message ?? '', 500) };
  if (err.code !== undefined) out.code = scrubString(err.code, 64);
  if (stack && err.stack) out.stack = scrubString(err.stack, 8000);
  if (err.cause instanceof Error) out.cause = serializeError(err.cause, { stack: false });
  return out;
}

export function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value, { stack: value.expected !== true });
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[BINARY ${value.byteLength} bytes]`;
  if (depth >= 6) return '[TRUNCATED_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitize(item, depth + 1, seen);
  }
  return out;
}

// ---- Contexto de correlação -------------------------------------------------

const als = new AsyncLocalStorage();

export const getContext = () => als.getStore();
export const runWithContext = (ctx, fn) => als.run(ctx, fn);
// Enriquece o contexto corrente (ex.: user_id depois de autenticar) - tudo
// que for logado dali em diante, na mesma requisição/evento, carrega o campo.
export function setContext(fields) {
  const store = als.getStore();
  if (store) Object.assign(store, fields);
}

function contextFields() {
  const store = als.getStore();
  const span = trace.getActiveSpan()?.spanContext();
  // Com OpenTelemetry ativo o span real manda nos IDs; sem ele, vale o
  // trace_id/span_id que o middleware HTTP derivou do traceparent.
  if (span && isSpanContextValid(span)) return { ...store, trace_id: span.traceId, span_id: span.spanId };
  return store ? { ...store } : {};
}

// ---- Destino ----------------------------------------------------------------

// Assíncrono (sonic-boom) para não bloquear o event loop em caminho quente de
// voz/socket; pino já trata EPIPE (coletor fora do ar) sem derrubar o processo.
const stdout = pino.destination({ dest: 1, sync: false });
let sink = stdout;

if (process.env.LOG_PRETTY === 'true' && serviceInfo.environment !== 'production') {
  try {
    sink = pino.transport({ target: 'pino-pretty' });
  } catch {
    // pino-pretty não instalado - segue JSON (use `npm run dev | npx pino-pretty`).
  }
}

// Indireção só para os testes conseguirem capturar a saída.
export function setLogSink(stream) {
  sink = stream ?? stdout;
}

export function flushLogs() {
  try {
    stdout.flushSync();
  } catch {
    // destino já fechado/indisponível - nada a fazer
  }
}

const envLevel = process.env.LOG_LEVEL;

export const logger = pino(
  {
    level: LEVELS.includes(envLevel) ? envLevel : 'info',
    base: serviceInfo,
    messageKey: 'message',
    errorKey: 'error',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    mixin: contextFields,
    // formatters.log (abaixo) já serializa erros com segurança; o serializer
    // padrão do pino rodaria depois e reescreveria o objeto limpo.
    serializers: { error: (value) => value, err: (value) => value },
    formatters: {
      level: (label) => ({ level: label }),
      log(obj) {
        const clean = sanitize(obj);
        if (!clean.event) clean.event = 'unspecified_event';
        return clean;
      },
    },
    hooks: {
      logMethod(args, method) {
        for (let i = 0; i < args.length; i += 1) {
          if (typeof args[i] === 'string') args[i] = scrubString(args[i], 500);
        }
        return method.apply(this, args);
      },
    },
  },
  { write: (line) => sink.write(line) }
);

// ---- Helpers ----------------------------------------------------------------

// Limita volume de um evento repetitivo (ex.: flood de login inválido, Redis
// caído reconectando): no máximo `max` logs por janela por chave; o resto só
// conta e o próximo log liberado leva `suppressed_count`. Chaves devem vir de
// um conjunto pequeno (evento + motivo), nunca de IDs.
const windows = new Map();
export function shouldLog(key, { max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    const suppressed = w?.suppressed ?? 0;
    w = { start: now, count: 0, suppressed: 0 };
    windows.set(key, w);
    w.pendingSuppressed = suppressed;
  }
  if (w.count >= max) {
    w.suppressed += 1;
    return null;
  }
  w.count += 1;
  const suppressed = w.pendingSuppressed;
  w.pendingSuppressed = 0;
  return { suppressed_count: suppressed };
}

const humanize = (event) => event.charAt(0).toUpperCase() + event.slice(1).replace(/_/g, ' ');

// Evento de auditoria/segurança: sempre `security_relevant: true`, conta na
// métrica security_events_total. Ator vem do contexto (user_id só existe
// depois de autenticado). `throttleKey` (ex.: o reason_code) limita o volume
// de eventos que um atacante consegue gerar em massa (login_failed).
export function audit(event, { outcome = 'success', level, message, throttleKey, ...fields } = {}) {
  metrics.securityEvents.inc({ event, outcome });
  const gate = throttleKey ? shouldLog(`${event}:${throttleKey}`, { max: 100 }) : {};
  if (!gate) return;
  const lvl = level ?? (outcome === 'success' ? 'info' : 'warn');
  logger[lvl](
    {
      ...gate,
      event,
      outcome,
      security_relevant: true,
      actor_type: getContext()?.user_id ? 'user' : 'anonymous',
      ...fields,
    },
    message ?? humanize(event)
  );
}
