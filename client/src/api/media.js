// Abstrai a captura de tela entre o navegador comum e o app Electron.
//
// No Electron, `getDisplayMedia` não funciona por padrão dentro de um
// BrowserWindow - por isso o processo main expõe (via preload, com
// contextBridge) uma lista de fontes de tela/janela através de
// `desktopCapturer`, e aqui montamos a stream com os constraints específicos
// do Chromium (`chromeMediaSourceId`). O preload NUNCA expõe o módulo
// `desktopCapturer` inteiro ao renderer, só essa função de listagem
// filtrada - ver electron/preload.js (Fase 5).
export function isElectron() {
  return typeof window !== 'undefined' && Boolean(window.naveSpeak?.getScreenSources);
}

// Câmera, microfone e captura de tela só ficam disponíveis em "contextos
// seguros" (https:// ou localhost) - fora do Electron, o navegador nem
// expõe navigator.mediaDevices em outros casos (ex.: http://<ip> puro),
// o que rendia um TypeError críptico ("Cannot read properties of undefined
// (reading 'getUserMedia')") em vez de uma mensagem que explica o motivo.
function assertMediaDevicesAvailable() {
  if (isElectron()) return; // Electron sempre roda em contexto "seguro" (protocolo file/app)
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Seu navegador bloqueou o acesso a câmera/microfone/tela porque esta página não está em ' +
        'HTTPS nem em localhost. Isso é uma exigência de segurança do navegador, não um bug do app.'
    );
  }
}

export async function listScreenSources() {
  if (!isElectron()) return null;
  return window.naveSpeak.getScreenSources();
}

// Lista os microfones/webcams disponíveis (Preferências > Dispositivos e
// fallback em joinVoice/shareCamera abaixo). Sem permissão concedida ainda,
// o navegador devolve os dispositivos mas com `label` vazio (só o deviceId
// existe) - quem chama decide se pede permissão antes pra mostrar nomes.
export async function listMediaDevices() {
  assertMediaDevicesAvailable();
  const list = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: list.filter((d) => d.kind === 'audioinput'),
    cameras: list.filter((d) => d.kind === 'videoinput'),
  };
}

// Pede microfone+câmera só para o navegador liberar os `label` reais dos
// dispositivos em enumerateDevices (fica vazio até alguma permissão de
// mídia ser concedida) - chamado a partir de um clique explícito no botão
// "Permitir acesso" da tela de Preferências, nunca sozinho. Encerra as
// tracks imediatamente: aqui só queremos o rótulo, não uma captura viva.
// Pede os dois tipos separado porque uma máquina sem webcam (ou sem
// permissão de câmera) não pode derrubar a liberação do microfone, e
// vice-versa.
export async function unlockDeviceLabels() {
  assertMediaDevicesAvailable();
  const results = { mic: false, camera: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    results.mic = true;
  } catch {
    // Sem permissão/sem microfone - segue com a câmera mesmo assim.
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    results.camera = true;
  } catch {
    // Idem, sem câmera.
  }
  return results;
}

// Tenta os constraints pedidos (com deviceId exato, quando informado) e,
// se o dispositivo salvo não existir mais (desconectado, driver removido -
// `OverconstrainedError`/`NotFoundError`), refaz a captura com o padrão do
// sistema em vez de derrubar a chamada. `fellBack` avisa quem chamou que a
// preferência salva não pôde ser usada desta vez.
async function getStreamWithFallback(constraints, fallbackConstraints) {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(constraints), fellBack: false };
  } catch (err) {
    if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      return { stream, fellBack: true };
    }
    throw err;
  }
}

// Usado por joinVoice (MediaSessionContext) ao entrar na voz - reaproveita
// o microfone salvo em Preferências, com fallback para o padrão do sistema.
//
// `noiseSuppressionMode` (Preferências > Áudio, ver PreferencesContext) só
// decide o constraint NATIVO `noiseSuppression` do WebRTC:
// - 'native': liga o supressor nativo do navegador (comportamento de sempre).
// - 'off'/'rnnoise': desliga - no modo 'rnnoise' o processamento de verdade
//   acontece depois, via WASM (ver audio/rnnoise.js), e rodar os dois juntos
//   só arriscaria artefato (um supressor "limpando" o que o outro já mexeu).
// echoCancellation/autoGainControl ficam sempre ligados - não são o alvo
// deste controle e desligá-los não tem bom motivo de UX aqui.
function micAudioConstraints(deviceId, noiseSuppressionMode) {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: noiseSuppressionMode === "native",
  };
}

export async function requestMicStream(deviceId, { noiseSuppressionMode = "native" } = {}) {
  assertMediaDevicesAvailable();
  return getStreamWithFallback(
    { audio: micAudioConstraints(deviceId, noiseSuppressionMode) },
    { audio: micAudioConstraints(null, noiseSuppressionMode) }
  );
}

export async function requestScreenStream(sourceId) {
  assertMediaDevicesAvailable();

  if (isElectron()) {
    if (!sourceId) throw new Error('Selecione uma janela ou tela para compartilhar.');
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
    });
  }

  // Navegador comum: isso só deve ser chamado a partir de um gesto explícito
  // do usuário (onClick do botão "Compartilhar tela") - nunca automaticamente
  // ao carregar a página, senão o navegador bloqueia o pedido de permissão.
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
}

// Reaproveita a webcam salva em Preferências (deviceId), com fallback para
// o padrão do sistema se ela não existir mais - mesma lógica de
// requestMicStream acima.
export async function requestCameraStream(deviceId) {
  assertMediaDevicesAvailable();
  return getStreamWithFallback(
    { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false },
    { video: true, audio: false }
  );
}

export { assertMediaDevicesAvailable };
