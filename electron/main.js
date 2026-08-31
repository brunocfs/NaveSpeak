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
} = require("electron");
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
// Default = o server do grupo na VPN (mesmo IP hoje usado por todo mundo).
// Quem roda o server na PRÓPRIA máquina (dev/teste local) sobrescreve via
// electron/.env (gitignored, não distribuído):
//   NAVESPEAK_SERVER_URL=http://localhost:4100
const SERVER_URL = process.env.NAVESPEAK_SERVER_URL || "http://26.67.223.20:4100";
const SERVER_ORIGIN = new URL(SERVER_URL).origin;

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

  // Chamado ao clicar numa notificação desktop (ver NotificationContext.jsx)
  // - restaura a janela se estiver minimizada e traz pro primeiro plano.
  ipcMain.on("window:focus", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
