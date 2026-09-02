// Processo main do Electron (CommonJS - mais compatível entre versões do
// Electron do que ESM aqui, especialmente para o preload).
const path = require("node:path");
const { execFile } = require("node:child_process");
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  shell,
  session,
  powerMonitor,
  dialog,
} = require("electron");
const { autoUpdater } = require("electron-updater");

// Push-to-talk global (funciona com a janela sem foco/minimizada) - keydown/
// keyup do navegador (ver MediaSessionContext.jsx) só chega enquanto a
// JANELA está em foco, é limitação do próprio navegador/Chromium, não dá
// pra contornar dentro do renderer. uiohook-napi é um hook de teclado no
// nível do SO (roda aqui no processo main, que tem acesso nativo), then
// entrega os eventos reais de tecla pressionada/solta não importa qual
// janela (ou nenhuma) esteja em foco - é assim que Discord/Mumble também
// resolvem isso.
//
// `try/catch` no require: a plataforma pode não ter um binário nativo
// pré-compilado disponível (ver prebuilds/ do pacote) - nesse caso o
// push-to-talk simplesmente não funciona fora do foco da janela (o
// listener normal de keydown/keyup do renderer continua funcionando com a
// janela em foco, sem regressão), em vez de travar o app inteiro.
let uIOhook = null;
let UiohookKey = null;
try {
  ({ uIOhook, UiohookKey } = require("uiohook-napi"));
} catch (err) {
  console.error("[push-to-talk] uiohook-napi indisponível nesta plataforma:", err.message);
}

// Traduz `KeyboardEvent.code` do DOM (o que o renderer guarda em
// Preferências, ver client/src/context/PreferencesContext.jsx) para o
// keycode numérico do uiohook - os dois não usam o mesmo vocabulário. Só
// precisa de uma direção (DOM -> uiohook): o processo main só precisa saber
// QUAL tecla nativa vigiar; nunca manda de volta pro renderer nada além de
// "a tecla vigiada foi pressionada/solta" (ver setWatchedKey/listeners
// abaixo) - o main NUNCA repassa teclas arbitrárias pro renderer, só pulsos
// da única tecla configurada, pra isso nunca virar um keylogger genérico.
const DOM_CODE_TO_UIOHOOK_KEY = {};
if (UiohookKey) {
  Object.assign(DOM_CODE_TO_UIOHOOK_KEY, {
    Space: UiohookKey.Space,
    Tab: UiohookKey.Tab,
    Backspace: UiohookKey.Backspace,
    Enter: UiohookKey.Enter,
    CapsLock: UiohookKey.CapsLock,
    Escape: UiohookKey.Escape,
    PageUp: UiohookKey.PageUp,
    PageDown: UiohookKey.PageDown,
    End: UiohookKey.End,
    Home: UiohookKey.Home,
    ArrowLeft: UiohookKey.ArrowLeft,
    ArrowUp: UiohookKey.ArrowUp,
    ArrowRight: UiohookKey.ArrowRight,
    ArrowDown: UiohookKey.ArrowDown,
    Insert: UiohookKey.Insert,
    Delete: UiohookKey.Delete,
    Semicolon: UiohookKey.Semicolon,
    Equal: UiohookKey.Equal,
    Comma: UiohookKey.Comma,
    Minus: UiohookKey.Minus,
    Period: UiohookKey.Period,
    Slash: UiohookKey.Slash,
    Backquote: UiohookKey.Backquote,
    BracketLeft: UiohookKey.BracketLeft,
    Backslash: UiohookKey.Backslash,
    BracketRight: UiohookKey.BracketRight,
    Quote: UiohookKey.Quote,
    // uiohook só distingue lado em Ctrl/Alt/Shift/Meta direitos - o
    // esquerdo de cada um é o nome "base" (sem sufixo), diferente do DOM
    // que sempre nomeia os dois lados explicitamente.
    ControlLeft: UiohookKey.Ctrl,
    ControlRight: UiohookKey.CtrlRight,
    AltLeft: UiohookKey.Alt,
    AltRight: UiohookKey.AltRight,
    ShiftLeft: UiohookKey.Shift,
    ShiftRight: UiohookKey.ShiftRight,
    MetaLeft: UiohookKey.Meta,
    MetaRight: UiohookKey.MetaRight,
    NumLock: UiohookKey.NumLock,
    ScrollLock: UiohookKey.ScrollLock,
    PrintScreen: UiohookKey.PrintScreen,
    Numpad0: UiohookKey.Numpad0,
    Numpad1: UiohookKey.Numpad1,
    Numpad2: UiohookKey.Numpad2,
    Numpad3: UiohookKey.Numpad3,
    Numpad4: UiohookKey.Numpad4,
    Numpad5: UiohookKey.Numpad5,
    Numpad6: UiohookKey.Numpad6,
    Numpad7: UiohookKey.Numpad7,
    Numpad8: UiohookKey.Numpad8,
    Numpad9: UiohookKey.Numpad9,
    NumpadMultiply: UiohookKey.NumpadMultiply,
    NumpadAdd: UiohookKey.NumpadAdd,
    NumpadSubtract: UiohookKey.NumpadSubtract,
    NumpadDecimal: UiohookKey.NumpadDecimal,
    NumpadDivide: UiohookKey.NumpadDivide,
  });
  for (let i = 0; i <= 9; i++) DOM_CODE_TO_UIOHOOK_KEY[`Digit${i}`] = UiohookKey[String(i)];
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") DOM_CODE_TO_UIOHOOK_KEY[`Key${letter}`] = UiohookKey[letter];
  for (let i = 1; i <= 24; i++) DOM_CODE_TO_UIOHOOK_KEY[`F${i}`] = UiohookKey[`F${i}`];
}

