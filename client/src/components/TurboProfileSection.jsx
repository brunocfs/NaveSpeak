import { useState } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBenefit } from "../context/AuthContext.jsx";
import { useOpenTurbo } from "../hooks/useOpenTurbo.js";
import { fileToDataUrl } from "../utils/fileToDataUrl.js";
import { turboErrorText } from "../utils/turboErrors.js";
import { bannerSrc, removeBanner, updateProfile, uploadBanner } from "../api/profile.js";
import NameStyleEditor, { nameStyleFromServer, nameStyleToPayload } from "./NameStyleEditor.jsx";
import TurboBadge from "./TurboBadge.jsx";

const primaryBtn =
  "cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400";

// Status do TURBO + benefícios configuráveis pelo próprio usuário (hoje só o
// estilo do nome). `profile` = resposta de GET /users/me. O servidor recusa
// o nameStyle sem o benefício ativo - esconder o editor aqui é só UX.
export default function TurboProfileSection({ profile, onSaved }) {
  const [styleForm, setStyleForm] = useState(() => nameStyleFromServer(profile.nameStyle));
  const canStyleName = useBenefit("nameStyle").has;
  const { t } = useTranslation();
  const banner = useBenefit("profileBanner");
  const openTurbo = useOpenTurbo();
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState(null);

  async function changeBanner(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBannerBusy(true);
    setBannerError(null);
    try {
      const data = await uploadBanner(await fileToDataUrl(file));
      onSaved(data.user);
    } catch (err) {
      setBannerError(turboErrorText(t, err));
    } finally {
      setBannerBusy(false);
    }
  }

  async function deleteBanner() {
    setBannerBusy(true);
    setBannerError(null);
    try {
      const data = await removeBanner();
      onSaved(data.user);
    } catch (err) {
      setBannerError(turboErrorText(t, err));
    } finally {
      setBannerBusy(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const data = await updateProfile({ nameStyle: nameStyleToPayload(styleForm) });
      onSaved(data.user);
      setStyleForm(nameStyleFromServer(data.user.nameStyle));
      setSuccess("Estilo do nome salvo.");
    } catch (err) {
      setError(err.message || "Não foi possível salvar o estilo do nome.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
        NaveSpeak TURBO {profile.isTurbo && <TurboBadge className="size-4" />}
      </h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {!profile.isTurbo
          ? "Você não tem o TURBO ativo."
          : profile.turboUntil
            ? `Ativo até ${new Date(profile.turboUntil).toLocaleString("pt-BR")}.`
            : "Ativo, sem data de expiração."}
      </p>

      {(banner.has || banner.locked) && (
        <div className="mb-5 space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t("turbo.banner.title")}</p>
          <div
            className="h-24 rounded-xl bg-slate-200 bg-cover bg-center dark:bg-black"
            style={profile.bannerPath ? { backgroundImage: `url(${bannerSrc(profile.bannerPath, profile.updatedAt)})` } : undefined}
          />
          {banner.locked ? (
            <button type="button" onClick={openTurbo} className="inline-flex cursor-pointer items-center gap-1 text-xs text-fuchsia-500 hover:underline dark:text-fuchsia-300">
              <Lock className="size-3" /> {t("turbo.locked.cta")}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <label className={`${primaryBtn} ${bannerBusy ? "pointer-events-none opacity-60" : ""}`}>
                {t("turbo.banner.upload")}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={changeBanner} disabled={bannerBusy} />
              </label>
              {profile.bannerPath && (
                <button type="button" disabled={bannerBusy} onClick={deleteBanner} className="cursor-pointer rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  {t("turbo.banner.remove")}
                </button>
              )}
            </div>
          )}
          {bannerError && <p className="text-xs text-red-500 dark:text-red-400">{bannerError}</p>}
        </div>
      )}

      {profile.isTurbo && !canStyleName && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          O estilo de nome não está incluído no seu TURBO no momento.
        </p>
      )}

      {canStyleName && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Estilo do nome</p>
          <NameStyleEditor
            value={styleForm}
            onChange={setStyleForm}
            disabled={busy}
            previewName={profile.username}
            idPrefix="turbo-name-style"
          />
          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
          {success && <p className="text-xs text-emerald-600 dark:text-emerald-400">{success}</p>}
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Salvando..." : "Salvar estilo"}
          </button>
        </form>
      )}
    </section>
  );
}
