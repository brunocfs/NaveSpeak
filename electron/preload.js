// Roda com contextIsolation habilitado: o código React da janela NÃO tem
// acesso a require/Node/Electron por padrão. Este preload expõe, através de
// contextBridge, só a única coisa que o app realmente precisa do lado
// nativo - a lista de fontes de tela para compartilhamento - e nada mais
// (sem fs, sem child_process, sem o módulo desktopCapturer inteiro).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naveSpeak', {
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
  // Avisa o main QUAL fonte usar antes de chamar getDisplayMedia (ver
  // setDisplayMediaRequestHandler em main.js) - getDisplayMedia não aceita
  // passar o id escolhido no nosso próprio picker.
  setPendingScreenSource: (id) => ipcRenderer.invoke('screen:set-pending-source', id),
  // Captura nativa de áudio da fonte compartilhada (ver screenAudio.js) -
  // `start` devolve o id da captura (ou null se indisponível); os chunks PCM
  // chegam em `onChunk(id, Uint8Array)`.
  screenAudio: {
    start: (sourceId) => ipcRenderer.invoke('screen-audio:start', sourceId),
    stop: (id) => ipcRenderer.send('screen-audio:stop', id),
    onChunk: (callback) => {
      const listener = (event, id, chunk) => callback(id, chunk);
      ipcRenderer.on('screen-audio:chunk', listener);
      return () => ipcRenderer.removeListener('screen-audio:chunk', listener);
    },
  },
  // Chamado ao clicar numa notificação desktop (ver
  // client/src/context/NotificationContext.jsx) - só o processo main
  // consegue desminimizar/focar a janela nativa de verdade.
  focusWindow: () => ipcRenderer.send('window:focus'),
  // Inatividade real do sistema (segundos) - usada por PresenceContext.jsx
  // pra rebaixar o status pra "Ausente" depois de 15min sem uso do PC,
  // mesmo com o app em segundo plano.
  getSystemIdleTime: () => ipcRenderer.invoke('system:idle-time'),
  // Push-to-talk global (ver main.js) - o renderer (MediaSessionContext.jsx)
  // usa isso pra segurar/soltar a tecla mesmo com a janela sem foco, algo
  // que nenhum evento de teclado do próprio navegador entrega. `setWatchedKey`
  // manda o `KeyboardEvent.code` a vigiar (null desliga); `onKeyDown`/
  // `onKeyUp` inscrevem um callback SEM ARGUMENTOS (o main nunca informa
  // qual tecla foi apertada, só pulsa quando é a vigiada - o renderer já
  // sabe qual é), devolvendo a função de cancelar a inscrição.
  pushToTalk: {
    setWatchedKey: (code) => ipcRenderer.invoke('push-to-talk:set-watched-key', code),
    onKeyDown: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('push-to-talk:keydown', listener);
      return () => ipcRenderer.removeListener('push-to-talk:keydown', listener);
    },
    onKeyUp: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('push-to-talk:keyup', listener);
      return () => ipcRenderer.removeListener('push-to-talk:keyup', listener);
    },
  },
  // Botões da barra de título custom (ver TitleBar.jsx) - a janela roda sem
  // frame nativo (frame:false em main.js), então minimizar/maximizar/fechar
  // só existem via IPC pro processo main mexer na BrowserWindow de verdade.
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback) => {
      const listener = (event, isMaximized) => callback(isMaximized);
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  },
  // Iniciar com o sistema (PreferencesModal.jsx) - sem efeito fora do app
  // empacotado (ver main.js).
  autoLaunch: {
    get: () => ipcRenderer.invoke('app:get-auto-launch'),
    set: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  },
});
