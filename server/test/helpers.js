import './env.js';
import { setLogSink } from '../src/observability/logger.js';

// Troca o destino do logger por um coletor em memória. `raw` guarda as
// linhas exatamente como seriam escritas em stdout (para provar que um
// segredo não aparece em lugar nenhum da saída).
export function captureLogs() {
  const raw = [];
  const lines = [];
  setLogSink({
    write(chunk) {
      raw.push(chunk);
      lines.push(JSON.parse(chunk));
    },
  });
  return {
    raw,
    lines,
    text: () => raw.join(''),
    restore: () => setLogSink(),
    // O access log HTTP é escrito no 'close' da resposta, que pode chegar
    // depois do cliente já ter lido o corpo.
    async waitFor(predicate, timeoutMs = 2000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const found = lines.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('expected log line was not written');
    },
  };
}

export const counterValue = async (metric, labels) => {
  const { values } = await metric.get();
  const match = values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return match?.value ?? 0;
};
