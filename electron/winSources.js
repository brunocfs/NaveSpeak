// Complementa desktopCapturer.getSources no Windows, que deixa de fora:
// - monitores de outro adaptador de vídeo: em notebook híbrido (Intel +
//   NVIDIA) o capturador DXGI do Chromium só lista as saídas de UM adaptador
//   (ex.: 1 de 3 monitores). Todos capturam normalmente se o id for concedido
//   direto no setDisplayMediaRequestHandler - só a LISTA falha. O id de tela
//   do WebRTC é o índice do EnumDisplayDevices, então dá pra montar a lista
//   completa aqui;
// - janelas minimizadas: o Chromium não lista e nem consegue capturar (falha
//   com NotReadableError). Aqui elas entram na lista e `restoreIfMinimized`
//   restaura a janela antes da captura.
// Fora do Windows (ou sem koffi) tudo vira no-op e fica só o desktopCapturer.
let api = null;
function load() {
  if (process.platform !== "win32") return null;
  if (api) return api;
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const dwmapi = koffi.load("dwmapi.dll");

    const DISPLAY_DEVICEW = koffi.struct("NS_DISPLAY_DEVICEW", {
      cb: "uint32",
      DeviceName: koffi.array("char16", 32, "String"),
      DeviceString: koffi.array("char16", 128, "String"),
      StateFlags: "uint32",
      DeviceID: koffi.array("char16", 128, "String"),
      DeviceKey: koffi.array("char16", 128, "String"),
    });
    // DEVMODEW com o ramo "display" da union (dmPosition...) - 220 bytes.
    const DEVMODEW = koffi.struct("NS_DEVMODEW", {
      dmDeviceName: koffi.array("char16", 32),
      dmSpecVersion: "uint16",
      dmDriverVersion: "uint16",
      dmSize: "uint16",
      dmDriverExtra: "uint16",
      dmFields: "uint32",
      dmPositionX: "int32",
      dmPositionY: "int32",
      dmDisplayOrientation: "uint32",
      dmDisplayFixedOutput: "uint32",
      dmColor: "int16",
      dmDuplex: "int16",
      dmYResolution: "int16",
      dmTTOption: "int16",
      dmCollate: "int16",
      dmFormName: koffi.array("char16", 32),
      dmLogPixels: "uint16",
      dmBitsPerPel: "uint32",
      dmPelsWidth: "uint32",
      dmPelsHeight: "uint32",
      dmDisplayFlags: "uint32",
      dmDisplayFrequency: "uint32",
      dmTail: koffi.array("uint32", 8),
    });
    const EnumWindowsProc = koffi.proto("bool __stdcall NS_EnumWindowsProc(intptr_t hwnd, intptr_t lParam)");

    api = {
      DISPLAY_DEVICEW,
      DEVMODEW,
      EnumWindowsProc,
      koffi,
      EnumDisplayDevicesW: user32.func(
        "bool __stdcall EnumDisplayDevicesW(const char16_t *dev, uint32 i, _Inout_ NS_DISPLAY_DEVICEW *dd, uint32 flags)",
      ),
      EnumDisplaySettingsW: user32.func(
        "bool __stdcall EnumDisplaySettingsW(const char16_t *dev, uint32 mode, _Inout_ NS_DEVMODEW *dm)",
      ),
      EnumWindows: user32.func("bool __stdcall EnumWindows(NS_EnumWindowsProc *cb, intptr_t lParam)"),
      IsWindowVisible: user32.func("bool __stdcall IsWindowVisible(intptr_t hwnd)"),
      IsIconic: user32.func("bool __stdcall IsIconic(intptr_t hwnd)"),
      GetWindow: user32.func("intptr_t __stdcall GetWindow(intptr_t hwnd, uint32 cmd)"),
      GetWindowLongW: user32.func("int32 __stdcall GetWindowLongW(intptr_t hwnd, int nIndex)"),
      GetWindowTextW: user32.func("int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ char16_t *buf, int max)"),
      // Async: ShowWindow numa janela de outro processo espera a thread dela
      // responder - com o app travado, congelava o processo main inteiro.
      ShowWindowAsync: user32.func("bool __stdcall ShowWindowAsync(intptr_t hwnd, int cmd)"),
      IsHungAppWindow: user32.func("bool __stdcall IsHungAppWindow(intptr_t hwnd)"),
      DwmGetWindowAttribute: dwmapi.func(
        "int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ uint32_t *value, uint32 size)",
      ),
    };
    return api;
  } catch (err) {
    console.error("[winSources] koffi indisponível:", err);
    return null;
  }
}

