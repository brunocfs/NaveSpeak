import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaSession } from "../context/MediaSessionContext.jsx";
import { useCall } from "../context/CallContext.jsx";
import { usePreferences } from "../context/PreferencesContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { isElectron, listScreenSources } from "../api/media.js";
import { isCapturingKey } from "../hooks/useKeyCapture.js";
import { comboIsTyping, isEditableTarget } from "../utils/shortcuts.js";
import ScreenSourcePicker from "./ScreenSourcePicker.jsx";
import SoundboardPanel from "./SoundboardPanel.jsx";

// Executa os atalhos da aba Atalhos (Preferências). Montado uma vez em
// App.jsx, dentro de MediaSessionProvider/CallProvider, pelo mesmo motivo do
// VoicePanel: tem que valer em qualquer tela. Não renderiza nada além do
// seletor de tela e do painel de efeitos sonoros que as ações abrem.
//
// No Electron, o hook global (electron/main.js) cobre janela em foco E sem
// foco; os ids que ele não consegue vigiar (tecla sem tradução) e o
// navegador comum caem no listener de teclado da própria janela. Os dois
// nunca vigiam o mesmo id - toggles disparariam duas vezes.
export default function GlobalShortcuts() {
  const media = useMediaSession();
  const call = useCall();
  const prefs = usePreferences();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [pickerSources, setPickerSources] = useState(null);

  async function openScreenPicker() {
    // Fora do Electron o seletor de janela é o nativo do getDisplayMedia -
    // o picker abre só pra escolher qualidade (mesmo caminho de RoomPage).
    if (!isElectron()) return setPickerSources([]);
    setPickerSources("loading");
    try {
      const sources = await listScreenSources();
      setPickerSources((cur) => (cur === "loading" ? (sources ?? []) : cur));
    } catch (err) {
      setPickerSources(null);
      showToast(err.message ?? t("preferences.shortcuts.toast.screenError"), {
        type: "error",
      });
    }
  }

  // Sempre a versão mais atual das ações, sem recriar os listeners a cada
  // render (o estado de mídia muda o tempo todo).
  const runRef = useRef(null);
  runRef.current = (id) => {
    const inVoice = media.connected;
    switch (id) {
      case "toggleMute":
        if (inVoice) media.toggleMute();
        break;
      case "toggleDeafen":
        if (inVoice) media.toggleDeafen();
        break;
      case "toggleCamera":
        if (!inVoice) break;
        if (media.cameraOn) media.stopCamera();
        else media.shareCamera();
        break;
      case "toggleScreenShare":
        if (!inVoice) break;
        if (media.sharingScreen) media.stopScreenShare();
        else openScreenPicker();
        break;
      case "openSoundboard":
        if (inVoice && media.voiceRoomId) setSoundboardOpen((open) => !open);
        break;
      case "togglePushToTalk":
        prefs.setPushToTalkEnabled(!prefs.pushToTalkEnabled);
        showToast(
          t(
            `preferences.shortcuts.toast.${prefs.pushToTalkEnabled ? "pttOff" : "pttOn"}`,
          ),
          { type: "info" },
        );
        break;
      case "joinChannel": {
        const ch = prefs.shortcutChannel;
        if (!ch?.channelId) {
          showToast(t("preferences.shortcuts.toast.noChannel"), {
            type: "info",
          });
        } else if (media.voiceChannelId !== ch.channelId) {
          media.joinVoice(ch.channelId, {
            roomId: ch.roomId,
            roomName: ch.roomName,
            channelName: ch.channelName,
          });
        }
        break;
      }
      case "leaveVoice":
        if (inVoice) media.leaveVoice();
        break;
      case "acceptCall":
        if (call.incomingCalls[0]) call.acceptCall(call.incomingCalls[0]);
        break;
      case "declineCall":
        if (call.incomingCalls[0]) call.declineCall(call.incomingCalls[0]);
        break;
    }
  };

  // Recria os listeners só quando os atalhos mudam (JSON como dep estável).
  const shortcutsKey = JSON.stringify(prefs.shortcuts);
  useEffect(() => {
    const combos = JSON.parse(shortcutsKey);
    const entries = Object.entries(combos);
    if (!entries.length) return;
    const bridge = window.naveSpeak?.shortcuts;
    // ids tratados pelo listener da janela; começa com todos e perde os que o
    // hook global confirmar.
    const domIds = new Set(Object.keys(combos));
    const held = new Set();
    const fired = new Set();

    function trigger(id) {
      if (isCapturingKey()) return;
      // Sem foco de janela o campo de texto não está "sendo digitado".
      if (
        comboIsTyping(combos[id]) &&
        document.hasFocus() &&
        isEditableTarget(document.activeElement)
      )
        return;
      runRef.current(id);
    }
    function handleKeyDown(e) {
      held.add(e.code);
      if (e.repeat) return;
      for (const id of domIds) {
        if (fired.has(id)) continue;
        if (!combos[id].split("+").every((c) => held.has(c))) continue;
        fired.add(id);
        trigger(id);
      }
    }
    function handleKeyUp(e) {
      held.delete(e.code);
      for (const id of fired)
        if (combos[id].split("+").includes(e.code)) fired.delete(id);
    }
    function reset() {
      held.clear();
      fired.clear();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", reset);

    let unsubscribe;
    if (bridge) {
      unsubscribe = bridge.onTriggered(trigger);
      bridge
        .setWatched(entries.map(([id, combo]) => ({ id, combo })))
        .then((supported) => supported.forEach((id) => domIds.delete(id)))
        .catch((err) =>
          console.error("[shortcuts] Falha ao armar o hook global:", err),
        );
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", reset);
      unsubscribe?.();
      bridge?.setWatched([]);
    };
  }, [shortcutsKey]);

  // Painel de efeitos sonoros só existe dentro de um canal de servidor.
  useEffect(() => {
    if (!media.voiceRoomId) setSoundboardOpen(false);
  }, [media.voiceRoomId]);

  return (
    <>
      {soundboardOpen && media.voiceRoomId && (
        <SoundboardPanel
          roomId={media.voiceRoomId}
          onClose={() => setSoundboardOpen(false)}
        />
      )}
      {pickerSources && (
        <ScreenSourcePicker
          sources={pickerSources}
          title={t("preferences.shortcuts.pickerTitle")}
          defaultWithAudio={false}
          onSelect={(sourceId, withAudio, quality) => {
            setPickerSources(null);
            media.shareScreen(sourceId, { withAudio, quality });
          }}
          onCancel={() => setPickerSources(null)}
        />
      )}
    </>
  );
}
