import dfn3WorkletPath from "./dfn3Worklet.js?url";

// Supressor de ruído DeepFilterNet3 (Rikorose/DeepFilterNet, MIT) - rede
// maior que GTCRN/RNNoise (ver audio/gtcrn.js e audio/rnnoise.js), lida
// melhor com ruído de teclado e respiração/sibilantes nos benchmarks
// públicos, ao custo de ser bem mais pesada: ~24MB de WASM+modelo, baixados
// SÓ se o usuário escolher esse modo (Preferências > Áudio), não no bundle
// da aplicação.
//
// Origem: começou como o pacote comunitário `deepfilternet3-noise-filter`
// (github.com/mezonai/mezon-noise-suppression, MIT/Apache-2.0), mas dois
// problemas dele forçaram vendorizar em vez de usar como dependência:
// (1) o CDN padrão deles (cdn.mezon.ai) não manda Access-Control-Allow-Origin
// nenhum - bloqueado por CORS a partir de QUALQUER domínio nosso, confirmado
// em teste real; (2) a dependência npm arrastava o livekit-client inteiro
// por causa de um peerDependency que nem é usado de verdade.
//
// Por isso: audio/dfn3Worklet.js é uma cópia vendorizada do worklet deles
// (mesma lógica, mesmo glue wasm-bindgen) com os ajustes listados no topo
// daquele arquivo, e os dois assets (wasm + modelo) ficam self-hospedados em
// `client/public/vendor/deepfilternet3/v3/` via Git LFS (mesmo padrão de
// server/updates/*.exe - ver .gitattributes).
const ASSET_BASE_URL = "/vendor/deepfilternet3/v3";
const WASM_URL = `${ASSET_BASE_URL}/pkg/df_bg.wasm`;
// O modelo é um .tar.gz (o Rust do DeepFilterNet descompacta ele por dentro),
// mas o arquivo é servido com o sufixo `.bin` DE PROPÓSITO: servidor estático
// que enxerga extensão `.gz` tende a responder com `Content-Encoding: gzip` e
// o próprio navegador descompacta antes do nosso fetch ver os bytes - aí
// `df_create` recebe um TAR cru onde esperava gzip e o Rust panica com
// `RuntimeError: unreachable` (era exatamente esse o bug que mantinha este
// modo desligado; o dev server do Vite faz isso, ver `Content-Encoding` em
// /vendor/.../DeepFilterNet3_onnx.tar.gz). Com `.bin` ninguém aplica
// codificação nenhuma e os bytes chegam como estão em disco.
const MODEL_URL = `${ASSET_BASE_URL}/models/DeepFilterNet3_onnx.tar.gz.bin`;

// Cinto e suspensório pro problema acima: se ALGUM proxy/CDN no caminho ainda
// entregar o modelo já descompactado, dá pra reconhecer (gzip começa com
// 1f 8b; tar tem "ustar" no offset 257) e recompactar no cliente via
// CompressionStream em vez de entregar bytes que fazem o WASM panicar.
async function ensureGzippedModel(bytes) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 265));
  if (head[0] === 0x1f && head[1] === 0x8b) return bytes;

  const isTar = String.fromCharCode(...head.slice(257, 262)) === "ustar";
  if (!isTar) throw new Error("Modelo do DeepFilterNet3 veio corrompido (nem gzip, nem tar).");
  if (typeof CompressionStream === "undefined") {
    throw new Error("Modelo do DeepFilterNet3 chegou descompactado e este navegador não tem CompressionStream.");
  }
  const gz = new Response(bytes).body.pipeThrough(new CompressionStream("gzip"));
  return new Response(gz).arrayBuffer();
}