const DISPLAY_DEVICE_ACTIVE = 0x1;
const DISPLAY_DEVICE_PRIMARY = 0x4;
const ENUM_CURRENT_SETTINGS = 0xffffffff;

// Todos os monitores ativos, no mesmo formato de id do desktopCapturer
// ("screen:<índice EnumDisplayDevices>:0").
function listScreens() {
  const a = load();
  if (!a) return [];
  const screens = [];
  for (let i = 0; i < 32; i++) {
    const dd = { cb: a.koffi.sizeof(a.DISPLAY_DEVICEW) };
    if (!a.EnumDisplayDevicesW(null, i, dd, 0)) break;
    if (!(dd.StateFlags & DISPLAY_DEVICE_ACTIVE)) continue;
    const dm = { dmSize: a.koffi.sizeof(a.DEVMODEW) };
    const hasMode = a.EnumDisplaySettingsW(dd.DeviceName, ENUM_CURRENT_SETTINGS, dm);
    screens.push({
      id: `screen:${i}:0`,
      primary: Boolean(dd.StateFlags & DISPLAY_DEVICE_PRIMARY),
      resolution: hasMode ? `${dm.dmPelsWidth}×${dm.dmPelsHeight}` : null,
      x: hasMode ? dm.dmPositionX : 0,
    });
  }
  // Numera da esquerda pra direita, como o usuário enxerga a mesa.
  screens.sort((s1, s2) => s1.x - s2.x);
  return screens.map((s, n) => ({
    id: s.id,
    name: [`Tela ${n + 1}`, s.resolution, s.primary ? "principal" : null].filter(Boolean).join(" · "),
  }));
}

const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;

function windowTitle(a, hwnd) {
  const buf = Buffer.alloc(512);
  const len = a.GetWindowTextW(hwnd, buf, 256);
  return buf.toString("utf16le", 0, len * 2);
}

// Janelas minimizadas "de verdade" (mesmo filtro que o WebRTC usa pras
// visíveis: com título, sem dono, fora de tool window, fora de outra área
// de trabalho virtual e respondendo - app travado não restaura nem captura).
function listMinimizedWindows() {
  const a = load();
  if (!a) return [];
  const found = [];
  const cb = a.koffi.register((hwnd) => {
    if (!a.IsWindowVisible(hwnd) || !a.IsIconic(hwnd)) return true;
    if (a.GetWindow(hwnd, GW_OWNER) || a.IsHungAppWindow(hwnd)) return true;
    if (a.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) return true;
    const cloaked = [0];
    if (a.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return true;
    const name = windowTitle(a, hwnd);
    if (name) found.push({ id: `window:${hwnd}:0`, name });
    return true;
  }, a.koffi.pointer(a.EnumWindowsProc));
  try {
    a.EnumWindows(cb, 0);
  } finally {
    a.koffi.unregister(cb);
  }
  return found;
}

const SW_RESTORE = 9;

// Janela minimizada não gera frame nenhum (captura falha) - restaura antes.
function restoreIfMinimized(sourceId) {
  const a = load();
  if (!a || !sourceId.startsWith("window:")) return;
  const hwnd = Number(sourceId.split(":")[1]);
  if (hwnd && a.IsIconic(hwnd)) a.ShowWindowAsync(hwnd, SW_RESTORE);
}

module.exports = { listScreens, listMinimizedWindows, restoreIfMinimized };
