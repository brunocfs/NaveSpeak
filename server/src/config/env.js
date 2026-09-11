// Carrega e valida as variaveis de ambiente uma unica vez na inicializacao.
// Falha rapido (processo nao sobe) se algum segredo obrigatorio estiver faltando -
// isso evita que o servidor rode "acidentalmente" com segredo vazio/default.
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { logger, flushLogs } from '../observability/logger.js';

loadDotenv();

// Variável vazia no .env ("LOG_SAMPLE_RATE=") conta como ausente -> usa o
// default. Sem isso, z.coerce transformaria "" em 0 silenciosamente.
const emptyToUndefined = (v) => (v === '' ? undefined : v);
const bool = (fallback) => z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default(fallback)).transform((v) => v === 'true');
const int = (fallback) => z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(fallback));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),

    DB_HOST: z.string().min(1),
    // MySQL=3306, PostgreSQL=5432. O .env define o valor real.
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().min(1),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required - the database must not run without a password'),

    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must have at least 16 characters'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must have at least 16 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    COOKIE_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    MEDIASOUP_ANNOUNCED_IP: z.string().optional().default(''),
    MEDIASOUP_MIN_PORT: z.coerce.number().int().positive().default(40000),
    MEDIASOUP_MAX_PORT: z.coerce.number().int().positive().default(40100),

    // Redis: usado para rate limit compartilhado, presença online/offline e
    // cache de mensagens. O adapter do socket.io também usa essa URL quando
    // ENABLE_REDIS_ADAPTER=true (modo multi-instância). Opcional.
    REDIS_URL: z.string().optional().default('redis://127.0.0.1:6379'),
    // Liga o adapter Redis do socket.io (necessário só para multi-instância).
    // false = adapter em memória (single-instance, funciona sem Redis).
    ENABLE_REDIS_ADAPTER: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    // ---- Cadastro (registro/invite-only) ----
    // true = POST /auth/register exige um convite válido (ver
    // routes/invites.routes.js e routes/auth.routes.js); false = cadastro
    // público liberado, convite é ignorado mesmo se enviado.
    INVITE_ONLY: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    // Origem usada para montar o link de convite (ex.: no email enviado por
    // utils/mailer.js): "<APP_BASE_URL>/invite/<code>". Cai em CORS_ORIGIN
    // quando vazio - mesma origem que o client já usa em desenvolvimento, e a
    // única origem válida em produção (client servido pelo próprio Express).
    APP_BASE_URL: z.string().optional().default(''),

    // ---- SMTP (convite por email, utils/mailer.js) ----
    // Todos opcionais: sem SMTP_HOST configurado, o envio automático de email
    // fica indisponível - o convite continua sendo criado e o link é
    // devolvido ao admin na resposta da API.
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    // Endereço "De:" nos emails de convite - cai em SMTP_USER quando vazio.
    SMTP_FROM: z.string().optional().default(''),

    // ---- Observabilidade (ver docs/observability.md) ----
    SERVICE_NAME: z.preprocess(emptyToUndefined, z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'SERVICE_NAME must be kebab-case').default('navespeak-api')),
    SERVICE_VERSION: z.preprocess(emptyToUndefined, z.string().regex(/^[\w.+-]{1,64}$/, 'SERVICE_VERSION must be a short version or git SHA').default('local')),
    LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
    LOG_PRETTY: bool('false'),
    LOG_REDACT_PATHS: z.string().optional().default(''),
    LOG_REQUEST_BODY: bool('false'),
    LOG_RESPONSE_BODY: bool('false'),
    LOG_SLOW_REQUEST_MS: int(1000),
    LOG_SLOW_DB_QUERY_MS: int(500),
    LOG_SLOW_REDIS_COMMAND_MS: int(100),
    LOG_SAMPLE_RATE: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(1).default(1)),
    OTEL_ENABLED: bool('false'),
    OTEL_SERVICE_NAME: z.string().optional().default(''),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.union([z.literal(''), z.string().url('OTEL_EXPORTER_OTLP_ENDPOINT must be a URL')]).default(''),
    METRICS_ENABLED: bool('true'),
    METRICS_TOKEN: z.union([z.literal(''), z.string().min(24, 'METRICS_TOKEN must have at least 24 characters')]).default(''),
    HEALTH_DETAILS_ENABLED: bool('false'),
    // Número de proxies reversos confiáveis na frente do Node (Nginx = 1).
    // false = usa o IP da conexão TCP (atrás de proxy isso vira 127.0.0.1 e
    // quebra rate limit por IP e o source_ip dos logs de auditoria).
    TRUST_PROXY: z
      .preprocess(emptyToUndefined, z.string().regex(/^(false|[1-9])$/, 'TRUST_PROXY must be false or the number of trusted proxy hops').default('false'))
      .transform((v) => (v === 'false' ? false : Number(v))),
    SHUTDOWN_TIMEOUT_MS: int(10_000),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    if (cfg.JWT_ACCESS_SECRET === cfg.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ in production' });
    }
    if (cfg.LOG_PRETTY) {
      ctx.addIssue({ code: 'custom', path: ['LOG_PRETTY'], message: 'LOG_PRETTY must be false in production (compact JSON only)' });
    }
    if (cfg.OTEL_ENABLED && !cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
      ctx.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'required in production when OTEL_ENABLED=true' });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Só nome do campo + regra violada - nunca o valor (pode ser um segredo).
  logger.fatal(
    {
      event: 'configuration_invalid',
      error_code: 'CONFIG_INVALID',
      invalid_fields: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), rule: issue.message })),
    },
    'Invalid environment configuration; compare .env with .env.example'
  );
  flushLogs();
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && env.METRICS_ENABLED && !env.METRICS_TOKEN) {
  logger.warn(
    { event: 'metrics_endpoint_disabled', reason_code: 'metrics_token_missing' },
    'METRICS_TOKEN is not set; /metrics stays closed in production'
  );
}
if (env.LOG_REQUEST_BODY || env.LOG_RESPONSE_BODY) {
  logger.warn(
    { event: 'body_logging_enabled', request_body: env.LOG_REQUEST_BODY, response_body: env.LOG_RESPONSE_BODY, log_level: env.LOG_LEVEL },
    'Request/response body logging is enabled (debug level only, redacted); disable after troubleshooting'
  );
}
