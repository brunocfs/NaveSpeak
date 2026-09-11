// Readiness: roda os checks em paralelo com timeout curto. Probes chegam a
// cada poucos segundos - nada é logado quando o estado se mantém; só a
// TRANSIÇÃO (ok -> degraded -> unavailable...) vira log.
import { logger } from './logger.js';
import { metrics } from './metrics.js';

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('health check timed out'), { code: 'HEALTH_CHECK_TIMEOUT' })), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// checks: { nome: { run: async () => void, essential: boolean } }
// essential=false derruba só para "degraded" (continua recebendo tráfego).
export function createReadinessCheck(checks, { timeoutMs = 1000, isShuttingDown = () => false } = {}) {
  let lastStatus = null;

  return async function readiness() {
    const results = {};
    await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        const startedAt = performance.now();
        try {
          await withTimeout(check.run(), timeoutMs);
          results[name] = { status: 'up' };
        } catch (err) {
          results[name] = {
            status: 'down',
            essential: check.essential,
            error_code: err?.code === 'HEALTH_CHECK_TIMEOUT' ? 'HEALTH_CHECK_TIMEOUT' : 'HEALTH_CHECK_FAILED',
          };
        }
        results[name].duration_ms = Math.round(performance.now() - startedAt);
        metrics.healthStatus.set({ check: name }, results[name].status === 'up' ? 1 : 0);
      })
    );

    const shuttingDown = isShuttingDown();
    const essentialDown = Object.entries(checks).some(([name, c]) => c.essential && results[name].status === 'down');
    const anyDown = Object.values(results).some((r) => r.status === 'down');
    const status = shuttingDown ? 'shutting_down' : essentialDown ? 'unavailable' : anyDown ? 'degraded' : 'ok';

    if (status !== lastStatus) {
      logger[status === 'ok' ? 'info' : 'warn'](
        {
          event: 'readiness_changed',
          previous_status: lastStatus,
          new_status: status,
          checks: Object.fromEntries(Object.entries(results).map(([name, r]) => [name, r.error_code ?? r.status])),
        },
        'Readiness status changed'
      );
      lastStatus = status;
    }

    return { ready: !shuttingDown && !essentialDown, status, checks: results };
  };
}