// Keycode (uiohook) atualmente vigiado, ou null = hook parado. Só existe
// UMA tecla vigiada por vez (o app só tem um producer de mic próprio) -
// nunca precisa de mais que isso.
let watchedKeycode = null;
let hookStarted = false;

function stopPushToTalkHook() {
  if (hookStarted) {
    try {
      uIOhook.stop();
    } catch (err) {
      console.error("[push-to-talk] Falha ao parar o hook global:", err.message);
    }
    hookStarted = false;
  }
  watchedKeycode = null;
}

// Chamado pelo renderer (via IPC) toda vez que o efeito de push-to-talk em
// MediaSessionContext.jsx arma/desarma - ou seja, só roda enquanto o
// usuário está DE VERDADE numa chamada com push-to-talk ligado (não o tempo
// todo o app estiver aberto), minimizando o quanto o hook global fica ativo.
// Devolve `true`/`false` pro renderer saber se a tecla escolhida tem
// suporte fora do foco (sem suporte, o botão de segurar continua
// funcionando normalmente, só que apenas com a janela em foco).
function setPushToTalkWatchedKey(code) {
  if (!uIOhook) {
    console.warn("[push-to-talk] Pedido de vigiar tecla sem uiohook disponível - ignorado.");
    return false;
  }
  if (!code) {
    console.log("[push-to-talk] Desligando hook global (sem tecla a vigiar).");
    stopPushToTalkHook();
    return true;
  }
  const keycode = DOM_CODE_TO_UIOHOOK_KEY[code];
  if (keycode === undefined) {
    console.warn(`[push-to-talk] Tecla "${code}" sem tradução pro hook global - fica só com a janela em foco.`);
    stopPushToTalkHook();
    return false;
  }
  watchedKeycode = keycode;
  if (!hookStarted) {
    try {
      uIOhook.start();
      hookStarted = true;
    } catch (err) {
      console.error("[push-to-talk] Falha ao iniciar o hook global:", err.message);
      watchedKeycode = null;
      return false;
    }
  }
  console.log(`[push-to-talk] Vigiando tecla "${code}" (keycode ${keycode}) globalmente.`);
  return true;
}

