import {
  Camera,
  Headphones,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneOff,
  ScreenShare,
  Volume2,
  Radio,
  PhoneMissed,
} from "lucide-react";

// Ações que aceitam atalho (aba Atalhos das Preferências). `id` é a chave em
// preferences.shortcuts; `needsCall` = só faz algo conectado à voz.
// Executadas por GlobalShortcuts.jsx.
export const SHORTCUT_ACTIONS = [
  { id: "toggleMute", icon: Mic, needsCall: true },
  { id: "toggleDeafen", icon: Headphones, needsCall: true },
  { id: "toggleCamera", icon: Camera, needsCall: true },
  { id: "toggleScreenShare", icon: ScreenShare, needsCall: true },
  { id: "openSoundboard", icon: Volume2, needsCall: true },
  { id: "togglePushToTalk", icon: Radio },
  { id: "joinChannel", icon: Phone },
  { id: "leaveVoice", icon: PhoneOff, needsCall: true },
  { id: "acceptCall", icon: PhoneIncoming },
  { id: "declineCall", icon: PhoneMissed },
];

// Sem Ctrl/Alt/Meta o atalho coincide com digitar - nesse caso é ignorado
// quando o foco está num campo de texto (ver GlobalShortcuts.jsx).
export const comboIsTyping = (combo) => !/(Control|Alt|Meta)/.test(combo);

// Foco num campo de texto - atalhos sem modificador não devem disparar aí
// (também usado pelo push-to-talk, ver MediaSessionContext.jsx).
export function isEditableTarget(target) {
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}
