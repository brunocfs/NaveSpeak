import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createReport, listReports } from "../api/reports.js";
import Avatar from "../components/Avatar.jsx";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;

const TYPE_OPTIONS = [
  { value: "bug", label: "Bug", description: "Algo não está funcionando como deveria." },
  { value: "suggestion", label: "Sugestão", description: "Uma ideia de melhoria ou novo recurso." },
];

function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Validação de formato só pra feedback imediato - a regra que vale de
// verdade é sempre a do servidor (reportCreateSchema em
// server/src/validation/schemas.js), mesmo padrão de ProfilePage.jsx.
function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = "Título é obrigatório.";
  else if (form.title.trim().length > TITLE_MAX) errors.title = `Título muito longo (máx. ${TITLE_MAX} caracteres).`;
  if (!form.description.trim()) errors.description = "Descrição é obrigatória.";
  else if (form.description.trim().length > DESCRIPTION_MAX)
    errors.description = `Descrição muito longa (máx. ${DESCRIPTION_MAX} caracteres).`;
  return errors;
}

export default function ReportsPage() {
  const [form, setForm] = useState({ type: "bug", title: "", description: "" });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  async function loadReports() {
    try {
      const data = await listReports();
      setReports(data.reports);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setBusy(true);
    try {
      const data = await createReport({
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
      });
      setReports((prev) => [data.report, ...prev]);
      setForm({ type: form.type, title: "", description: "" });
      setErrors({});
      setSubmitSuccess(
        form.type === "bug" ? "Bug relatado. Obrigado!" : "Sugestão enviada. Obrigado!",
      );
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Link
            to="/rooms"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            &larr;
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Reportar bug ou sugestão</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Novo report</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Tipo</p>
              <div className="grid grid-cols-2 gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, type: opt.value }))}
                    aria-pressed={form.type === opt.value}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      form.type === opt.value
                        ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                        : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="report-title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Título
              </label>
              <input
                id="report-title"
                type="text"
                maxLength={TITLE_MAX}
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={form.type === "bug" ? "Ex.: Microfone corta ao trocar de canal" : "Ex.: Atalho pra silenciar rápido"}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
              {errors.title && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.title}</p>}
            </div>

            <div>
              <label htmlFor="report-description" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Descrição
              </label>
              <textarea
                id="report-description"
                rows={5}
                maxLength={DESCRIPTION_MAX}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={form.type === "bug" ? "O que aconteceu? Como reproduzir?" : "Descreva a ideia e por que ela ajudaria."}
                className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
              <div className="mt-1 flex items-center justify-between">
                {errors.description ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{errors.description}</p>
                ) : (
                  <span />
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {form.description.length}/{DESCRIPTION_MAX}
                </p>
              </div>
            </div>

            {submitError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {submitError}
              </p>
            )}
            {submitSuccess && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                {submitSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
            >
              {busy ? "Enviando..." : "Enviar"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Reports enviados</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {reports.length}
            </span>
          </div>

          {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
          {loadError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          )}
          {!loading && !loadError && reports.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum report enviado ainda.</p>
          )}

          <ul className="space-y-3">
            {reports.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                          r.type === "bug"
                            ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                        }`}
                      >
                        {r.type === "bug" ? "Bug" : "Sugestão"}
                      </span>
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {r.title}
                      </p>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">
                      {r.description}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Avatar avatarPath={r.avatarPath} username={r.username} size="xs" />
                  <span>{r.username}</span>
                  <span>·</span>
                  <span>{formatDate(r.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
