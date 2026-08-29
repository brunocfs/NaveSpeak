import { useEffect, useState } from 'react';

// Detecta se um MediaStream de áudio está "falando" agora (nível médio acima
// de um limiar), usado para desenhar o anel verde de "quem está falando" nos
// quadradinhos da chamada, como no Discord. O AnalyserNode escuta a track
// diretamente - independe do elemento <audio> estar com playback mutado (ex.:
// "silenciar todos"), então o anel continua funcionando mesmo ensurdecido.
// Falha graciosamente (retorna sempre false) se o AudioContext não puder ser
// criado, em vez de quebrar a UI.
export function useSpeaking(stream, threshold = 14) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const track = stream?.getAudioTracks?.()[0];
    if (!track) {
      setSpeaking(false);
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
      analyser.fftSize = 512;
      source = audioCtx.createMediaStreamSource(new MediaStream([track]));
      source.connect(analyser);
    } catch {
      return undefined;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      if (cancelled) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      setSpeaking(sum / data.length > threshold);
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
  }, [stream, threshold]);

  return speaking;
}
