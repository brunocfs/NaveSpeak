import * as mediasoup from 'mediasoup';
import { numWorkers, workerSettings } from './config.js';
import { logger } from '../observability/logger.js';
import { shutdown } from '../observability/shutdown.js';

const workers = [];
let nextWorkerIndex = 0;

export async function createWorkers() {
  for (let i = 0; i < numWorkers; i += 1) {
    const worker = await mediasoup.createWorker(workerSettings);
    worker.on('died', (err) => {
      // Um worker mediasoup morto é um erro fatal e irrecuperável para essa
      // instância (bug no processo nativo, geralmente ficou sem memória ou
      // sem portas livres) - preferimos derrubar o processo a continuar
      // rodando com um worker "fantasma". O supervisor (PM2/systemd) reinicia.
      logger.fatal(
        { event: 'mediasoup_worker_died', error_code: 'MEDIASOUP_WORKER_DIED', worker_pid: worker.pid, error: err },
        'mediasoup worker died unexpectedly'
      );
      shutdown({ reason: 'mediasoup_worker_died', exitCode: 1, timeoutMs: 5000 });
    });
    workers.push(worker);
  }
  logger.info({ event: 'mediasoup_workers_started', worker_count: workers.length }, 'mediasoup workers started');
  return workers;
}

export const getWorkers = () => workers;

export function closeWorkers() {
  for (const worker of workers) worker.close();
}

export function getNextWorker() {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}
