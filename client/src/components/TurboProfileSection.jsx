import { useState } from "react";
import { updateProfile } from "../api/profile.js";
import NameStyleEditor, { nameStyleFromServer, nameStyleToPayload } from "./NameStyleEditor.jsx";
import TurboBadge from "./TurboBadge.jsx";

const primaryBtn =
  "cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400";

// Status do TURBO + benefícios configuráveis pelo próprio usuário (hoje só o
// estilo do nome). `profile` = resposta de GET /users/me. O servidor recusa
// o nameStyle sem o benefício ativo - esconder o editor aqui é só UX.
export default function TurboProfileSection({ profile, onSaved }) {
  const [styleForm, setStyleForm] = useState(() => nameStyleFromServer(profile.nameStyle));
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
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
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

      {profile.isTurbo && !profile.canStyleName && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          O estilo de nome não está incluído no seu TURBO no momento.
        </p>
      )}

      {profile.canStyleName && (
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