if (uIOhook) {
  // Filtra pela tecla vigiada AQUI, antes de mandar qualquer coisa pro
  // renderer - o renderer nunca recebe qual tecla foi apertada, só um pulso
  // "a tecla configurada mudou de estado" (ver preload.js).
  uIOhook.on("keydown", (e) => {
    if (watchedKeycode !== null && e.keycode === watchedKeycode) {
      console.log("[push-to-talk] keydown da tecla vigiada");
      mainWindow?.webContents.send("push-to-talk:keydown");
    }
  });
  uIOhook.on("keyup", (e) => {
    if (watchedKeycode !== null && e.keycode === watchedKeycode) {
      console.log("[push-to-talk] keyup da tecla vigiada");
      mainWindow?.webContents.send("push-to-talk:keyup");
    }
  });
  // Nunca deixa a thread nativa do hook rodando depois do app fechar.
  app.on("will-quit", stopPushToTalkHook);
} else {
  console.warn(
    "[push-to-talk] uiohook-napi não carregou - push-to-talk só funciona com a janela em foco.",
  );
}
// path explícito (relativo a __dirname, não ao cwd) - cwd varia dependendo
// de como o .exe foi lançado (atalho do Menu Iniciar, duplo-clique,
// terminal), então dotenv.config() sem path acha o .env "por sorte" só às
// vezes. Com __dirname funciona igual em dev (electron .) e empacotado.
require("dotenv").config({ path: path.join(__dirname, ".env") });

// O Electron é só uma "casca" nativa em volta do mesmo app web: ele carrega
// a mesma UI React que roda no navegador, servida pelo servidor NaveSpeak
// (Fase 5 do server já serve o client buildado). Isso significa que todo
// mundo do grupo vê sempre a versão mais atual da UI sem precisar reinstalar
// o app Electron.
//
// O client é same-origin (VITE_API_URL vazio no build - ver client/.env.development
// vs. o build de produção, e client/src/api/config.js): fetch/socket.io
// seguem sozinhos a MESMA origem de onde a página foi carregada, então este
// é o ÚNICO lugar que decide qual server o app fala - nunca precisa mexer no
// client pra apontar pra outro host.
//
// Default = o server de produção (navespeak.tech, HTTPS). Quem roda o
// server na PRÓPRIA máquina (dev/teste local) sobrescreve via electron/.env
// (gitignored, não distribuído, não vai dentro do .exe empacotado - só vale
// pra quem builda/roda localmente com esse arquivo presente):
//   NAVESPEAK_SERVER_URL=http://localhost:4100
const SERVER_URL = process.env.NAVESPEAK_SERVER_URL || "https://navespeak.tech";
const SERVER_ORIGIN = new URL(SERVER_URL).origin;

// Atualização automática do SHELL nativo (main.js/preload.js/instalador em
// si) - a UI React já se atualiza sozinha a cada load (comentário acima:
// é servida fresca pelo mesmo server), então isso aqui NUNCA é necessário
// pra mudança de tela/feature comum, só quando o main.js/preload.js muda
// de verdade (permissão nova, IPC novo etc.) e precisa de um binário novo
// rodando na máquina do usuário.
//
// provider "generic" = qualquer pasta servida por HTTP simples - aponta pro
// MESMO server NaveSpeak, rota estática /updates (server/src/index.js),
// então segue o mesmo NAVESPEAK_SERVER_URL de cima automaticamente (troca o
// server, troca de onde busca update junto, sem configurar duas vezes).
// Publicar uma versão nova: `npm run build:electron` (gera o instalador +
// latest.yml em electron/dist/) e copiar os dois pra server/updates/ - ver
// deploy.md.
autoUpdater.setFeedURL({ provider: "generic", url: `${SERVER_URL}/updates` });
autoUpdater.autoDownload = true;

// autoUpdater é um EventEmitter - 'error' sem listener LANÇA e mata o
// processo main. Falha de update (server fora do ar, pasta /updates vazia
// ainda, sem rede) nunca pode derrubar o app por causa disso.
autoUpdater.on("error", (err) => {
  console.error("[autoUpdater]", err?.message || err);
});

// Baixado - pergunta pra reiniciar na hora ou deixa aplicar sozinho no
// próximo fechar do app (comportamento padrão do autoUpdater pro instalador
// NSIS, não precisa de mais nada aqui pra isso acontecer).
autoUpdater.on("update-downloaded", (info) => {
  if (!mainWindow) return;
  dialog
    .showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      title: "Atualização disponível",
      message: `NaveSpeak ${info.version} baixado.`,
      detail:
        "Reinicie para aplicar agora, ou continue usando - ela entra sozinha da próxima vez que o app fechar.",
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
});

