// Efeitos sonoros da aplicação - arquivos em client/public/sounds/, servidos
// root-relative (não passam pelo bundler, mesmo esquema de favicon.svg em
// public/). "message" ainda não tem arquivo (chega depois, som de
// notificação de mensagem) - tocar essa chave até lá só falha em silêncio
// (ver play() abaixo), nada quebra.
const SOUNDS = {
  calling: '/sounds/calling.wav', // ligação privada recebida (toca em loop enquanto chama)
  joinCall: '/sounds/joinCall.mp3', // entrou num canal de voz
  leaveCall: '/sounds/leaveCall.wav', // saiu de um canal de voz
  mute: '/sounds/mute.mp3', // ligou o "silenciar todos" (deafen)
  unmute: '/sounds/unmute.mp3', // desligou o "silenciar todos" (deafen)
  shareScreen: '/sounds/shareScreen.mp3', // começou a compartilhar tela
  message: '/sounds/message.mp3', // mensagem nova (arquivo ainda não existe)
};

// Web Audio API em vez de `new Audio(src).play()` de propósito: um <audio>
// element só decodifica/buffeia sob demanda no primeiro play(), e pra
// arquivo grande (calling.wav tem 6.6MB) isso é um delay perceptível bem no
// instante em que o som deveria tocar. Aqui o fetch+decode acontece uma vez,
// adiantado (preloadSounds, chamado no fim deste arquivo assim que o módulo
// é importado) - quando playSound() é chamado de verdade, o AudioBuffer já
// está pronto em memória e o play em si (source.start) é instantâneo.
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

// O navegador cria o AudioContext em estado "suspended" até a primeira
// interação do usuário com a página inteira (não precisa ser um clique num
// botão de som) - resume() em si é rápido, mas só roda depois desse gesto.
// Assim que QUALQUER clique/tecla/toque acontece em qualquer lugar do app,
// já tentamos retomar aqui, bem mais cedo do que o primeiro playSound() de
// verdade (ex.: clicar em "silenciar todos") - quando esse clique chegar, o
// contexto já está 'running' e não há mais essa espera no caminho crítico.
function primeAudioContextOnFirstGesture() {
  if (typeof window === 'undefined') return;
  const resumeOnce = () => {
    getAudioContext()
      .resume()
      .catch(() => {});
  };
  window.addEventListener('pointerdown', resumeOnce, { once: true, capture: true });
  window.addEventListener('keydown', resumeOnce, { once: true, capture: true });
}

// Amplitude abaixo disso é tratada como silêncio (~-34dB) - limiar generoso
// o bastante pra não confundir ruído de fundo/fade-in com "ainda não
// começou o som", mas suficiente pra pular o ar morto no início do arquivo.
const SILENCE_THRESHOLD = 0.02;
// Nunca recorta mais que isso do início - se nada passar do limiar nesse
// tanto de tempo, o arquivo provavelmente é só baixo mesmo (ou o limiar não
// bateu por algum motivo); mais seguro não recortar nada do que recortar o
// som inteiro.
const MAX_TRIM_SECONDS = 0.6;

// Boa parte do "ainda tem um delayzinho" depois do preload já não é mais
// rede/decode - é ar morto GRAVADO no início do próprio arquivo (silêncio de
// alguns décimos de segundo antes do som "de verdade" começar, comum em
// gravação/exportação de efeito sonoro). Aqui a gente varre as primeiras
// amostras decodificadas e acha onde o som realmente começa, uma vez só por
// arquivo - playSound() usa esse offset pra começar a tocar dali, não do
// frame 0 do arquivo.
function findOnsetSeconds(buffer) {
  const limit = Math.min(buffer.length, Math.floor(MAX_TRIM_SECONDS * buffer.sampleRate));
  let firstLoudSample = null;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < limit; i++) {
      if (Math.abs(data[i]) >= SILENCE_THRESHOLD) {
        if (firstLoudSample === null || i < firstLoudSample) firstLoudSample = i;
        break;
      }
    }
  }

  return firstLoudSample === null ? 0 : firstLoudSample / buffer.sampleRate;
}

const buffers = new Map(); // name -> AudioBuffer já decodificado
const onsets = new Map(); // name -> segundos de silêncio inicial a pular (ver findOnsetSeconds)
const loading = new Map(); // name -> Promise<AudioBuffer> em andamento

