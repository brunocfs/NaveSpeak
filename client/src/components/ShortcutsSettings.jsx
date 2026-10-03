import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../api/http.js";
import { usePreferences } from "../context/PreferencesContext.jsx";
import { useKeyCapture } from "../hooks/useKeyCapture.js";
import { SHORTCUT_ACTIONS } from "../utils/shortcuts.js";
import { formatKeyLabel } from "../utils/pushToTalkKeys.js";

const card =
  "rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60";
const smallBtn =
  "cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700";
const select =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white";

// Servidor + canal de voz do atalho "Entrar no canal predefinido".
function ChannelPicker() {
  const { t } = useTranslation();
  const { shortcutChannel, setShortcutChannel } = usePreferences();
  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const roomId = shortcutChannel?.roomId ?? "";

  useEffect(() => {
    apiRequest("/rooms")
      .then((data) => setRooms(data.rooms ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!roomId) return setChannels([]);
    let cancelled = false;
    apiRequest(`/rooms/${roomId}`)
      .then((data) => {
        if (!cancelled) setChannels((data.channels ?? []).filter((c) => c.type === "voice"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  function pickRoom(id) {
    const room = rooms.find((r) => r.id === id);
    // Trocar de servidor invalida o canal - fica "sem canal" até escolher um.
    setShortcutChannel(room ? { roomId: room.id, roomName: room.name, channelId: null } : null);
  }
  function pickChannel(id) {
    const channel = channels.find((c) => c.id === id);
    const room = rooms.find((r) => r.id === roomId);
    setShortcutChannel(
      channel
        ? { roomId, roomName: room?.name, channelId: channel.id, channelName: channel.name }
        : { roomId, roomName: room?.name, channelId: null },
    );
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      <select
        aria-label={t("preferences.shortcuts.server")}
        value={roomId}
        onChange={(e) => pickRoom(e.target.value)}
        className={select}
      >
        <option value="">{t("preferences.shortcuts.server")}</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t("preferences.shortcuts.channel")}
        value={shortcutChannel?.channelId ?? ""}
        disabled={!roomId}
        onChange={(e) => pickChannel(e.target.value)}
        className={`${select} disabled:opacity-60`}
      >
        <option value="">{t("preferences.shortcuts.channel")}</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// Aba "Atalhos" das Preferências. Aplica na hora (sem rascunho/Salvar), como
// TurboSettings - quem escuta e executa é GlobalShortcuts.jsx.
export default function ShortcutsSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [capturing, setCapturing] = useState(null);
  const [error, setError] = useState(null);

  useKeyCapture(capturing !== null, (combo) => {
    const id = capturing;
    setCapturing(null);
    if (!combo) return;
    // Mesma combinação em duas ações dispararia as duas - recusa e avisa.
    const clashId =
      Object.keys(prefs.shortcuts).find((k) => k !== id && prefs.shortcuts[k] === combo) ??
      (prefs.pushToTalkKey === combo ? "pushToTalk" : null);
    if (clashId) {
      const name =
        clashId === "pushToTalk"
          ? t("preferences.pushToTalk.label")
          : t(`preferences.shortcuts.actions.${clashId}.label`);
      return setError(t("preferences.shortcuts.conflict", { combo: formatKeyLabel(combo), name }));
    }
    setError(null);
    prefs.setShortcut(id, combo);
  });

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {t("preferences.shortcuts.title")}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {t("preferences.shortcuts.help")}
          {window.naveSpeak?.shortcuts && ` ${t("preferences.shortcuts.globalHint")}`}
        </p>
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      {SHORTCUT_ACTIONS.map(({ id, icon: Icon }) => {
        const combo = prefs.shortcuts[id];
        const isCapturing = capturing === id;
        return (
          <section key={id} className={card}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="size-4 shrink-0 text-slate-500 dark:text-slate-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t(`preferences.shortcuts.actions.${id}.label`)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t(`preferences.shortcuts.actions.${id}.desc`)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    combo || isCapturing
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
                      : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                  }`}
                >
                  {isCapturing
                    ? t("preferences.pushToTalk.pressKey")
                    : (formatKeyLabel(combo) ?? t("preferences.shortcuts.none"))}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setCapturing(isCapturing ? null : id);
                  }}
                  className={smallBtn}
                >
                  {isCapturing
                    ? t("preferences.pushToTalk.escToCancel")
                    : t("preferences.pushToTalk.assignKey")}
                </button>
                {combo && !isCapturing && (
                  <button
                    type="button"
                    onClick={() => prefs.setShortcut(id, null)}
                    aria-label={t("preferences.shortcuts.clear")}
                    className={smallBtn}
                  >
                    {t("preferences.shortcuts.clear")}
                  </button>
                )}
              </div>
            </div>
            {id === "joinChannel" && <ChannelPicker />}
          </section>
        );
      })}
    </div>
  );
}
