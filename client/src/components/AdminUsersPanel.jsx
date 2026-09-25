import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  listUsers,
  banUser,
  unbanUser,
  disconnectUser,
  grantTurbo,
  revokeTurbo,
  setUserTurboBenefits,
} from "../api/adminUsers.js";
import Avatar from "./Avatar.jsx";
import { Toggle } from "./Toggle.jsx";
import TurboBadge from "./TurboBadge.jsx";
import { TURBO_BENEFITS } from "./AdminTurboPanel.jsx";

const DURATIONS = [
  { hours: 1, label: "1 hora" },
  { hours: 24, label: "24 horas" },
  { hours: 24 * 7, label: "7 dias" },
  { hours: 24 * 30, label: "30 dias" },
];

// value = dias; "custom" abre o campo de dias; "forever" = sem expiração.
const TURBO_DURATIONS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "1 ano" },
  { value: "custom", label: "Outro (dias)" },
  { value: "forever", label: "Sem expiração" },
];

const REFRESH_MS = 10_000;

const badge = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
const actionBtn =
  "cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtn =
  "cursor-pointer rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40";
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white";

// Todos os usuários da plataforma + moderação. Por privacidade só mostra SE
// o usuário está em voz e o tipo, nunca a sala nem com quem.
export default function AdminUsersPanel() {
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ users: [], total: 0, pageSize: 50 });
  const [error, setError] = useState(null);
  // { userId, mode: 'block' | 'ban' | 'benefits' } - formulário aberto na linha.
  const [form, setForm] = useState(null);
  // Seleção pra TURBO em massa - sobrevive a troca de página/busca de propósito.
  const [selected, setSelected] = useState(() => new Set());
  const [turboDuration, setTurboDuration] = useState("30");
  const [customDays, setCustomDays] = useState("");
  const [bulkMessage, setBulkMessage] = useState(null);

  function load() {
    listUsers({ q, online: onlineOnly, page })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }

  // Recarrega ao mudar filtro/página e a cada 10s enquanto a aba está aberta.
  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [q, onlineOnly, page]);

  async function run(action) {
    setError(null);
    try {
      await action();
      setForm(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleSelected(ids, value) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function runBulk(action, doneLabel) {
    setBulkMessage(null);
    setError(null);
    try {
      const res = await action([...selected]);
      setSelected(new Set());
      setBulkMessage(`${doneLabel}: ${res.updated} usuário(s).`);
      load();
    } catch (err) {
      setError(err.message || "Não foi possível aplicar o TURBO.");
    }
  }

  function submitGrant(e) {
    e.preventDefault();
    let days = null;
    if (turboDuration === "custom") {
      days = Number(customDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        setError("Dias de TURBO: número inteiro entre 1 e 3650.");
        return;
      }
    } else if (turboDuration !== "forever") {
      days = Number(turboDuration);
    }
    runBulk((ids) => grantTurbo(ids, days), "TURBO concedido");
  }

  function submitBenefits(e, u) {
    e.preventDefault();
    // "" = segue o catálogo global (chave omitida), "on"/"off" = override.
    const benefits = {};
    for (const b of TURBO_BENEFITS) {
      const v = e.target[b.key].value;
      if (v) benefits[b.key] = v === "on";
    }
    run(() => setUserTurboBenefits(u.id, benefits));
  }

  function submitForm(e, u) {
    e.preventDefault();
    const reason = e.target.reason.value.trim();
    const durationHours = form.mode === "block" ? Number(e.target.duration.value) : undefined;
    if (form.mode === "ban" && !window.confirm(`Banir ${u.tag} permanentemente?`)) return;
    run(() => banUser(u.id, { reason, durationHours }));
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageIds = data.users.map((u) => u.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Usuários ({data.total})</h2>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por nome"
          aria-label="Buscar usuário"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500"
        />
        <Toggle
          checked={onlineOnly}
          label="Somente online"
          onChange={(v) => {
            setOnlineOnly(v);
            setPage(1);
          }}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-fuchsia-200 bg-fuchsia-50/60 px-4 py-2 text-xs text-slate-700 dark:border-fuchsia-900/50 dark:bg-fuchsia-950/20 dark:text-slate-300">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={pageAllSelected}
            onChange={(e) => toggleSelected(pageIds, e.target.checked)}
            className="size-4 cursor-pointer accent-purple-600"
          />
          Selecionar página
        </label>
        <TurboBadge />
        <span className="font-semibold">{selected.size} selecionado(s)</span>
        {selected.size > 0 && (
          <form onSubmit={submitGrant} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Duração do TURBO"
              value={turboDuration}
              onChange={(e) => setTurboDuration(e.target.value)}
              className={inputClass}
            >
              {TURBO_DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            {turboDuration === "custom" && (
              <input
                type="number"
                min={1}
                max={3650}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                placeholder="Dias"
                aria-label="Dias de TURBO"
                className={`${inputClass} w-20`}
              />
            )}
            <button type="submit" className={actionBtn}>
              Conceder TURBO
            </button>
            <button
              type="button"
              className={dangerBtn}
              onClick={() => {
                if (window.confirm(`Remover o TURBO de ${selected.size} usuário(s)?`)) runBulk(revokeTurbo, "TURBO removido");
              }}
            >
              Remover TURBO
            </button>
            <button type="button" className={actionBtn} onClick={() => setSelected(new Set())}>
              Limpar seleção
            </button>
          </form>
        )}
        {bulkMessage && <span className="text-emerald-600 dark:text-emerald-400">{bulkMessage}</span>}
      </div>

      {error && <p className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

      <ul className="space-y-2">
        {data.users.map((u) => {
          const canModerate = u.id !== me?.id && !u.isAdmin;
          return (
            <li
              key={u.id}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-900 dark:text-white">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${u.tag}`}
                    checked={selected.has(u.id)}
                    onChange={(e) => toggleSelected([u.id], e.target.checked)}
                    className="size-4 cursor-pointer accent-purple-600"
                  />
                  <Avatar avatarPath={u.avatarPath} username={u.tag} size="sm" />
                  <span className="truncate">{u.tag}</span>
                  {u.isTurbo && (
                    <span className={`${badge} inline-flex items-center gap-1 bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300`}>
                      <TurboBadge className="size-3" />
                      {u.turboUntil ? `TURBO até ${new Date(u.turboUntil).toLocaleString("pt-BR")}` : "TURBO sem expiração"}
                    </span>
                  )}
                  {u.isAdmin &&<span className={`${badge} bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300`}>Admin</span>}
                  {u.online && <span className={`${badge} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`}>Online</span>}
                  {u.voice === "server" && <span className={`${badge} bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300`}>Em canal de servidor</span>}
                  {u.voice === "call" && <span className={`${badge} bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300`}>Em chamada privada</span>}
                  {u.isBanned && (
                    <span
                      title={u.banReason ?? undefined}
                      className={`${badge} bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300`}
                    >
                      {u.bannedUntil ? `Suspenso até ${new Date(u.bannedUntil).toLocaleString("pt-BR")}` : "Banido"}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" className={actionBtn} onClick={() => setForm({ userId: u.id, mode: "benefits" })}>
                    Benefícios TURBO
                  </button>
                  {canModerate && (
                    <>
                    {u.online && (
                      <button type="button" className={actionBtn} onClick={() => run(() => disconnectUser(u.id))}>
                        Desconectar
                      </button>
                    )}
                    {u.isBanned ? (
                      <button type="button" className={actionBtn} onClick={() => run(() => unbanUser(u.id))}>
                        Remover banimento
                      </button>
                    ) : (
                      <>
                        <button type="button" className={actionBtn} onClick={() => setForm({ userId: u.id, mode: "block" })}>
                          Bloquear
                        </button>
                        <button type="button" className={dangerBtn} onClick={() => setForm({ userId: u.id, mode: "ban" })}>
                          Banir
                        </button>
                      </>
                    )}
                    </>
                  )}
                </div>
              </div>

              {form?.userId === u.id && form.mode === "benefits" && (
                <form onSubmit={(e) => submitBenefits(e, u)} className="mt-2 flex flex-wrap items-center gap-2">
                  {TURBO_BENEFITS.map((b) => {
                    const current = u.turboBenefits?.[b.key];
                    return (
                      <label key={b.key} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        {b.label}
                        <select
                          name={b.key}
                          defaultValue={current === true ? "on" : current === false ? "off" : ""}
                          className={inputClass}
                        >
                          <option value="">Padrão (aba TURBO)</option>
                          <option value="on">Liberado</option>
                          <option value="off">Bloqueado</option>
                        </select>
                      </label>
                    );
                  })}
                  <button type="submit" className={actionBtn}>
                    Salvar
                  </button>
                  <button type="button" className={actionBtn} onClick={() => setForm(null)}>
                    Cancelar
                  </button>
                </form>
              )}

              {form?.userId === u.id && form.mode !== "benefits" && (
                <form onSubmit={(e) => submitForm(e, u)} className="mt-2 flex flex-wrap items-center gap-2">
                  {form.mode === "block" && (
                    <select name="duration" className={inputClass}>
                      {DURATIONS.map((d) => (
                        <option key={d.hours} value={d.hours}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <input name="reason" maxLength={280} placeholder="Motivo (opcional)" className={`${inputClass} min-w-0 flex-1`} />
                  <button type="submit" className={dangerBtn}>
                    {form.mode === "block" ? "Confirmar bloqueio" : "Confirmar banimento"}
                  </button>
                  <button type="button" className={actionBtn} onClick={() => setForm(null)}>
                    Cancelar
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <button type="button" className={actionBtn} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          {page} / {pages}
          <button type="button" className={actionBtn} disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}
