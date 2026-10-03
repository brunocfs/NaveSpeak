import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAppSettings, updateAppSettings } from "../api/soundboard.js";
import { TURBO_BENEFITS } from "../utils/turboBenefits.js";
import TurboBadge from "./TurboBadge.jsx";

const MODES = ["turbo", "free", "off"];

// Catálogo GLOBAL: por benefício, turbo (só TURBO) / free (todos) / off
// (ninguém); hdScreen ganha turboBitrate. Override por usuário: aba Usuários.
export default function AdminTurboPanel() {
  const { t } = useTranslation();
  const [benefits, setBenefits] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAppSettings()
      .then((data) => setBenefits(data.settings.turboBenefits ?? {}))
      .catch((err) => setError(err.message || t("turbo.admin.loadError")));
  }, []);

  async function setMode(key, value) {
    const next = { ...benefits, [key]: value };
    setBusy(true);
    setError(null);
    try {
      const data = await updateAppSettings({ turboBenefits: next });
      setBenefits(data.settings.turboBenefits);
    } catch (err) {
      setError(err.message || t("turbo.admin.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          {t("turbo.admin.title")} <TurboBadge className="size-4" />
        </h2>
      </div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {t("turbo.admin.help")}
      </p>

      {error && <p className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

      {benefits && (
        <ul className="space-y-2">
          {TURBO_BENEFITS.map((b) => (
            <li
              key={b.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t(`turbo.benefits.${b.key}.title`)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t(`turbo.benefits.${b.key}.desc`)}</p>
                {b.key === "hdScreen" && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    A: {t("turbo.benefits.hdScreen.modeA")} · B: {t("turbo.benefits.hdScreen.modeB")}
                  </p>
                )}
                {b.key === "ghostVoice" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t("turbo.admin.ghostVoiceNote")}</p>
                )}
              </div>
              <select
                aria-label={t(`turbo.benefits.${b.key}.title`)}
                value={benefits[b.key] ?? "turbo"}
                disabled={busy}
                onChange={(e) => setMode(b.key, e.target.value)}
                className="cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white"
              >
                {(b.key === "hdScreen" ? ["turbo", "turboBitrate", "free", "off"] : MODES).map((m) => (
                  <option key={m} value={m}>{t(`turbo.admin.mode.${m}`)}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
