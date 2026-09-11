// Preload do OpenTelemetry - carregado ANTES da aplicação via
// `node --import ./src/observability/otel.js src/index.js` (script `start`),
// para a auto-instrumentação conseguir interceptar http/express/pg/ioredis.
// No-op quando OTEL_ENABLED != true: nenhum SDK/exporter é exigido em
// desenvolvimento. Os pacotes do SDK NÃO são dependência do projeto - instale
// só onde for habilitar (ver docs/observability.md#opentelemetry).
//
// Não importa o logger da aplicação de propósito: carregar pino aqui, antes do
// SDK registrar os hooks, anularia a instrumentação.
import 'dotenv/config';

if (process.env.OTEL_ENABLED === 'true') {
  const env = process.env;
  env.OTEL_SERVICE_NAME ||= env.SERVICE_NAME || 'navespeak-api';
  env.OTEL_RESOURCE_ATTRIBUTES ||= `service.version=${env.SERVICE_VERSION || 'local'},deployment.environment=${env.NODE_ENV || 'development'}`;
  env.OTEL_TRACES_EXPORTER ||= 'otlp';
  // Métricas vão por /metrics (Prometheus) e logs por stdout.
  env.OTEL_METRICS_EXPORTER ||= 'none';
  env.OTEL_LOGS_EXPORTER ||= 'none';
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) delete env.OTEL_EXPORTER_OTLP_ENDPOINT;

  try {
    await import('@opentelemetry/auto-instrumentations-node/register');
  } catch (err) {
    process.stderr.write(
      `${JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        service: env.SERVICE_NAME || 'navespeak-api',
        environment: env.NODE_ENV || 'development',
        version: env.SERVICE_VERSION || 'local',
        event: 'otel_initialization_failed',
        error_code: 'OTEL_SDK_MISSING',
        message: 'OpenTelemetry is enabled but the SDK packages could not be loaded; continuing without tracing',
        error: { type: err?.name, code: err?.code },
      })}\n`
    );
  }
}
