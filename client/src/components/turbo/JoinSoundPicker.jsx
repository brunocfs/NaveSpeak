import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listJoinSoundOptions } from "../../api/profile.js";
import { soundboardSrc } from "../../api/soundboard.js";
import { turboErrorText } from "../../utils/turboErrors.js";

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500";

// Seletor do som de entrada: sons de todos os servidores do usuário, com busca,
// grupos colapsáveis por servidor e prévia. Mesmo padrão de overlay em portal
// do WelcomeModal.jsx (z acima das Preferências).
export default function JoinSoundPicker({ currentId, onPick, onClose }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const audioRef = useRef(null);

  useEffect(() => {
    listJoinSoundOptions()
      .then((data) => setGroups(Array.isArray(data) ? data : data.options ?? []))
      .catch((err) => setError(turboErrorText(t, err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      audioRef.current?.pause();
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (groups ?? [])
      .map((g) => ({ ...g, sounds: g.sounds.filter((s) => !q || s.name.toLowerCase().includes(q)) }))
      .filter((g) => g.sounds.length > 0);
  }, [groups, query]);

  function preview(sound) {
    audioRef.current?.pause();
    audioRef.current = new Audio(soundboardSrc(sound.filePath));
    audioRef.current.play().catch(() => {});
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label={t("turbo.sounds.pickerTitle")}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t("turbo.sounds.pickerTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="cursor-pointer rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="size-5" />
          </button>
        </div>

        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("turbo.sounds.searchPlaceholder")}
          aria-label={t("turbo.sounds.searchPlaceholder")}
          className={inputClass}
        />

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {!groups && !error && <p className="text-sm text-slate-400">{t("common.loading")}</p>}
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          {groups && filtered.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("turbo.sounds.noResults")}</p>
          )}
          {filtered.map((g) => {
            const open = query.trim() ? true : !collapsed[g.serverId];
            return (
              <div key={g.serverId}>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.serverId]: open }))}
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-center gap-1 rounded-lg px-1 py-1 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <span className="min-w-0 flex-1 truncate">{g.serverName}</span>
                  <span className="font-normal text-slate-400">{g.sounds.length}</span>
                </button>
                {open && (
                  <ul className="space-y-1 pl-2">
                    {g.sounds.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                        <button
                          type="button"
                          onClick={() => preview(s)}
                          aria-label={t("turbo.settings.play")}
                          className="cursor-pointer rounded-lg p-1 text-slate-500 transition hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <Play className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!s.eligible}
                          title={s.eligible ? undefined : t("turbo.sounds.tooLong")}
                          onClick={() => onPick(s)}
                          aria-pressed={s.id === currentId}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            s.eligible ? "cursor-pointer hover:text-purple-600 dark:hover:text-purple-300" : ""
                          } ${s.id === currentId ? "font-semibold text-purple-600 dark:text-purple-300" : "text-slate-700 dark:text-slate-200"}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          {s.personal && (
                            <span className="shrink-0 rounded-full bg-fuchsia-500/15 px-1.5 text-[11px] text-fuchsia-500 dark:text-fuchsia-300">
                              {t("turbo.sounds.personal")}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[11px] text-slate-400">{(s.durationMs / 1000).toFixed(1)}s</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
