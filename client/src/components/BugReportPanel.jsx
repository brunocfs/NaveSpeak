import { useEffect, useMemo, useState } from "react";
import { createReport, listReports, updateReport } from "../api/reports.js";
import { useAuth } from "../context/AuthContext.jsx";
import Avatar from "./Avatar.jsx";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;
const RESPONSE_MAX = 4000;

const TYPE_OPTIONS = [
  {
    value: "bug",
    label: "Bug",
    description: "Algo não está funcionando como deveria.",
  },
  {
    value: "suggestion",
    label: "Sugestão",
    description: "Uma ideia de melhoria ou novo recurso.",
  },
];

// Espelha o CHECK ck_reports_status em database/schema-postgre.sql.
const STATUS_META = {
  ABERTO: {
    label: "Aberto",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  EM_ANALISE: {
    label: "Em análise",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  RESOLVIDO: {
    label: "Resolvido",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  FECHADO: {
    label: "Fechado",
    className:
      "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  },
  REPROVADO: {
    label: "Reprovado",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};
const STATUS_ORDER = [
  "ABERTO",
  "EM_ANALISE",
  "RESOLVIDO",
  "FECHADO",
  "REPROVADO",
];

const SELECT_CLASSNAME =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:focus:border-purple-400 dark:focus:ring-blue-400/20";

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
  else if (form.title.trim().length > TITLE_MAX)
    errors.title = `Título muito longo (máx. ${TITLE_MAX} caracteres).`;
  if (!form.description.trim()) errors.description = "Descrição é obrigatória.";
  else if (form.description.trim().length > DESCRIPTION_MAX)
    errors.description = `Descrição muito longa (máx. ${DESCRIPTION_MAX} caracteres).`;
  return errors;
}

// Card de um report - edição de status/resposta só aparece pra admin
// (users.is_admin, mesmo gate do requireAdmin em reports.routes.js). Estado
// do rascunho é local ao card pra não disparar refetch a cada tecla digitada.
function ReportCard({ report, isAdmin, onUpdated }) {
  const [status, setStatus] = useState(report.status);
  const [response, setResponse] = useState(report.adminResponse ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const dirty =
    status !== report.status || response !== (report.adminResponse ?? "");
  const statusMeta = STATUS_META[report.status] ?? STATUS_META.ABERTO;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const data = await updateReport(report.id, {
        status,
        response: response.trim(),
      });
      onUpdated(data.report);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            report.type === "bug"
              ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
          }`}
        >
          {report.type === "bug" ? "Bug" : "Sugestão"}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusMeta.className}`}
        >
          {statusMeta.label}
        </span>
        <p className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white">
          {report.title}
        </p>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">
        {report.description}
      </p>

      {!isAdmin && report.adminResponse && (
        <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-[#0f1117] dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">
            Resposta da equipe:{" "}
          </span>
          {report.adminResponse}
        </p>
      )}

      {isAdmin && (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <div className="flex flex-wrap gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={`${SELECT_CLASSNAME} w-auto`}
            >
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {STATUS_META[value].label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            maxLength={RESPONSE_MAX}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Resposta da equipe (visível pra quem reportou)..."
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-purple-400 dark:focus:ring-blue-400/20"
          />
          {saveError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="cursor-pointer rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#7c3aed] dark:hover:bg-blue-400"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Avatar
          avatarPath={report.avatarPath}
          username={report.username}
          size="xs"
        />
        <span>{report.username}</span>
        <span>·</span>
        <span>{formatDate(report.created_at)}</span>
      </div>
    </li>
  );
}

export default function BugReportPanel() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [tab, setTab] = useState("form");

  const [form, setForm] = useState({ type: "bug", title: "", description: "" });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [usernameFilter, setUsernameFilter] = useState("");

  async function loadReports() {
    setLoading(true);
    try {
      const data = await listReports({
        status: statusFilter,
        type: typeFilter,
      });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter]);

  const filteredReports = useMemo(() => {
    const needle = usernameFilter.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((r) => r.username.toLowerCase().includes(needle));
  }, [reports, usernameFilter]);

  function handleReportUpdated(updated) {
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

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
      const matchesFilters =
        (!statusFilter || statusFilter === data.report.status) &&
        (!typeFilter || typeFilter === data.report.type);
      if (matchesFilters) setReports((prev) => [data.report, ...prev]);
      setForm({ type: form.type, title: "", description: "" });
      setErrors({});
      setSubmitSuccess(
        form.type === "bug"
          ? "Bug relatado. Obrigado!"
          : "Sugestão enviada. Obrigado!",
      );
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className=" space-y-6  ">
      <div className="flex gap-2 px-6 pt-6">
        <button
          type="button"
          onClick={() => setTab("form")}
          className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition ${
            tab === "form"
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          Novo report
        </button>
        <button
          type="button"
          onClick={() => setTab("list")}
          className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition ${
            tab === "list"
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          Reports enviados
        </button>
      </div>

      {tab === "form" && (
        <section className="  p-6  ">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                Tipo
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, type: opt.value }))
                    }
                    aria-pressed={form.type === opt.value}
                    className={`cursor-pointer rounded-xl border px-4 py-3 text-left transition ${
                      form.type === opt.value
                        ? "border-blue-500 bg-blue-50 dark:border-purple-400 dark:bg-purple-500/10"
                        : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0f1117] dark:hover:bg-slate-700"
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
              <label
                htmlFor="report-title"
                className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Título
              </label>
              <input
                id="report-title"
                type="text"
                maxLength={TITLE_MAX}
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder={
                  form.type === "bug"
                    ? "Ex.: Microfone corta ao trocar de canal"
                    : "Ex.: Atalho pra silenciar rápido"
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-purple-400 dark:focus:ring-blue-400/20"
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {errors.title}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="report-description"
                className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Descrição
              </label>
              <textarea
                id="report-description"
                rows={5}
                maxLength={DESCRIPTION_MAX}
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder={
                  form.type === "bug"
                    ? "O que aconteceu? Como reproduzir?"
                    : "Descreva a ideia e por que ela ajudaria."
                }
                className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2  dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-purple-400 dark:focus:ring-blue-400/20"
              />
              <div className="mt-1 flex items-center justify-between">
                {errors.description ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {errors.description}
                  </p>
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
              className="cursor-pointer inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#7c3aed] dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
            >
              {busy ? "Enviando..." : "Enviar"}
            </button>
          </form>
        </section>
      )}

      {tab === "list" && (
        <section className="  p-6 shadow-sm ">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Reports
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {filteredReports.length}
            </span>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={SELECT_CLASSNAME}
            >
              <option value="">Todos os status</option>
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {STATUS_META[value].label}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={SELECT_CLASSNAME}
            >
              <option value="">Todos os tipos</option>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={usernameFilter}
              onChange={(e) => setUsernameFilter(e.target.value)}
              placeholder="Filtrar por usuário..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-purple-400 dark:focus:ring-blue-400/20"
            />
          </div>

          {loading && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Carregando...
            </p>
          )}
          {loadError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          )}
          {!loading && !loadError && filteredReports.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nenhum report encontrado.
            </p>
          )}

          <ul className="space-y-3">
            {filteredReports.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                isAdmin={isAdmin}
                onUpdated={handleReportUpdated}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
