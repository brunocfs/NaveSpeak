import { NoiseGateWorkletNode } from "@sapphi-red/web-noise-suppressor";
import noiseGateWorkletPath from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";

// Sensibilidade/limiar do microfone: um noise gate de verdade (não é só
// indicador visual) - abaixo de `thresholdDb` (RMS em dBFS) a track enviada
// vira silêncio; acima, passa igual. Usa `NoiseGateWorkletNode`, o mesmo
// pacote do RNNoise/GTCRN (@sapphi-red/web-noise-suppressor, MIT), só que
// este worklet é JS puro (sem .wasm) - o cálculo é exatamente
// `20*log10(RMS)` por bloco, mesma fórmula que hooks/useMicLevel.js usa pro
// medidor visual, então o medidor bate com o comportamento real do gate.
//
// Diferente do RNNoise/GTCRN, o threshold do NoiseGateWorkletNode é fixado
// na CRIAÇÃO do node (processorOptions) - o worklet não expõe AudioParam
// nem escuta port.onmessage pra reconfigurar em runtime. Por isso, ao
// contrário do nível do supressor de ruído (ajustável ao vivo em
// MediaSessionContext.jsx), mudar a sensibilidade só vale da PRÓXIMA vez
// que entrar na voz - mesma convenção já usada pra modo do supressor e
// dispositivo de microfone (ver PreferencesModal.jsx).
//
// `closeThreshold` (histerese fixa, 6dB abaixo do threshold configurado) e
// `holdMs` (tempo que o gate segura aberto após cair abaixo do threshold)
// evitam "chatter" (abrir/fechar repetido bem em cima do limiar, cortando
// sílaba por sílaba) - mesma ideia do `releaseMs` de useSpeaking.js, só que
// aplicada à captação de verdade em vez de só ao anel visual.
const CLOSE_THRESHOLD_MARGIN_DB = 6;
const HOLD_MS = 300;

export async function createNoiseGateStream(rawStream, { thresholdDb }) {
  const track = rawStream.getAudioTracks()[0];
  if (!track) throw new Error("Stream de microfone sem faixa de áudio.");

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) throw new Error("Web Audio API indisponível neste navegador.");

  const audioCtx = new AudioContextImpl({ sampleRate: 48000 });
  await audioCtx.resume?.().catch(() => {});
  await audioCtx.audioWorklet.addModule(noiseGateWorkletPath);

  const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
  const gate = new NoiseGateWorkletNode(audioCtx, {
    openThreshold: thresholdDb,
    closeThreshold: thresholdDb - CLOSE_THRESHOLD_MARGIN_DB,
    holdMs: HOLD_MS,
    maxChannels: 1,
  });
  const dest = audioCtx.createMediaStreamDestination();

  source.connect(gate);
  gate.connect(dest);

  function destroy() {
    try {
      source.disconnect();
      gate.disconnect();
      dest.disconnect();
      audioCtx.close();
    } catch {
      // Contexto/nós já podem ter sido derrubados - inofensivo.
    }
  }

  return { stream: dest.stream, destroy };
}
