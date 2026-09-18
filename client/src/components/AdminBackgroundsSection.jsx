import { useEffect, useRef, useState } from "react";
import { getAppSettings, updateAppSettings } from "../api/soundboard.js";
import {
  listBackgrounds,
  uploadSystemBackground,
  deleteSystemBackground,
  backgroundSrc,
} from "../api/backgrounds.js";

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
                className="cursor-pointer text-red-600 hover:underline dark:text-red-400"
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
        className="mb-6 cursor-pointer rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
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

      <form onSubmit={handleSaveSettings} className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={serverEnabled} onChange={(e) => setServerEnabled(e.target.checked)} />
          Permitir que usuários enviem fundos pessoais para o servidor
        </label>
        <label className="block text-sm text-slate-700 dark:text-slate-200">
          Máximo de fundos por usuário
          <input
            type="number"
            min={1}
            max={50}
            value={maxCount}
            onChange={(e) => setMaxCount(e.target.value)}
            className="ml-2 w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <button
          type="submit"
          className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Salvar
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
    </section>
  );
}
