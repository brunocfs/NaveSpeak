// Encerramento gracioso + handlers globais do processo. Cada módulo que abre
// recurso (HTTP/Socket.IO, mediasoup, pool pg, Redis, exporter OTel)
// registra seu passo com onShutdown(); a ordem de registro é a de execução.
import { logger, flushLogs } from './logger.js';

const tasks = [];
let shuttingDown = false;

export const isShuttingDown = () => shuttingDown;

export function onShutdown(name, fn) {
  tasks.push({ name, fn });
}

export async function shutdown({ reason, exitCode = 0, timeoutMs = 10_000, exit = process.exit } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  const startedAt = performance.now();
  logger.info({ event: 'service_shutdown_started', reason_code: reason }, 'Graceful shutdown started');

  // Supervisor (PM2/systemd) reinicia; nunca ficar pendurado para sempre.
  const timer = setTimeout(() => {
    logger.fatal({ event: 'service_shutdown_timeout', reason_code: reason, timeout_ms: timeoutMs }, 'Graceful shutdown timed out');
    flushLogs();
    exit(1);
  }, timeoutMs);
  timer.unref();

  let code = exitCode;
  for (const task of tasks) {
    try {
      await task.fn();
    } catch (err) {
      code = code || 1;
      logger.error({ event: 'service_shutdown_step_failed', step: task.name, error: err }, 'Shutdown step failed');
    }
  }

  clearTimeout(timer);
  logger.info(
    { event: 'service_shutdown_completed', reason_code: reason, duration_ms: Math.round(performance.now() - startedAt) },
    'Graceful shutdown completed'
  );
  flushLogs();
  exit(code);
}

export function installProcessHandlers({ timeoutMs } = {}) {
  process.once('SIGTERM', () => shutdown({ reason: 'sigterm', timeoutMs }));
  process.once('SIGINT', () => shutdown({ reason: 'sigint', timeoutMs }));

  // Estado do processo não é mais confiável: registra como fatal e sai
  // (código 1) depois de uma tentativa curta de fechar conexões.
  process.on('uncaughtException', (err, origin) => {
    logger.fatal({ event: 'uncaught_exception', error_code: 'UNCAUGHT_EXCEPTION', origin, error: err }, 'Uncaught exception');
    shutdown({ reason: 'uncaught_exception', exitCode: 1, timeoutMs: 5000 });
  });
  // Mesmo comportamento padrão do Node 22 (derrubar o processo), agora com log.
  process.on('unhandledRejection', (reason) => {
    logger.fatal(
      { event: 'unhandled_rejection', error_code: 'UNHANDLED_REJECTION', error: reason },
      'Unhandled promise rejection'
    );
    shutdown({ reason: 'unhandled_rejection', exitCode: 1, timeoutMs: 5000 });
  });
}
