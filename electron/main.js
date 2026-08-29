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

// WebPreferences padrão de qualquer janela do app (principal ou destacada
// via window.open) - sempre sandboxed, sem Node, com o mesmo preload restrito
// (ver electron/preload.js).
function baseWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

// Trava a navegação e qualquer window.open() de uma janela à origem
// configurada - aplicado tanto na janela principal quanto em qualquer janela
// filha (ex.: o painel de voz destacado), para nunca depender de esquecer de
// repetir a proteção em algum lugar novo.
function guardWindow(webContents) {
  // Qualquer link externo (ex.: clicado dentro do chat) abre no navegador
  // padrão do SO em vez de navegar a própria janela do app para fora do
  // NaveSpeak.
  webContents.on('will-navigate', (event, url) => {
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

  // window.open() só é permitido para 'about:blank' - é exatamente (e
  // apenas) o que o app usa para "destacar" o painel de voz em uma janela de
  // verdade, própria do SO (client/src/hooks/useWindowPopout.js): a página
  // nasce em branco e o próprio renderer a povoa via portal React, sem
  // nunca navegar pra lugar nenhum sozinha - é seguro permitir porque só
  // script já rodando na origem confiada (a nossa) consegue escrever nela.
  // Qualquer outra URL (link de verdade) sempre abre no navegador do SO em
  // vez de dentro do app.
  webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: baseWebPreferences(),
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Se essa janela por sua vez abrir outra (não deveria acontecer hoje, mas
  // não custa blindar), a proteção se propaga.
  webContents.on('did-create-window', (childWindow) => {
    childWindow.setMenuBarVisibility(false);
    guardWindow(childWindow.webContents);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: baseWebPreferences(),
  });

  win.setMenuBarVisibility(false);

  // Nunca conceder permissão de mídia (câmera/microfone) ou de captura de
  // tela para qualquer origem que não seja exatamente a do nosso servidor
  // configurado - isso é o que evita que uma página inesperada ganhe acesso
  // a câmera/mic/tela silenciosamente dentro desta janela. Vale também para
  // qualquer janela filha, já que todas compartilham a mesma sessão por
  // padrão.
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

  guardWindow(win.webContents);

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