function loadBuffer(name) {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name));
  if (loading.has(name)) return loading.get(name);

  const promise = fetch(SOUNDS[name])
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((arrayBuffer) => getAudioContext().decodeAudioData(arrayBuffer))
    .then((buffer) => {
      buffers.set(name, buffer);
      const onset = findOnsetSeconds(buffer);
      onsets.set(name, onset);
      if (onset > 0) {
        console.log(`[sounds] "${name}": ${Math.round(onset * 1000)}ms de silêncio inicial recortado.`);
      }
      loading.delete(name);
      return buffer;
    })
    .catch((err) => {
      loading.delete(name);
      throw err;
    });

  loading.set(name, promise);
  return promise;
}

// Dispara o carregamento de todos os sons conhecidos - best-effort (um som
// que falhe, ex. "message" antes do arquivo existir, não afeta os outros).
// Chamado automaticamente no fim deste arquivo.
export function preloadSounds() {
  for (const name of Object.keys(SOUNDS)) {
    loadBuffer(name).catch((err) => {
      console.warn(`[sounds] Falha ao pré-carregar "${name}":`, err.message);
    });
  }
}

// Token por som "em loop" - permite que stopSound() cancele um playSound()
// ainda em voo (esperando o buffer carregar/o AudioContext retomar) antes
// dele sequer começar a tocar. Sem isso, aceitar uma ligação bem rápido
// (antes do "calling" terminar de carregar) deixaria o loop começando
// sozinho um instante depois de já ter sido aceita.
const loopTokens = new Map();
const activeLoopSources = new Map(); // name -> AudioBufferSourceNode ativo

// Quem chama playSound (ex.: handleVoiceUpdate em MediaSessionContext,
// reagindo a voice:update) às vezes não tem como garantir que o evento de
// origem só aconteça uma vez de verdade - reconexão de socket, uma
// atualização de presença chegando em duplicata, etc. podem gerar duas
// chamadas pro MESMO acontecimento real. Em vez de caçar cada fonte possível
// de evento duplicado, o player em si ignora uma repetição do mesmo som
// muito próxima da anterior - ninguém precisa ouvir "entrou no canal" duas
// vezes em 300ms. Não se aplica a loop (calling): ali quem controla
// início/fim é playSound/stopSound em pares bem definidos, não eventos
// externos repetíveis.
const DEDUPE_WINDOW_MS = 300;
const lastPlayedAt = new Map();

// Toca um efeito sonoro pelo nome (chaves de SOUNDS acima). Nunca lança -
// arquivo ausente/404, AudioContext bloqueado por autoplay (sem interação do
// usuário ainda) etc. só geram um aviso no console.
export async function playSound(name, { volume = 1, loop = false } = {}) {
  if (typeof window === 'undefined' || !SOUNDS[name]) return;

  if (!loop) {
    const now = Date.now();
    if (now - (lastPlayedAt.get(name) ?? 0) < DEDUPE_WINDOW_MS) return;
    lastPlayedAt.set(name, now);
  }

  let myToken;
  if (loop) {
    myToken = (loopTokens.get(name) ?? 0) + 1;
    loopTokens.set(name, myToken);
  }

  try {
    const ctx = getAudioContext();
    // Normalmente já 'running' a essa altura (primeAudioContextOnFirstGesture
    // resolveu isso no primeiro clique/tecla do app) - o resume() aqui é só
    // uma rede de segurança pro caso de playSound ser a própria primeira
    // interação do usuário com a página.
    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = await loadBuffer(name); // já resolvido na prática (preload rodou no import do módulo)
    if (loop && loopTokens.get(name) !== myToken) return; // stopSound já foi chamado enquanto isso carregava

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const onset = onsets.get(name) ?? 0;
    // Em loop, loopStart precisa ser setado à parte - o offset passado pra
    // start() só vale pra primeira volta; sem isso, cada repetição do loop
    // voltaria a incluir o silêncio inicial de novo.
    if (loop && onset > 0) source.loopStart = onset;

    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start(0, onset);

    if (loop) activeLoopSources.set(name, source);
  } catch (err) {
    console.warn(`[sounds] Não foi possível tocar "${name}":`, err.message);
  }
}

// Para um som em loop (hoje só "calling" - CallContext.jsx toca em loop
// enquanto a ligação está chamando e para assim que é aceita/recusada/
// cancelada).
export function stopSound(name) {
  loopTokens.set(name, (loopTokens.get(name) ?? 0) + 1); // invalida qualquer playSound(loop) ainda em voo

  const source = activeLoopSources.get(name);
  if (!source) return;
  try {
    source.stop();
  } catch {
    // já tinha terminado sozinho (loop nunca termina sozinho, mas por
    // segurança) - nada a fazer.
  }
  activeLoopSources.delete(name);
}

if (typeof window !== 'undefined') {
  preloadSounds();
  primeAudioContextOnFirstGesture();
}
