import { useEffect, useState } from 'react';

// Detecta se um MediaStream de áudio está "falando" agora (nível médio acima
// de um limiar - NUNCA só "mic aberto/track presente": track existir e estar
// unmuted não basta, o nível precisa passar do threshold), usado para
// desenhar o anel verde de "quem está falando" nos quadradinhos da chamada
// (ParticipantTile.jsx) e na lista de participantes de RoomPage.jsx. O
// AnalyserNode escuta a track diretamente - independe do elemento <audio>
// estar com playback mutado (ex.: "silenciar todos"), então o anel continua
// funcionando mesmo ensurdecido. Falha graciosamente (retorna sempre false)
// se o AudioContext não puder ser criado, em vez de quebrar a UI.
//
// `releaseMs` é o "hangover" que evita flicker: fala tem micropausas entre
// sílabas/palavras que cairiam abaixo do threshold por alguns frames -
// "true" liga na hora (sem atraso perceptível), mas só desliga depois de
// releaseMs sem NENHUM frame acima do threshold. Sem isso o anel pisca
// dezenas de vezes por segundo durante uma fala normal.
export function useSpeaking(stream, threshold = 14, releaseMs = 300) {
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
    let lastAboveAt = 0;

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
      const level = sum / data.length;
      const now = performance.now();

      if (level > threshold) {
        lastAboveAt = now;
        setSpeaking(true);
      } else if (now - lastAboveAt > releaseMs) {
        setSpeaking(false);
      }
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
  }, [stream, threshold, releaseMs]);

  return speaking;
}
