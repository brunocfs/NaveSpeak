// Rótulos amigáveis para `KeyboardEvent.code` (não `.key` - ver comentário em
// PreferencesContext.jsx sobre por que push-to-talk guarda `.code`). Só os
// códigos mais comuns como tecla de PTT ganham nome tratado; qualquer outro
// cai no fallback (devolve o próprio `code`), que já é razoavelmente legível
// (ex.: "F13", "NumpadAdd").
const KEY_LABELS = {
  Space: "Espaço",
  ControlLeft: "Ctrl (esq.)",
  ControlRight: "Ctrl (dir.)",
  ShiftLeft: "Shift (esq.)",
  ShiftRight: "Shift (dir.)",
  AltLeft: "Alt (esq.)",
  AltRight: "Alt (dir.)",
  MetaLeft: "Win (esq.)",
  MetaRight: "Win (dir.)",
  CapsLock: "Caps Lock",
  Tab: "Tab",
  Backquote: "`",
  Backslash: "\\",
};

export function formatKeyLabel(code) {
  if (!code) return null;
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  // "KeyV" -> "V", "Digit5" -> "5" - cobre a grande maioria das teclas que
  // fazem sentido pra push-to-talk sem precisar de uma entrada por tecla.
  const letterOrDigit = code.match(/^(?:Key|Digit)(.)$/);
  if (letterOrDigit) return letterOrDigit[1];
  return code;
}
