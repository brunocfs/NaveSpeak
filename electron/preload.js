// Roda com contextIsolation habilitado: o código React da janela NÃO tem
// acesso a require/Node/Electron por padrão. Este preload expõe, através de
// contextBridge, só a única coisa que o app realmente precisa do lado
// nativo - a lista de fontes de tela para compartilhamento - e nada mais
// (sem fs, sem child_process, sem o módulo desktopCapturer inteiro).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naveSpeak', {
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
  // Chamado ao clicar numa notificação desktop (ver
  // client/src/context/NotificationContext.jsx) - só o processo main
  // consegue desminimizar/focar a janela nativa de verdade.
  focusWindow: () => ipcRenderer.send('window:focus'),
  // Inatividade real do sistema (segundos) - usada por PresenceContext.jsx
  // pra rebaixar o status pra "Ausente" depois de 15min sem uso do PC,
  // mesmo com o app em segundo plano.
  getSystemIdleTime: () => ipcRenderer.invoke('system:idle-time'),
});
