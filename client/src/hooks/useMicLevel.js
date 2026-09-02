import { useEffect, useState } from 'react';

// Nível de entrada do microfone em dBFS (RMS), amostrado continuamente via
// AnalyserNode - usado pelo medidor visual de Preferências > Áudio
// (sensibilidade do microfone). MESMA fórmula que o noise gate de verdade
// usa por baixo dos panos (audio/noiseGate.js: `20*log10(RMS)` por bloco),
// de propósito - o medidor só é útil se prever fielmente quando o gate real
// vai abrir/fechar.
//
// -100 = piso (silêncio digital/sem sinal, nunca -Infinity de log(0)).
// Falha graciosamente (retorna sempre -100) se o AudioContext não puder ser
// criado, mesmo padrão de useSpeaking.js.
export function useMicLevel(stream) {
  const [levelDb, setLevelDb] = useState(-100);

  useEffect(() => {
    const track = stream?.getAudioTracks?.()[0];
    if (!track) {
      setLevelDb(-100);
      return undefined;
    }

    let audioCtx;
    let analyser;
    let source;
    let rafId;
    let cancelled = false;

    try {
      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextImpl();
      audioCtx.resume?.().catch(() => {});
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source = audioCtx.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
    } catch {
      return undefined;
    }

    const data = new Float32Array(analyser.fftSize);
    function tick() {
      if (cancelled) return;
      analyser.getFloatTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i];
      const rms = Math.sqrt(sumSquares / data.length);
      setLevelDb(rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100);
      rafId = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      try {
        source.disconnect();
        analyser.disconnect();
        audioCtx.close();
      } catch {
        // AudioContext já pode ter sido fechado/track parada - inofensivo.
      }
    };
  }, [stream]);

  return levelDb;
}
