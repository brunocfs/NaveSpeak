import { GtcrnWorkletNode, loadGtcrn } from "@sapphi-red/web-noise-suppressor";
import gtcrnWorkletPath from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import gtcrnWasmPath from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";

// Supressor de ruído GTCRN (Xiaobin-Rong/gtcrn, MIT) - rede neural mais nova
// que o RNNoise (ver audio/rnnoise.js), qualidade melhor nos benchmarks
// padrão (PESQ/STOI/DNSMOS) apesar de também minúscula (~24K parâmetros,
// desenhada de propósito pra tempo real em borda). Mesmo pacote WASM do
// RNNoise (@sapphi-red/web-noise-suppressor), mesma mecânica de grafo - só
// que ela resampla 48kHz->16kHz->48kHz internamente (ver workletProcessor),
// o modelo em si roda em 16kHz.
//
// Binário cacheado uma vez só no módulo (igual rnnoise.js) - o import com
// `?url` já vira um chunk à parte no build (ver vite build), então o wasm
// só é baixado de verdade se o código deste arquivo chegar a rodar, ou
// seja, só se o usuário escolher o modo 'gtcrn'.
let wasmBinaryPromise = null;
function getWasmBinary() {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadGtcrn({ url: gtcrnWasmPath });
  }
  return wasmBinaryPromise;
}

// Mesmo desenho de createRnnoiseStream (audio/rnnoise.js): mix dry/wet via
// dois GainNodes, devolve uma stream nova (MediaStreamAudioDestinationNode)
// pra virar a track do producer de mic. Ver esse arquivo pro porquê do
// desenho (nunca tocar direto em audioCtx.destination sem um <audio> real
// por trás - não é o caso aqui, isso é só CAPTURA/envio, não reprodução).
export async function createGtcrnStream(rawStream, { level = 100 } = {}) {
  const track = rawStream.getAudioTracks()[0];
  if (!track) throw new Error("Stream de microfone sem faixa de áudio.");

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) throw new Error("Web Audio API indisponível neste navegador.");

  const audioCtx = new AudioContextImpl({ sampleRate: 48000 });
  await audioCtx.resume?.().catch(() => {});

  const wasmBinary = await getWasmBinary();
  await audioCtx.audioWorklet.addModule(gtcrnWorkletPath);

  const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
  const gtcrn = new GtcrnWorkletNode(audioCtx, { maxChannels: 1, wasmBinary });
  const dryGain = audioCtx.createGain();
  const wetGain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();

  source.connect(dryGain).connect(dest);
  source.connect(gtcrn);
  gtcrn.connect(wetGain).connect(dest);

  function setLevel(pct) {
    const wet = Math.min(100, Math.max(0, pct)) / 100;
    wetGain.gain.value = wet;
    dryGain.gain.value = 1 - wet;
  }
  setLevel(level);

  function destroy() {
    try {
      source.disconnect();
      gtcrn.disconnect();
      gtcrn.destroy();
      dryGain.disconnect();
      wetGain.disconnect();
      dest.disconnect();
      audioCtx.close();
    } catch {
      // Contexto/nós já podem ter sido derrubados - inofensivo.
    }
  }

  return { stream: dest.stream, setLevel, destroy };
}
