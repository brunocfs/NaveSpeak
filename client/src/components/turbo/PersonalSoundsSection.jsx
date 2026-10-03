import { useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../../api/http.js";
import { deleteSound, listSounds, soundboardSrc, uploadSound } from "../../api/soundboard.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fileToDataUrl } from "../../utils/fileToDataUrl.js";
import { turboErrorText } from "../../utils/turboErrors.js";

// Sons pessoais agrupados por servidor. ponytail: um GET por servidor ao abrir
// a aba; se alguém tiver dezenas de servidores, listar só o atual.
export default function PersonalSoundsSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);

  async function loadGroup(room) {
    const data = await listSounds(room.id);
    return {
      room,
      mine: data.sounds.filter((s) => s.ownerId === user?.id),
      canUse: Boolean(data.canUsePersonal),
      max: data.personalPerUser ?? 0,
    };
  }

  useEffect(() => {
    let cancelled = false;
    apiRequest("/rooms")
      .then((data) => Promise.all(data.rooms.map((r) => loadGroup(r).catch(() => null))))
      .then((list) => !cancelled && setGroups(list.filter((g) => g?.canUse)))
      .catch((err) => !cancelled && setError(turboErrorText(t, err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function refresh(room) {
    const next = await loadGroup(room);
    setGroups((prev) => prev.map((g) => (g.room.id === room.id ? next : g)));
  }

  async function add(room, e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 48) || "Som";
      await uploadSound(room.id, { name, fileData: await fileToDataUrl(file), personal: true });
      await refresh(room);
    } catch (err) {
      setError(turboErrorText(t, err));
    }
  }

  async function remove(room, id) {
    setError(null);
    try {
      await deleteSound(room.id, id);
      await refresh(room);
    } catch (err) {
      setError(turboErrorText(t, err));
    }
  }

  if (!groups) return error ? <p className="text-xs text-red-500 dark:text-red-400">{error}</p> : null;
  if (groups.length === 0) return <p className="text-xs text-slate-500 dark:text-slate-400">{t("turbo.settings.personalEmpty")}</p>;

  return (
    <div className="space-y-3">
      {groups.map(({ room, mine, max }) => (
        <div key={room.id}>
          <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {room.name} <span className="font-normal text-slate-400">({mine.length}/{max})</span>
          </p>
          <ul className="space-y-1">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <button
                  type="button"
                  aria-label={t("turbo.settings.play")}
                  onClick={() => new Audio(soundboardSrc(s.filePath)).play().catch(() => {})}
                  className="cursor-pointer rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Play className="size-3.5" />
                </button>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <button
                  type="button"
                  aria-label={t("turbo.sounds.remove")}
                  onClick={() => remove(room, s.id)}
                  className="cursor-pointer rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          {mine.length < max && (
            <label className="mt-1 inline-flex cursor-pointer rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400">
              {t("turbo.sounds.add")}
              <input type="file" accept="audio/*" hidden onChange={(e) => add(room, e)} />
            </label>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