let assetsPromise = null;
function getAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      fetch(WASM_URL).then((r) => {
        if (!r.ok) throw new Error(`Falha ao baixar df_bg.wasm: ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(MODEL_URL)
        .then((r) => {
          if (!r.ok) throw new Error(`Falha ao baixar o modelo DeepFilterNet3: ${r.status}`);
          return r.arrayBuffer();
        })
        .then(ensureGzippedModel),
    ]).then(([wasmBytes, modelBytes]) => ({ wasmBytes, modelBytes }));
    // Falha (rede caiu no meio do download, por exemplo) não pode ficar
    // cacheada pra sempre - sem isso toda entrada seguinte na voz repetiria
    // o mesmo erro sem nem tentar baixar de novo.
    assetsPromise.catch(() => {
      assetsPromise = null;
    });
  }
  return assetsPromise;
}

// `df_create` roda DENTRO do worklet (ver dfn3Worklet.js) e leva alguns
// segundos - o worklet avisa o resultado por uma mensagem `INIT`. Esperar
// esse aviso aqui é o que faz uma falha de inicialização virar `throw` de
// verdade em vez de virar áudio passando cru sem ninguém perceber (quem
// chama trata: MediaSessionContext#buildMicChain segue com a track crua e
// avisa o usuário).
const INIT_TIMEOUT_MS = 30000;

// O "nível" (0-100% na UI) vira o `atten_lim` do modelo, que é um LIMITE DE
// ATENUAÇÃO EM dB, não uma porcentagem: 0 dB = não atenua nada (áudio sai
// intocado), e quanto maior, mais o modelo pode cortar. Medido com fala
// sintetizada + ruído branco (a fala sobrevive em todos os casos, -0,9 dB no
// pior deles; o número abaixo é o corte no ruído de fundo):
//   3 dB -> -2,4 | 6 -> -5,0 | 12 -> -9,7 | 24 -> -16,2 | 40 -> ~-20 | 100 -> -20,2
// Ou seja, passar a porcentagem crua como dB (o que o pacote original faz)
// desperdiça toda a metade de cima do slider - de ~40 dB pra cima não muda
// mais nada. Mapeando 0-100% em 0-40 dB o slider inteiro faz diferença
// audível, e 100% continua sendo a supressão máxima de verdade.
const MAX_ATTEN_DB = 40;
function levelToAttenDb(pct) {
  return Math.round((Math.min(100, Math.max(0, pct)) / 100) * MAX_ATTEN_DB);
}

// Diferente de RNNoise/GTCRN, este worklet não expõe mix dry/wet - o "nível"
// aqui é o próprio parâmetro nativo do modelo (limite de atenuação 0-100,
// `SET_SUPPRESSION_LEVEL` via port.postMessage), então criamos só UM
// AudioWorkletNode (sem GainNode de dry/wet em paralelo) e repassamos o
// nível direto pra ele.
export async function createDeepFilterNetStream(rawStream, { level = 100 } = {}) {
  const track = rawStream.getAudioTracks()[0];
  if (!track) throw new Error("Stream de microfone sem faixa de áudio.");

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) throw new Error("Web Audio API indisponível neste navegador.");

  const audioCtx = new AudioContextImpl({ sampleRate: 48000 });
  await audioCtx.resume?.().catch(() => {});

  let node = null;
  let source = null;
  let dest = null;

  function teardown() {
    try {
      source?.disconnect();
      node?.disconnect();
      dest?.disconnect();
      audioCtx.close();
    } catch {
      // Contexto/nós já podem ter sido derrubados - inofensivo.
    }
  }

  try {
    const { wasmBytes, modelBytes } = await getAssets();
    await audioCtx.audioWorklet.addModule(dfn3WorkletPath);

    node = new AudioWorkletNode(audioCtx, "deepfilter-audio-processor", {
      processorOptions: { wasmBytes, modelBytes, suppressionLevel: levelToAttenDb(level) },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("DeepFilterNet3 não inicializou dentro do tempo limite.")),
        INIT_TIMEOUT_MS
      );
      node.port.onmessage = (event) => {
        if (event.data?.type !== "INIT") return;
        clearTimeout(timer);
        if (event.data.ok) resolve();
        else reject(new Error(event.data.error || "Falha ao inicializar o DeepFilterNet3."));
      };
      node.onprocessorerror = () => {
        clearTimeout(timer);
        reject(new Error("O processador de áudio do DeepFilterNet3 falhou."));
      };
    });

    source = audioCtx.createMediaStreamSource(new MediaStream([track]));
    dest = audioCtx.createMediaStreamDestination();
    source.connect(node).connect(dest);
  } catch (err) {
    teardown();
    throw err;
  }

  function setLevel(pct) {
    node.port.postMessage({ type: "SET_SUPPRESSION_LEVEL", value: levelToAttenDb(pct) });
  }

  return { stream: dest.stream, setLevel, destroy: teardown };
}
