// AudioWorkletProcessor do DeepFilterNet3 - vendorizado a partir de
// deepfilternet3-noise-filter@1.3.0 (dist/index.esm.js, string `workletCode`,
// MIT/Apache-2.0 - github.com/mezonai/mezon-noise-suppression), com três
// mudanças em relação ao original:
//
// 1. `initSync` recebe os BYTES crus do WASM (`wasmBytes`) e compila DENTRO
//    do próprio worklet, em vez de receber um `WebAssembly.Module` já
//    compilado na thread principal via `processorOptions`. Os dois caminhos
//    funcionam; este evita depender de structured clone de Module entre
//    threads e mantém os bytes como única entrada.
// 2. Polyfills de TextDecoder/TextEncoder e `crypto.getRandomValues` (ver
//    abaixo) - o AudioWorkletGlobalScope do Chrome não tem NENHUM dos três
//    (medido: `typeof crypto === "undefined"`), e o glue do wasm-bindgen usa
//    os dois primeiros já no topo do módulo, sem guarda.
// 3. O resultado da inicialização é avisado por mensagem (`INIT`) pro main
//    thread, em vez de só virar console.error - ver comentário no
//    construtor.
//
// Sobre o `RuntimeError: unreachable` dentro de `df_create` que manteve este
// modo desligado por um tempo: NÃO era bug do WASM, nem do transporte do
// Module entre threads. Era o modelo chegando descompactado - servidor
// estático mandando `Content-Encoding: gzip` por causa da extensão `.gz`, o
// navegador descompactando sozinho e o Rust recebendo um TAR onde esperava
// gzip, panicando. Corrigido do lado de quem baixa (audio/deepfilternet.js:
// asset servido como `.bin` + checagem dos magic bytes).
//
// Resto do arquivo (glue wasm-bindgen, ring buffer de entrada/saída,
// mensagens de nível/bypass) é o comportamento original do pacote, só
// reformatado de string escapada pra arquivo de verdade (registrado via
// audioWorklet.addModule, ver audio/deepfilternet.js - mesmo padrão de
// gtcrn.js/rnnoise.js, sem Blob/createObjectURL).

// AudioWorkletGlobalScope não tem TextDecoder/TextEncoder em todo navegador -
// wasm-bindgen 0.2.126 cria `new TextDecoder()` no topo do módulo (sem
// guarda), o que derruba registerProcessor() inteiro com ReferenceError se
// faltar. Só usado pra strings de erro/diagnóstico - o caminho de áudio
// passa bytes/floats direto.
if (typeof TextDecoder === "undefined") {
  globalThis.TextDecoder = class {
    decode(bytes) {
      if (!bytes) return "";
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
      let out = "";
      for (let i = 0; i < u8.length; ) {
        const c = u8[i++];
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (u8[i++] & 0x3f));
        else if (c < 0xf0)
          out += String.fromCharCode(((c & 0x0f) << 12) | ((u8[i++] & 0x3f) << 6) | (u8[i++] & 0x3f));
        else {
          const cp =
            (((c & 0x07) << 18) | ((u8[i++] & 0x3f) << 12) | ((u8[i++] & 0x3f) << 6) | (u8[i++] & 0x3f)) - 0x10000;
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
      }
      return out;
    }
  };
}
if (typeof TextEncoder === "undefined") {
  globalThis.TextEncoder = class {
    encode(str) {
      const out = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else if (c >= 0xd800 && c < 0xdc00) {
          const c2 = str.charCodeAt(++i);
          c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
          out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
      return new Uint8Array(out);
    }
    encodeInto(str, dst) {
      const enc = this.encode(str);
      dst.set(enc);
      return { read: str.length, written: enc.length };
    }
  };
}

// Mesmo motivo do guard de TextDecoder/TextEncoder acima: AudioWorkletGlobalScope
// não faz parte da mixin WindowOrWorkerGlobalScope, então `crypto` (Web
// Crypto API) simplesmente não existe aí (medido no Chrome: `typeof crypto`
// = "undefined" dentro do worklet) - sem esta guarda,
// `globalThis.crypto.getRandomValues`, chamada pelo import
// __wbg_getRandomValues_* abaixo, dá TypeError. Não precisa ser
// criptograficamente forte aqui - é só semente de hash/estado interno do
// Rust, não segredo - então Math.random() serve de fallback.
if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
  const existing = typeof crypto !== "undefined" ? crypto : undefined;
  globalThis.crypto = {
    ...existing,
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  };
}

function df_create(model_bytes, atten_lim) {
  const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_malloc_command_export);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.df_create(ptr0, len0, atten_lim);
  return ret >>> 0;
}

function df_get_frame_length(st) {
  const ret = wasm.df_get_frame_length(st);
  return ret >>> 0;
}

function df_process_frame(st, input) {
  const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc_command_export);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.df_process_frame(st, ptr0, len0);
  return ret;
}

function df_set_atten_lim(st, lim_db) {
  wasm.df_set_atten_lim(st, lim_db);
}

function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg___wbindgen_throw_344f42d3211c4765: function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_getRandomValues_cc7f052a444bb2ce: function () {
      return handleError(function (arg0, arg1) {
        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
      }, arguments);
    },
    __wbg_new_from_slice_ddf8b82c4d6af38e: function (arg0, arg1) {
      const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
      return ret;
    },
    __wbindgen_init_externref_table: function () {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, undefined);
      table.set(offset + 0, undefined);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    },
  };
  return { __proto__: null, "./df_bg.js": import0 };
}