// Sem isso, notificação desktop (Notification API, disparada do renderer -
// ver client/src/context/NotificationContext.jsx) aparece no Windows sob o
// nome/ícone genérico do Electron em vez de "NaveSpeak". Precisa ser
// chamado antes de app.whenReady() e ser sempre o MESMO id entre execuções
// (é a chave que o Windows usa pra agrupar notificações do app).
app.setAppUserModelId("com.navespeak.app");

// Referência à janela principal - usada pelo IPC "window:focus" (chamado ao
// clicar numa notificação desktop) para trazer o app de volta ao primeiro
// plano mesmo se estiver minimizado, o que só o processo main consegue
// fazer (window.focus() do lado do renderer não desminimiza uma janela
// nativa).
let mainWindow = null;

// app.setAppUserModelId() acima só marca o AUMID do PROCESSO em execução -
// não é suficiente sozinho. No Windows, notificação toast (Notification API)
// só funciona de verdade se o atalho do Menu Iniciar TAMBÉM tiver essa
// mesma string gravada na property "System.AppUserModel.ID" do próprio
// arquivo .lnk - e o instalador NSIS gerado pelo electron-builder NÃO grava
// isso sozinho (confirmado: os templates dele em
// node_modules/app-builder-lib/templates/nsis não mexem nessa property).
// Sem esse patch, o toast é silenciosamente engolido pelo Windows - sem erro
// nenhum em lugar nenhum, `new Notification()` "funciona" do lado do
// JavaScript e nada aparece.
//
// Faz via PowerShell (COM IPropertyStore - não existe binding Node puro pra
// isso) toda vez que o app abre - idempotente (reescrever o mesmo valor não
// tem efeito colateral) e best-effort (nunca trava o app se falhar: usuário
// sem PowerShell disponível, ou sem o atalho ainda criado num primeiro
// launch fora do instalador). Fixa o problema pra sempre, mesmo depois de
// reinstalar ou outro membro do grupo instalando do zero.
function ensureShortcutAumid() {
  if (process.platform !== "win32") return;

  const shortcutPath = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "NaveSpeak.lnk",
  );

  // PROPERTYKEY de System.AppUserModel.ID é fixo/documentado pela Microsoft
  // (Shell Property reference) - não precisa resolver por nome.
  const script = `
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointerValue; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  int GetCount(out uint c); int GetAt(uint i, out PROPERTYKEY k);
  int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
  int Commit();
}
[ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPersistFile {
  void GetClassID(out Guid c); int IsDirty();
  void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint m);
  void Save([MarshalAs(UnmanagedType.LPWStr)] string f, [MarshalAs(UnmanagedType.Bool)] bool r);
  void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
  void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
}
public static class NaveSpeakAumid {
  public static void Set(string shortcutPath, string aumid) {
    var t = Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046"));
    object link = Activator.CreateInstance(t);
    var pf = (IPersistFile)link;
    pf.Load(shortcutPath, 2);
    var ps = (IPropertyStore)link;
    var pkey = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    var pv = new PROPVARIANT { vt = 31, pointerValue = Marshal.StringToCoTaskMemUni(aumid) };
    ps.SetValue(ref pkey, ref pv);
    ps.Commit();
    pf.Save(shortcutPath, true);
    Marshal.ReleaseComObject(link);
  }
}
'@
    if (Test-Path "${shortcutPath.replace(/\\/g, "\\\\")}") {
      [NaveSpeakAumid]::Set("${shortcutPath.replace(/\\/g, "\\\\")}", "com.navespeak.app")
    }
  `;

  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    (err) => {
      if (err) console.error("[aumid] Não foi possível gravar o AppUserModelID no atalho:", err.message);
    },
  );
}

// WebPreferences padrão de qualquer janela do app (principal ou destacada
// via window.open) - sempre sandboxed, sem Node, com o mesmo preload restrito
// (ver electron/preload.js).

app.commandLine.appendSwitch(
  "unsafely-treat-insecure-origin-as-secure",
  SERVER_ORIGIN,
);

function baseWebPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // Sem isso, o Chromium desacelera o processo renderer inteiro (timers,
    // fila de IPC) assim que a janela é minimizada/ocluída - o áudio em si
    // (mediasoup/WebRTC roda em thread própria) sobrevive, mas o pulso de
    // push-to-talk (ipcRenderer.on, ver preload.js) e o pause/resume do
    // producer de mic (JS puro em MediaSessionContext.jsx) ficam presos até
    // a janela voltar a ficar visível/em foco - exatamente o caso que
    // push-to-talk minimizado precisa funcionar.
    backgroundThrottling: false,
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
  webContents.on("will-navigate", (event, url) => {
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
    if (url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: baseWebPreferences(),
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Se essa janela por sua vez abrir outra (não deveria acontecer hoje, mas
  // não custa blindar), a proteção se propaga.
  webContents.on("did-create-window", (childWindow) => {
    childWindow.setMenuBarVisibility(false);
    guardWindow(childWindow.webContents);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Ícone da janela/taskbar - sem isso cai no ícone padrão do Electron
    // (o "e" genérico). .ico (Windows quer esse formato pra taskbar/alt-tab
    // ficarem nítidos em qualquer tamanho) gerado a partir do mesmo logo
    // usado no favicon web (client/public/favicon.svg) - ver electron/assets/.
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: baseWebPreferences(),
  });

  win.setMenuBarVisibility(false);

  // Nunca conceder permissão de mídia (câmera/microfone), captura de tela ou
  // notificação desktop (ver client/src/context/NotificationContext.jsx)
  // para qualquer origem que não seja exatamente a do nosso servidor
  // configurado - isso é o que evita que uma página inesperada ganhe acesso
  // a câmera/mic/tela/notificação silenciosamente dentro desta janela. Vale
  // também para qualquer janela filha, já que todas compartilham a mesma
  // sessão por padrão.
  win.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      let requestOrigin = null;
      try {
        requestOrigin = details?.requestingUrl
          ? new URL(details.requestingUrl).origin
          : null;
      } catch {
        requestOrigin = null;
      }
      const allowed =
        requestOrigin === SERVER_ORIGIN &&
        (permission === "media" ||
          permission === "display-capture" ||
          permission === "notifications");
      callback(allowed);
    },
  );

  guardWindow(win.webContents);

  win.loadURL(SERVER_URL);
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

app.whenReady().then(() => {
  ensureShortcutAumid();

  // Único ponto de contato com desktopCapturer: devolve apenas id/nome/
  // miniatura de cada janela/tela disponível - nunca o módulo inteiro, e só
  // isso é exposto ao renderer via preload.js.
  ipcMain.handle("screen:get-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 200, height: 120 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });

  // Status "Ausente" automático (ver PresenceContext.jsx): powerMonitor dá a
  // inatividade REAL do sistema operacional (mouse/teclado em qualquer
  // janela, não só a do app) - sem isso o navegador só enxergaria eventos
  // dentro da própria página. getSystemIdleTime() devolve segundos.
  ipcMain.handle("system:idle-time", () => powerMonitor.getSystemIdleTime());

  // Liga/desliga o hook global de push-to-talk (ver bloco acima) - chamado
  // pelo renderer (MediaSessionContext.jsx) com `null`/`undefined` pra
  // desligar. Só existe aqui, dentro de whenReady, junto dos outros handles.
  ipcMain.handle("push-to-talk:set-watched-key", (event, code) => setPushToTalkWatchedKey(code));

  // Chamado ao clicar numa notificação desktop (ver NotificationContext.jsx)
  // - restaura a janela se estiver minimizada e traz pro primeiro plano.
  ipcMain.on("window:focus", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  createWindow();

  // isPackaged: só roda contra update de verdade no .exe instalado - em dev
  // (`npm run dev --workspace electron`) não tem instalador NSIS pra
  // aplicar nada, só gera ruído/erro de rede sem propósito.
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
    // Recheca de hora em hora enquanto o app fica aberto - quem nunca fecha
    // o app não ficaria preso numa versão velha pra sempre.
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
