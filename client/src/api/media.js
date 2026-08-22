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

export async function requestCameraStream() {
  assertMediaDevicesAvailable();
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

// Reexportado para o hook useMediasoup usar antes de pedir o microfone ao
// entrar na voz (o único lugar que chama getUserMedia fora deste módulo).
export { assertMediaDevicesAvailable };
