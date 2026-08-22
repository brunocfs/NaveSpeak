import * as mediasoup from 'mediasoup';
import { numWorkers, workerSettings } from './config.js';

const workers = [];
let nextWorkerIndex = 0;

export async function createWorkers() {
  for (let i = 0; i < numWorkers; i += 1) {
    const worker = await mediasoup.createWorker(workerSettings);
    worker.on('died', (err) => {
      // Um worker mediasoup morto é um erro fatal e irrecuperável para essa
      // instância (bug no processo nativo, geralmente ficou sem memória ou
      // sem portas livres) - preferimos derrubar o processo a continuar
      // rodando com um worker "fantasma".
      console.error('Worker mediasoup morreu inesperadamente:', err.message);
      process.exit(1);
    });
    workers.push(worker);
  }
  console.log(`mediasoup: ${workers.length} worker(s) iniciado(s).`);
  return workers;
}

export function getNextWorker() {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}
