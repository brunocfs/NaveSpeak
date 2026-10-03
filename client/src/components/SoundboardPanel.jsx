import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DoorOpen, Lock, Trash2, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deleteSound, listSounds, uploadSound } from "../api/soundboard.js";
import JoinSoundControl from "./turbo/JoinSoundControl.jsx";
import { openPreferences } from "../utils/preferencesEvents.js";
import { setJoinSound } from "../api/profile.js";
import { useAuth, useBenefit } from "../context/AuthContext.jsx";
import { turboErrorText } from "../utils/turboErrors.js";
import { useOpenTurbo } from "../hooks/useOpenTurbo.js";
import { fileToDataUrl } from "../utils/fileToDataUrl.js";
import { useMediaSession } from "../context/MediaSessionContext.jsx";

// Popover de soundboard - aberto pelo botão novo em VoicePanel.jsx, só
// visível dentro de um canal de voz de SERVIDOR (voiceRoomId, ver
// comentário lá - chamada privada nunca tem soundboard). A lista em si é
// visível a qualquer membro (GET .../soundboard não exige USE_SOUNDBOARD,
// ver rooms.routes.js); é o CLIQUE que o servidor pode recusar (sem
// permissão, ensurdecido, rate limit) - por isso todo botão fica clicável e
// o erro, quando vem, aparece inline em vez de esconder sons à toa.
export default function SoundboardPanel({ roomId, onClose, anchorEl }) {
  const { triggerSoundboardSound } = useMediaSession();
  const { t } = useTranslation();
  const openTurbo = useOpenTurbo();
  const { user, refetchTurbo } = useAuth();
  const personal = useBenefit("personalSounds");
  const joinBenefit = useBenefit("joinSound");
  const [meta, setMeta] = useState({ canUsePersonal: false, personalPerUser: 0 });
  const [mineError, setMineError] = useState(null);
  const [sounds, setSounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [playError, setPlayError] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listSounds(roomId)
      .then((data) => {
        if (cancelled) return;
        setSounds(data.sounds);
        setMeta({ canUsePersonal: Boolean(data.canUsePersonal), personalPerUser: data.personalPerUser ?? 0 });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const mine = sounds.filter((x) => x.ownerId === user?.id);
  const shared = sounds.filter((x) => x.ownerId !== user?.id);

  async function addMine(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMineError(null);
    try {
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 48) || "Som";
      await uploadSound(roomId, { name, fileData: await fileToDataUrl(file), personal: true });
      setSounds((await listSounds(roomId)).sounds);
    } catch (err) {
      setMineError(turboErrorText(t, err));
    }
  }

  async function removeMine(id) {
    setMineError(null);
    try {
      await deleteSound(roomId, id);
      setSounds((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      setMineError(turboErrorText(t, err));
    }
  }

  async function setAsJoinSound(sound) {
    setMineError(null);
    try {
      await setJoinSound(sound.id);
      refetchTurbo();
    } catch (err) {
      setMineError(turboErrorText(t, err));
    }
  }

  // Ação "definir como som de entrada" (só com o benefício joinSound).
  const joinAction = (sound) =>
    joinBenefit.has && (
      <button
        type="button"
        onClick={() => setAsJoinSound(sound)}
        title={t("turbo.sounds.setAsJoin")}
        aria-label={t("turbo.sounds.setAsJoin")}
        aria-pressed={user?.joinSound?.soundId === sound.id}
        className={`cursor-pointer rounded-lg p-1 transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
          user?.joinSound?.soundId === sound.id ? "text-purple-600 dark:text-purple-300" : "text-slate-400"
        }`}
      >
        <DoorOpen className="size-4" />
      </button>
    );

  async function handlePlay(sound) {
    setPlayError(null);
    setPlayingId(sound.id);
    try {
      await triggerSoundboardSound(sound.id);
    } catch (err) {
      setPlayError(err.message);
    } finally {
      setPlayingId(null);
    }
  }

  // Com anchorEl (VoiceControlBar), o card abre logo acima do botão, centrado
  // nele e limitado às bordas da tela. Sem anchorEl (VoicePanel), mantém o
  // layout centralizado de sempre.
  let anchorStyle;
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(448, window.innerWidth - 16);
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, 8),
      window.innerWidth - width - 8,
    );
    anchorStyle = {
      position: "fixed",
      left,
      width,
      bottom: window.innerHeight - rect.top + 8,
    };
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-50 ${anchorEl ? "" : "flex items-end justify-center sm:items-center"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Efeitos sonoros"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={anchorStyle}
        className={`max-h-[70vh] overflow-y-auto bg-white p-4 shadow-xl dark:bg-slate-900 ${
          anchorEl
            ? "rounded-2xl border border-slate-200 dark:border-slate-700"
            : "w-full max-w-md rounded-t-2xl sm:rounded-2xl"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Efeitos sonoros
          </h3>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>

        {loading && <p className="text-sm text-slate-400">Carregando...</p>}
        {loadError && (
          <p className="text-sm text-red-500 dark:text-red-400">{loadError}</p>
        )}
        {playError && (
          <p className="mb-2 text-sm text-red-500 dark:text-red-400">
            {playError}
          </p>
        )}

        {!loading && !loadError && shared.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Nenhum efeito sonoro cadastrado. Peça a um administrador do servidor
            pra adicionar em Configurações &gt; Efeitos sonoros.
          </p>
        )}

        {shared.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shared.map((sound) => (
              <div key={sound.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePlay(sound)}
                  disabled={playingId === sound.id}
                  className="cursor-pointer flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Volume2 className="size-4 shrink-0" />
                  <span className="truncate">{sound.name}</span>
                </button>
                {joinAction(sound)}
              </div>
            ))}
          </div>
        )}

        {(meta.canUsePersonal || personal.locked || joinBenefit.has || joinBenefit.locked) && (
          <div className="mt-4 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <button type="button" onClick={() => { onClose(); openPreferences("turbo"); }} className="cursor-pointer text-xs text-fuchsia-500 hover:underline dark:text-fuchsia-300">
              {t("turbo.settings.soundboardLink")}
            </button>
            {(meta.canUsePersonal || personal.locked) && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{t("turbo.sounds.title")}</h4>
                {!meta.canUsePersonal ? (
                  <button type="button" onClick={openTurbo} className="inline-flex cursor-pointer items-center gap-1 text-xs text-fuchsia-500 hover:underline dark:text-fuchsia-300">
                    <Lock className="size-3" /> {t("turbo.locked.cta")}
                  </button>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-2">
                      {mine.map((sound) => (
                        <div key={sound.id} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePlay(sound)}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Volume2 className="size-4 shrink-0" />
                            <span className="truncate">{sound.name}</span>
                          </button>
                          {joinAction(sound)}
                          <button type="button" onClick={() => removeMine(sound.id)} aria-label={t("turbo.sounds.remove")} className="cursor-pointer rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {mine.length < meta.personalPerUser && (
                      <label className="mt-2 inline-flex cursor-pointer rounded-xl bg-purple-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-400">
                        {t("turbo.sounds.add")}
                        <input type="file" accept="audio/*" hidden onChange={addMine} />
                      </label>
                    )}
                  </>
                )}
              </div>
            )}

            {(joinBenefit.has || joinBenefit.locked) && (
              <div>
                <h4 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">{t("turbo.sounds.joinTitle")}</h4>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t("turbo.sounds.joinHint")}</p>
                {joinBenefit.locked ? (
                  <button type="button" onClick={openTurbo} className="inline-flex cursor-pointer items-center gap-1 text-xs text-fuchsia-500 hover:underline dark:text-fuchsia-300">
                    <Lock className="size-3" /> {t("turbo.locked.cta")}
                  </button>
                ) : (
                  <JoinSoundControl />
                )}
              </div>
            )}
            {mineError && <p className="text-xs text-red-500 dark:text-red-400">{mineError}</p>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
