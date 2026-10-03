import { useState } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { updateProfile } from "../api/profile.js";
import { useAuth, useBenefit } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useOpenTurbo } from "../hooks/useOpenTurbo.js";
import { Toggle } from "./Toggle.jsx";

// Preferência "voz fantasma" - usada nas abas Privacidade e TURBO. Salva direto
// no servidor ao alternar; sem o benefício fica desabilitada com cadeado/CTA.
export default function GhostVoiceToggle() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { user, updateUser } = useAuth();
  const ghost = useBenefit("ghostVoice");
  const openTurbo = useOpenTurbo();
  const [busy, setBusy] = useState(false);

  async function handleChange(value) {
    setBusy(true);
    try {
      const data = await updateProfile({ ghostVoice: value });
      updateUser({ ghostVoice: data.user.ghostVoice });
    } catch (err) {
      showToast(err.message || "Não foi possível salvar.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
      <Toggle
        checked={Boolean(user?.ghostVoice) && ghost.has}
        disabled={busy || !ghost.has}
        label={t("privacy.ghostVoice.label")}
        onChange={handleChange}
      />
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("privacy.ghostVoice.hint")}</p>
      {ghost.locked && (
        <button
          type="button"
          onClick={openTurbo}
          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs text-fuchsia-500 hover:underline dark:text-fuchsia-300"
        >
          <Lock className="size-3" /> {t("turbo.locked.cta")}
        </button>
      )}
    </div>
  );
}
