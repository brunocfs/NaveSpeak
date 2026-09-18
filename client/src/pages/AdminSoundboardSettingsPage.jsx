import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAppSettings, updateAppSettings } from "../api/soundboard.js";
import DownloadAppLink from "../components/DownloadAppLink.jsx";
import AdminBackgroundsSection from "../components/AdminBackgroundsSection.jsx";

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";

// Painel admin de configuração GLOBAL da plataforma (hoje só os limites do
// soundboard: quantos sons cabem por servidor e a duração máxima aceita) -
// distinto das configurações de UM servidor (ServerSettingsModal.jsx). Só
// visível/acessível pra quem tem users.is_admin (ver App.jsx/RoomsPage.jsx),
// mesmo padrão de AdminInvitesPage/AdminBroadcastsPage.
export default function AdminSoundboardSettingsPage() {
  const [maxSounds, setMaxSounds] = useState("");
  const [maxDurationSeconds, setMaxDurationSeconds] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);

  useEffect(() => {
    getAppSettings()
      .then(({ settings }) => {
        setMaxSounds(String(settings.soundboardMaxSounds));
        setMaxDurationSeconds(String(settings.soundboardMaxDurationMs / 1000));
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaveError(null);
    setSaveNotice(null);
    setSaving(true);
    try {
      const { settings } = await updateAppSettings({
        soundboardMaxSounds: Number(maxSounds),
        soundboardMaxDurationMs: Math.round(Number(maxDurationSeconds) * 1000),
      });
      setMaxSounds(String(settings.soundboardMaxSounds));
      setMaxDurationSeconds(String(settings.soundboardMaxDurationMs / 1000));
      setSaveNotice("Salvo.");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              &larr;
            </Link>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Soundboard e fundos de câmera</h1>
          </div>
          <DownloadAppLink />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Limites globais</h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Valem para TODOS os servidores da plataforma. Baixar o limite de sons não apaga os já
            cadastrados acima dele - só bloqueia novos uploads até o servidor ficar abaixo do novo
            limite.
          </p>

          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
          ) : loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Máximo de sons por servidor
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  className={inputClass}
                  value={maxSounds}
                  onChange={(e) => setMaxSounds(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Duração máxima por som (segundos)
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={0.5}
                  className={inputClass}
                  value={maxDurationSeconds}
                  onChange={(e) => setMaxDurationSeconds(e.target.value)}
                />
              </div>

              {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
              {saveNotice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveNotice}</p>}

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </form>
          )}
        </section>

        <AdminBackgroundsSection />
      </main>
    </div>
  );
}
