import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createInvite, listInvites, revokeInvite } from "../api/invites.js";
import DownloadAppLink from "../components/DownloadAppLink.jsx";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Status derivado (o servidor já manda `usable`, mas o rótulo/cor exibido
// distingue POR QUE não é mais usável - revogado vs. expirado vs. esgotado -
// que é justamente o "acompanhamento" pedido: o admin quer saber o motivo,
// não só um booleano).
function inviteStatusLabel(invite) {
  if (invite.revokedAt) return { text: "Revogado", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date())
    return { text: "Expirado", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  if (invite.usesCount >= invite.maxUses)
    return { text: "Esgotado", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return { text: "Ativo", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";

export default function AdminInvitesPage() {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({ type: "link", email: "", maxUses: 1, expiresInDays: "" });
  const [submitError, setSubmitError] = useState(null);
  const [submitNotice, setSubmitNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [copiedId, setCopiedId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  async function loadInvites() {
    try {
      const data = await listInvites();
      setInvites(data.invites);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvites();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitNotice(null);
    setBusy(true);
    try {
      const payload = {
        type: form.type,
        maxUses: Number(form.maxUses) || 1,
      };
      if (form.type === "email") payload.email = form.email.trim();
      if (form.expiresInDays) payload.expiresInDays = Number(form.expiresInDays);

      const data = await createInvite(payload);
      setInvites((prev) => [{ ...data.invite, createdByTag: "você" }, ...prev]);
      setForm({ type: form.type, email: "", maxUses: 1, expiresInDays: "" });

      if (form.type === "email") {
        setSubmitNotice(
          data.email?.sent
            ? `Convite criado e email enviado para ${payload.email}.`
            : `Convite criado, mas o email não foi enviado (${data.email?.reason ?? "SMTP indisponível"}). Copie o link abaixo e envie manualmente.`,
        );
      } else {
        setSubmitNotice("Convite criado. Copie o link abaixo para compartilhar.");
      }
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(invite) {
    const confirmed = window.confirm(`Revogar o convite ${invite.code}? Ele para de funcionar imediatamente.`);
    if (!confirmed) return;
    try {
      await revokeInvite(invite.id);
      setInvites((prev) =>
        prev.map((i) => (i.id === invite.id ? { ...i, revokedAt: new Date().toISOString(), usable: false } : i)),
      );
    } catch (err) {
      setLoadError(err.message);
    }
  }

  async function handleCopy(invite) {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((prev) => (prev === invite.id ? null : prev)), 1500);
    } catch {
      window.prompt("Copie o link do convite:", invite.link);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              &larr;
            </Link>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Convites</h1>
          </div>
          <DownloadAppLink />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Novo convite</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Tipo</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, type: "link" }))}
                  aria-pressed={form.type === "link"}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    form.type === "link"
                      ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                      : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">Link</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    Um link genérico pra compartilhar onde quiser.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, type: "email" }))}
                  aria-pressed={form.type === "email"}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    form.type === "email"
                      ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                      : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">Email</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    Envia o link automaticamente para um endereço.
                  </span>
                </button>
              </div>
            </div>

            {form.type === "email" && (
              <div>
                <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Email do convidado
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="pessoa@exemplo.com"
                  className={inputClass}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="invite-max-uses" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Limite de contas
                </label>
                <input
                  id="invite-max-uses"
                  type="number"
                  min={1}
                  max={1000}
                  value={form.maxUses}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxUses: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="invite-expires" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Expira em (dias, opcional)
                </label>
                <input
                  id="invite-expires"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="Sem expiração"
                  value={form.expiresInDays}
                  onChange={(e) => setForm((prev) => ({ ...prev, expiresInDays: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>

            {submitError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {submitError}
              </p>
            )}
            {submitNotice && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                {submitNotice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              {busy ? "Criando..." : "Criar convite"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Convites emitidos</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {invites.length}
            </span>
          </div>

          {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
          {loadError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          )}
          {!loading && !loadError && invites.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum convite criado ainda.</p>
          )}

          <ul className="space-y-3">
            {invites.map((invite) => {
              const status = inviteStatusLabel(invite);
              const redemptions = invite.redemptions ?? [];
              return (
                <li
                  key={invite.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${status.cls}`}>
                          {status.text}
                        </span>
                        <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                          {invite.code}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {invite.type === "email" ? `email · ${invite.email}` : "link"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {invite.usesCount}/{invite.maxUses} conta(s) · criado por {invite.createdByTag} em{" "}
                        {formatDate(invite.createdAt)}
                        {invite.expiresAt && <> · expira em {formatDate(invite.expiresAt)}</>}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(invite)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {copiedId === invite.id ? "Copiado!" : "Copiar link"}
                      </button>
                      {invite.usable && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(invite)}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          Revogar
                        </button>
                      )}
                      {redemptions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId((prev) => (prev === invite.id ? null : invite.id))}
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          {expandedId === invite.id ? "Ocultar" : `Ver quem entrou (${redemptions.length})`}
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedId === invite.id && redemptions.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-slate-200 pt-3 dark:border-slate-700">
                      {redemptions.map((r, idx) => (
                        <li key={idx} className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                          <span>
                            {r.username}#{r.discriminator}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500">{formatDate(r.redeemedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
