import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

// Supressor de ruído baseado em RNNoise (xiph/rnnoise, BSD-3-Clause) rodando
// via WASM num AudioWorklet - alternativa ao noiseSuppression nativo do
// WebRTC (api/media.js#requestMicStream), que só liga/desliga sem nível
// nenhum. RNNoise é uma rede neural pequena (~85KB de modelo) treinada pra
// isso especificamente - lida melhor com ruído não-estacionário (teclado,
// conversa de fundo, ventilador) do que o filtro clássico do navegador.
//
// O binário .wasm é baixado uma vez só (cacheado aqui no módulo) e
// reaproveitado em toda entrada na voz - só o AudioWorklet (por AudioContext)
// precisa ser registrado de novo a cada chamada nova.
let wasmBinaryPromise = null;
function getWasmBinary() {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadRnnoise({
      url: rnnoiseWasmPath,
      simdUrl: rnnoiseWasmSimdPath,
    });
  }
  return wasmBinaryPromise;
}

// Monta o grafo: source -> [dryGain] -> destino
//                source -> RNNoise -> [wetGain] -> destino
// `level` (0-100) é o mix dry/wet - 0% = áudio original intocado, 100% =
// só o áudio processado pelo RNNoise. Serve tanto de "nível do supressor"
// (pedido do usuário) quanto de válvula de escape: se o RNNoise cortar sílaba
// de fala por engano numa voz muito grave/aguda, baixar o nível recupera o
// sinal original em vez de virar tudo ou nada.
//
// Devolve um MediaStream novo (saída de um MediaStreamAudioDestinationNode)
// pra ser usado como track do producer de mic - a `rawStream` de entrada
// continua sendo o dono da captura de verdade (fica em localStreamRef,
// MediaSessionContext.jsx para/libera ela ao sair da voz).
export async function createRnnoiseStream(rawStream, { level = 100 } = {}) {
  const track = rawStream.getAudioTracks()[0];
  if (!track) throw new Error("Stream de microfone sem faixa de áudio.");

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) throw new Error("Web Audio API indisponível neste navegador.");

  // RnnoiseWorkletNode assume 48kHz (ver dist/index.d.ts) - pede a taxa
  // explicitamente; navegadores que não suportam a opção (rara) só ignoram.
  const audioCtx = new AudioContextImpl({ sampleRate: 48000 });
  await audioCtx.resume?.().catch(() => {});

  const wasmBinary = await getWasmBinary();
  await audioCtx.audioWorklet.addModule(rnnoiseWorkletPath);

  const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
  const rnnoise = new RnnoiseWorkletNode(audioCtx, { maxChannels: 1, wasmBinary });
  const dryGain = audioCtx.createGain();
  const wetGain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();

  source.connect(dryGain).connect(dest);
  source.connect(rnnoise);
  rnnoise.connect(wetGain).connect(dest);

  function setLevel(pct) {
    const wet = Math.min(100, Math.max(0, pct)) / 100;
    wetGain.gain.value = wet;
    dryGain.gain.value = 1 - wet;
  }
  setLevel(level);

  function destroy() {
    try {
      source.disconnect();
      rnnoise.disconnect();
      rnnoise.destroy();
      dryGain.disconnect();
      wetGain.disconnect();
      dest.disconnect();
      audioCtx.close();
    } catch {
      // Contexto/nós já podem ter sido derrubados (track parada etc.) -
      // inofensivo, só estamos garantindo que nada fique pendurado.
    }
  }

  return { stream: dest.stream, setLevel, destroy };
}
