// Roda com contextIsolation habilitado: o código React da janela NÃO tem
// acesso a require/Node/Electron por padrão. Este preload expõe, através de
// contextBridge, só a única coisa que o app realmente precisa do lado
// nativo - a lista de fontes de tela para compartilhamento - e nada mais
// (sem fs, sem child_process, sem o módulo desktopCapturer inteiro).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('naveSpeak', {
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
});
