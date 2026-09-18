// AudioWorkletProcessor que toca PCM s16 estéreo 48 kHz recebido por
// `port.postMessage(ArrayBuffer)` - usado por audio/nativeScreenAudio.js pra
// transformar o áudio nativo do compartilhamento de tela (chunks de ~10ms
// vindos do processo main) numa MediaStreamTrack.
//
// Sem prebuffer: o WASAPI simplesmente não manda chunks enquanto não há som,
// então a fila esvazia e o worklet devolve silêncio até chegar o próximo.
// ponytail: sem jitter buffer - se o IPC atrasar, sai um estalo; o teto de
// 200ms só evita latência acumulada (descarta o mais antigo).
const MAX_FRAMES = 9600;

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; // Float32Array intercalado L/R
    this.offset = 0; // frame já consumido do primeiro item da fila
    this.frames = 0; // total de frames enfileirados
    this.port.onmessage = (e) => {
      const i16 = new Int16Array(e.data);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      this.queue.push(f32);
      this.frames += f32.length / 2;
      while (this.frames > MAX_FRAMES && this.queue.length > 1) {
        this.frames -= (this.queue.shift().length / 2) - this.offset;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      const head = this.queue[0];
      if (!head) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      left[i] = head[this.offset * 2];
      right[i] = head[this.offset * 2 + 1];
      this.frames--;
      if (++this.offset * 2 >= head.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
