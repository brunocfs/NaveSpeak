import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { removeJoinSound, setJoinSound } from "../../api/profile.js";
import { soundboardSrc } from "../../api/soundboard.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { turboErrorText } from "../../utils/turboErrors.js";
import JoinSoundPicker from "./JoinSoundPicker.jsx";

const btn =
  "cursor-pointer rounded-xl px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

// Som de entrada = um som JÁ existente num dos servidores do usuário
// (user.joinSound, mantido pelo AuthContext). Usado no SoundboardPanel e na
// aba TURBO das Preferências.
export default function JoinSoundControl() {
  const { t } = useTranslation();
  const { user, refetchTurbo } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const audioRef = useRef(null);
  const joinSound = user?.joinSound;

  async function run(fn) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      refetchTurbo();
    } catch (err) {
      setError(turboErrorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  function preview() {
    audioRef.current?.pause();
    audioRef.current = new Audio(soundboardSrc(joinSound.path));
    audioRef.current.play().catch(() => {});
  }

  return (
    <div>
      {joinSound && (
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">
          {t("turbo.sounds.currentFrom", {
            name: joinSound.name,
            server: joinSound.serverName,
            seconds: (joinSound.durationMs / 1000).toFixed(1),
          })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {joinSound && (
          <button type="button" onClick={preview} className={`${btn} inline-flex items-center gap-1 bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600`}>
            <Play className="size-3" /> {t("turbo.settings.play")}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setPicking(true)} className={`${btn} bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400`}>
          {joinSound ? t("turbo.sounds.change") : t("turbo.sounds.choose")}
        </button>
        {joinSound && (
          <button type="button" disabled={busy} onClick={() => run(removeJoinSound)} className={`${btn} text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`}>
            {t("turbo.sounds.remove")}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
      {picking && (
        <JoinSoundPicker
          currentId={joinSound?.soundId}
          onClose={() => setPicking(false)}
          onPick={(sound) => {
            setPicking(false);
            run(() => setJoinSound(sound.id));
          }}
        />
      )}
    </div>
  );
}
