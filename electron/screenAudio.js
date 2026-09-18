// Captura de áudio nativa (só Windows) pro compartilhamento de tela - o
// Chromium/Electron só oferece loopback do SISTEMA INTEIRO (getDisplayMedia),
// então aqui usamos a Process Loopback API do WASAPI via `loopback-capture`:
// - fonte 'window:*' -> INCLUDE: só o áudio do processo (e filhos) dono da
//   janela escolhida;
// - fonte 'screen:*' -> EXCLUDE: áudio do sistema TODO menos o do próprio
//   NaveSpeak (a voz da call não volta pra quem assiste, e quem compartilha
//   continua ouvindo a call - diferente de `loopbackWithMute`).
// O PCM (s16 estéreo 48 kHz) segue por IPC pro renderer, que transforma numa
// MediaStreamTrack (client/src/audio/nativeScreenAudio.js).
//
// Fora do Windows (ou se o addon/API não existir - build antigo do Win10)
// `start` devolve `null` e o renderer cai no comportamento antigo.
const { ipcMain } = require("electron");

let loopback = null;
let getWindowThreadProcessId = null;
function load() {
  if (process.platform !== "win32") return false;
  if (loopback) return true;
  try {
    loopback = require("loopback-capture");
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    getWindowThreadProcessId = user32.func(
      "uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)",
    );
    return true;
  } catch (err) {
    console.error("[screenAudio] addon indisponível:", err);
    loopback = null;
    return false;
  }
}

// "window:<HWND>:0" (id de desktopCapturer) -> PID dono da janela.
// ponytail: janelas UWP (ApplicationFrameHost) resolvem o PID errado e saem
// mudas; tratar exigiria OpenProcess + nome do exe.
function pidOfWindowSource(sourceId) {
  const hwnd = Number(sourceId.split(":")[1]);
  if (!hwnd) return 0;
  const out = [0];
  getWindowThreadProcessId(hwnd, out);
  return out[0];
}

const captures = new Map(); // id -> LoopbackCapture
let nextId = 1;

function stop(id) {
  const capture = captures.get(id);
  if (!capture) return;
  captures.delete(id);
  try {
    capture.stop();
  } catch {}
}

function registerScreenAudioIpc() {
  // Devolve o id da captura, ou null se não deu pra capturar (renderer usa o
  // fallback). `sender` é a janela que pediu - pode ser uma janela destacada.
  ipcMain.handle("screen-audio:start", (event, sourceId) => {
    if (!load() || typeof sourceId !== "string") return null;
    const isWindow = sourceId.startsWith("window:");
    const pid = isWindow ? pidOfWindowSource(sourceId) : process.pid;
    if (!pid) return null;

    const id = nextId++;
    const sender = event.sender;
    try {
      const capture = new loopback.LoopbackCapture();
      capture.start(pid, isWindow, (chunk) => {
        if (!sender.isDestroyed()) sender.send("screen-audio:chunk", id, chunk);
      });
      captures.set(id, capture);
      // Se a janela que pediu fechar sem parar, libera a captura.
      sender.once("destroyed", () => stop(id));
      return id;
    } catch (err) {
      console.error("[screenAudio] start falhou:", err);
      return null;
    }
  });

  ipcMain.on("screen-audio:stop", (event, id) => stop(id));
}

module.exports = { registerScreenAudioIpc };