typeof FinalizationRegistry === "undefined"
  ? {}
  : new FinalizationRegistry((ptr) => wasm.__wbg_dfstate_free(ptr, 1));

function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc_command_export();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}

function getArrayF32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
  if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
    cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    const idx = addToExternrefTable0(e);
    wasm.__wbindgen_exn_store_command_export(idx);
  }
}

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getFloat32ArrayMemory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

let cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasm;
function __wbg_finalize_init(instance) {
  wasm = instance.exports;
  cachedFloat32ArrayMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}

// ÚNICA mudança de comportamento em relação ao pacote original: `module`
// aqui são sempre os BYTES CRUS do wasm (ArrayBuffer/Uint8Array), nunca um
// `WebAssembly.Module` pré-compilado noutra thread - ver comentário no topo
// do arquivo. `new WebAssembly.Module(bytes)` compila DENTRO do worklet.
function initSync(wasmBytes) {
  if (wasm !== undefined) return wasm;
  const imports = __wbg_get_imports();
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance);
}

const WorkletMessageTypes = {
  SET_SUPPRESSION_LEVEL: "SET_SUPPRESSION_LEVEL",
  SET_BYPASS: "SET_BYPASS",
};

class DeepFilterAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.dfModel = null;
    this.inputWritePos = 0;
    this.inputReadPos = 0;
    this.outputWritePos = 0;
    this.outputReadPos = 0;
    this.bypass = false;
    this.isInitialized = false;
    this.tempFrame = null;
    this.bufferSize = 8192;
    this.inputBuffer = new Float32Array(this.bufferSize);
    this.outputBuffer = new Float32Array(this.bufferSize);
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    // Diferente do pacote original (que só logava no console e seguia
    // deixando o áudio passar cru, sem ninguém do lado de fora saber),
    // o resultado da inicialização vai por mensagem pro main thread -
    // audio/deepfilternet.js espera esse `INIT` e transforma falha em
    // erro de verdade, com fallback pro mic sem processamento.
    try {
      initSync(options.processorOptions.wasmBytes);
      const modelBytes = new Uint8Array(options.processorOptions.modelBytes);
      const handle = df_create(modelBytes, options.processorOptions.suppressionLevel ?? 50);
      const frameLength = df_get_frame_length(handle);
      this.dfModel = { handle, frameLength };
      this.bufferSize = frameLength * 4;
      this.inputBuffer = new Float32Array(this.bufferSize);
      this.outputBuffer = new Float32Array(this.bufferSize);
      this.tempFrame = new Float32Array(frameLength);
      this.isInitialized = true;
      this.port.postMessage({ type: "INIT", ok: true, frameLength });
    } catch (error) {
      this.isInitialized = false;
      this.port.postMessage({ type: "INIT", ok: false, error: String((error && error.message) || error) });
    }
  }
  handleMessage(data) {
    switch (data.type) {
      case WorkletMessageTypes.SET_SUPPRESSION_LEVEL:
        if (this.dfModel && typeof data.value === "number") {
          const level = Math.max(0, Math.min(100, Math.floor(data.value)));
          df_set_atten_lim(this.dfModel.handle, level);
        }
        break;
      case WorkletMessageTypes.SET_BYPASS:
        this.bypass = Boolean(data.value);
        break;
    }
  }
  getInputAvailable() {
    return (this.inputWritePos - this.inputReadPos + this.bufferSize) % this.bufferSize;
  }
  getOutputAvailable() {
    return (this.outputWritePos - this.outputReadPos + this.bufferSize) % this.bufferSize;
  }
  process(inputList, outputList) {
    const sourceLimit = Math.min(inputList.length, outputList.length);
    const input = inputList[0]?.[0];
    if (!input) return true;
    if (!this.isInitialized || !this.dfModel || this.bypass || !this.tempFrame) {
      for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
        const output = outputList[inputNum];
        const channelCount = output.length;
        for (let channelNum = 0; channelNum < channelCount; channelNum++) {
          output[channelNum].set(input);
        }
      }
      return true;
    }
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWritePos] = input[i];
      this.inputWritePos = (this.inputWritePos + 1) % this.bufferSize;
    }
    const frameLength = this.dfModel.frameLength;
    while (this.getInputAvailable() >= frameLength) {
      for (let i = 0; i < frameLength; i++) {
        this.tempFrame[i] = this.inputBuffer[this.inputReadPos];
        this.inputReadPos = (this.inputReadPos + 1) % this.bufferSize;
      }
      const processed = df_process_frame(this.dfModel.handle, this.tempFrame);
      for (let i = 0; i < processed.length; i++) {
        this.outputBuffer[this.outputWritePos] = processed[i];
        this.outputWritePos = (this.outputWritePos + 1) % this.bufferSize;
      }
    }
    const outputAvailable = this.getOutputAvailable();
    if (outputAvailable >= 128) {
      for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
        const output = outputList[inputNum];
        const channelCount = output.length;
        for (let channelNum = 0; channelNum < channelCount; channelNum++) {
          const outputChannel = output[channelNum];
          let readPos = this.outputReadPos;
          for (let i = 0; i < 128; i++) {
            outputChannel[i] = this.outputBuffer[readPos];
            readPos = (readPos + 1) % this.bufferSize;
          }
        }
      }
      this.outputReadPos = (this.outputReadPos + 128) % this.bufferSize;
    }
    return true;
  }
}
registerProcessor("deepfilter-audio-processor", DeepFilterAudioProcessor);
