import { useEffect, useState } from "react";
import { getAppSettings, updateAppSettings } from "../api/soundboard.js";
import { Toggle } from "./Toggle.jsx";
import TurboBadge from "./TurboBadge.jsx";

// Catálogo de benefícios TURBO (espelha turboBenefitsSchema no servidor).
// Benefício novo = entrada nova aqui + no schema.
export const TURBO_BENEFITS = [{ key: "nameStyle", label: "Nome colorido e com efeito" }];

// Catálogo GLOBAL: o que todo usuário TURBO recebe. Override por usuário fica
// na aba Usuários. Chave ausente no servidor = ligado.
export default function AdminTurboPanel() {
  const [benefits, setBenefits] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAppSettings()
      .then((data) => setBenefits(data.settings.turboBenefits ?? {}))
      .catch((err) => setError(err.message || "Não foi possível carregar os benefícios."));
  }, []);

  async function toggle(key, value) {
    const next = { ...benefits, [key]: value };
    setBusy(true);
    setError(null);
    try {
      const data = await updateAppSettings({ turboBenefits: next });
      setBenefits(data.settings.turboBenefits);
    } catch (err) {
      setError(err.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          Benefícios TURBO <TurboBadge className="size-4" />
        </h2>
      </div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Vale pra todos os usuários TURBO. Para liberar ou bloquear um benefício de um usuário específico, use a aba
        Usuários. Conceder TURBO também é pela aba Usuários.
      </p>

      {error && <p className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

      {benefits && (
        <ul className="space-y-2">
          {TURBO_BENEFITS.map((b) => (
            <li
              key={b.key}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"
            >
              <Toggle
                checked={benefits[b.key] !== false}
                label={b.label}
                disabled={busy}
                onChange={(v) => toggle(b.key, v)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
