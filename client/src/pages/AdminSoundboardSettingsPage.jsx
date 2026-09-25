import { useEffect, useState } from "react";
import { getAppSettings, updateAppSettings } from "../api/soundboard.js";
import AdminBackgroundsSection from "../components/AdminBackgroundsSection.jsx";

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500";

// Painel admin de configuração GLOBAL da plataforma (hoje só os limites do
// soundboard: quantos sons cabem por servidor e a duração máxima aceita) -
// distinto das configurações de UM servidor (ServerSettingsModal.jsx). Só
// visível/acessível pra quem tem users.is_admin - aba do painel admin
// (AdminPanel.jsx).
export function SoundboardSettingsPanel() {
  const [maxSounds, setMaxSounds] = useState("");
  const [maxDurationSeconds, setMaxDurationSeconds] = useState("");
  const [maxSizeMb, setMaxSizeMb] = useState("");
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
        setMaxSizeMb(String(settings.soundboardMaxBytes / 1024 / 1024));
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
        soundboardMaxBytes: Math.round(Number(maxSizeMb) * 1024 * 1024),
      });
      setMaxSounds(String(settings.soundboardMaxSounds));
      setMaxDurationSeconds(String(settings.soundboardMaxDurationMs / 1000));
      setMaxSizeMb(String(settings.soundboardMaxBytes / 1024 / 1024));
      setSaveNotice("Salvo.");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
      <div className="space-y-6">
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
            <p className="text-xs text-red-500 dark:text-red-400">{loadError}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="soundboard-max-sounds" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Máximo de sons por servidor
                </label>
                <input
                  id="soundboard-max-sounds"
                  type="number"
                  min={1}
                  max={200}
                  className={inputClass}
                  value={maxSounds}
                  onChange={(e) => setMaxSounds(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="soundboard-max-duration" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Duração máxima por som (segundos)
                </label>
                <input
                  id="soundboard-max-duration"
                  type="number"
                  min={1}
                  max={60}
                  step={0.5}
                  className={inputClass}
                  value={maxDurationSeconds}
                  onChange={(e) => setMaxDurationSeconds(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="soundboard-max-size" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Tamanho máximo por som (MB)
                </label>
                <input
                  id="soundboard-max-size"
                  type="number"
                  min={0.0625}
                  max={10}
                  step={0.25}
                  className={inputClass}
                  value={maxSizeMb}
                  onChange={(e) => setMaxSizeMb(e.target.value)}
                />
              </div>

              {saveError && <p className="text-xs text-red-500 dark:text-red-400">{saveError}</p>}
              {saveNotice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{saveNotice}</p>}

              <button
                type="submit"
                disabled={saving}
                className="cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </form>
          )}
        </section>

        <AdminBackgroundsSection />
      </div>
  );
}
