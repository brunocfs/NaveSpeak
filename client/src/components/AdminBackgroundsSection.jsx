import { useEffect, useRef, useState } from "react";
import { getAppSettings, updateAppSettings } from "../api/soundboard.js";
import {
  listBackgrounds,
  uploadSystemBackground,
  deleteSystemBackground,
  backgroundSrc,
} from "../api/backgrounds.js";
import { Toggle } from "./Toggle.jsx";

const MAX_BYTES = 2 * 1024 * 1024; // mesmo teto de backgrounds.routes.js

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// Seção da página admin: fundos PADRÃO de câmera (aparecem pra todos os
// usuários no CameraSetupModal) + a chave que libera o upload pessoal no
// servidor (recurso futuro pago; desligado = usuário guarda só no dispositivo).
export default function AdminBackgroundsSection() {
  const [defaults, setDefaults] = useState([]);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [maxCount, setMaxCount] = useState("10");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    Promise.all([listBackgrounds(), getAppSettings()])
      .then(([list, { settings }]) => {
        setDefaults(list.defaults);
        setServerEnabled(settings.userBackgroundsServerEnabled);
        setMaxCount(String(settings.userBackgroundsMaxCount));
      })
      .catch((err) => setError(err.message));
  }, []);

  async function run(fn) {
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
  }

  const handleUpload = (e) =>
    run(async () => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > MAX_BYTES) throw new Error("Imagem maior que 2MB.");
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 48) || "Fundo";
      const { background } = await uploadSystemBackground({ name, image: await readAsDataUrl(file) });
      setDefaults((prev) => [...prev, background]);
    });

  const handleDelete = (id) =>
    run(async () => {
      await deleteSystemBackground(id);
      setDefaults((prev) => prev.filter((b) => b.id !== id));
    });

  const handleSaveSettings = (e) => {
    e.preventDefault();
    return run(async () => {
      const { settings } = await updateAppSettings({
        userBackgroundsServerEnabled: serverEnabled,
        userBackgroundsMaxCount: Number(maxCount),
      });
      setMaxCount(String(settings.userBackgroundsMaxCount));
      setNotice("Salvo.");
    });
  };

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Fundos de câmera</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Fundos padrão aparecem para todos os usuários ao ligar a câmera (PNG, JPG ou WebP, até 2MB).
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {defaults.map((b) => (
          <div key={b.id} className="relative overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
            <img src={backgroundSrc(b.filePath)} alt="" className="aspect-video w-full object-cover" />
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-700 dark:text-slate-200">
              <span className="truncate">{b.name}</span>
              <button
                type="button"
                onClick={() => handleDelete(b.id)}
                className="cursor-pointer rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => fileInputRef.current.click()}
        className="mb-6 cursor-pointer rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Adicionar fundo padrão
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleUpload}
      />

      <form onSubmit={handleSaveSettings} className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Toggle
          checked={serverEnabled}
          label="Permitir que usuários enviem fundos pessoais para o servidor"
          onChange={setServerEnabled}
        />
        <div>
          <label htmlFor="backgrounds-max-count" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Máximo de fundos por usuário
          </label>
          <input
            id="backgrounds-max-count"
            type="number"
            min={1}
            max={50}
            value={maxCount}
            onChange={(e) => setMaxCount(e.target.value)}
            className="w-32 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white"
          />
        </div>
        <button
          type="submit"
          className="cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400"
        >
          Salvar
        </button>
      </form>

      {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
    </section>
  );
}
