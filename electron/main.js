// Processo main do Electron (CommonJS - mais compatível entre versões do
// Electron do que ESM aqui, especialmente para o preload).
const path = require('node:path');
const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
require('dotenv').config();

// O Electron é só uma "casca" nativa em volta do mesmo app web: ele carrega
// a mesma UI React que roda no navegador, servida pelo servidor NaveSpeak
// (Fase 5 do server já serve o client buildado). Isso significa que todo
// mundo do grupo vê sempre a versão mais atual da UI sem precisar reinstalar
// o app Electron.
const SERVER_URL = process.env.NAVESPEAK_SERVER_URL || 'http://localhost:4000';
const SERVER_ORIGIN = new URL(SERVER_URL).origin;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.setMenuBarVisibility(false);

  // Nunca conceder permissão de mídia (câmera/microfone) ou de captura de
  // tela para qualquer origem que não seja exatamente a do nosso servidor
  // configurado - isso é o que evita que uma página inesperada ganhe acesso
  // a câmera/mic/tela silenciosamente dentro desta janela.
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let requestOrigin = null;
    try {
      requestOrigin = details?.requestingUrl ? new URL(details.requestingUrl).origin : null;
    } catch {
      requestOrigin = null;
    }
    const allowed = requestOrigin === SERVER_ORIGIN && (permission === 'media' || permission === 'display-capture');
    callback(allowed);
  });

  // Trava a navegação dentro da janela à origem configurada. Qualquer link
  // externo (ex.: clicado dentro do chat) abre no navegador padrão do SO em
  // vez de navegar a própria janela do app para fora do NaveSpeak.
  win.webContents.on('will-navigate', (event, url) => {
    let targetOrigin = null;
    try {
      targetOrigin = new URL(url).origin;
    } catch {
      targetOrigin = null;
    }
    if (targetOrigin !== SERVER_ORIGIN) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(SERVER_URL);
  return win;
}

app.whenReady().then(() => {
  // Único ponto de contato com desktopCapturer: devolve apenas id/nome/
  // miniatura de cada janela/tela disponível - nunca o módulo inteiro, e só
  // isso é exposto ao renderer via preload.js.
  ipcMain.handle('screen:get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 200, height: 120 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
