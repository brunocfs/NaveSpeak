import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiRequest } from "../api/http.js";

// Extrai o CÓDIGO de convite de qualquer coisa colada no campo único de
// "entrar com convite": só o código (ex.: ABC123DEF456) ou a URL inteira do
// convite (.../join/ABC123DEF456), com ou sem protocolo/query string. Mesmo
// formato validado de verdade no servidor (inviteCodeSchema em
// server/src/validation/schemas.js, 12 caracteres hex) - isto aqui só limpa
// o que a pessoa colou antes de mandar, o servidor sempre reconfere.
function extractInviteCode(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    // Colou com protocolo (https://...) - jeito mais confiável de achar o
    // último segmento do caminho, já descartando query string/hash sozinho.
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? trimmed;
  } catch {
    // Sem protocolo (só o código, ou "app.com/join/CODIGO" colado sem
    // "https://") - pega o último pedaço depois da última "/", descartando
    // eventual "?query" que tenha vindo junto.
    const withoutQuery = trimmed.split("?")[0];
    const parts = withoutQuery.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? trimmed;
  }
}

const TABS = { CREATE: "create", JOIN: "join" };

// Modal aberto pelo botão "+" do cabeçalho de RoomsPage.jsx - reúne as duas
// formas de "entrar num servidor" (criar um novo ou usar um convite) que
// antes só existiam no painel expansível da própria página.
export default function CreateOrJoinServerModal({ open, onClose, onSuccess }) {
  const [tab, setTab] = useState(TABS.CREATE);
  const [name, setName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  function reset() {
    setName("");
    setInviteInput("");
    setError(null);
    setTab(TABS.CREATE);
  }

  function handleClose() {
    if (busy) return; // não fecha no meio de uma requisição em andamento
    reset();
    onClose();
  }

  function switchTab(next) {
    setTab(next);
    setError(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest("/rooms", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      reset();
      onClose();
      onSuccess(data.room);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    const inviteCode = extractInviteCode(inviteInput);
    if (!inviteCode) return;

    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest("/rooms/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode }),
      });
      reset();
      onClose();
      onSuccess(data.room);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Criar ou entrar em um servidor"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Adicionar um servidor
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => switchTab(TABS.CREATE)}
            className={`rounded-lg py-2 text-sm font-semibold transition ${
              tab === TABS.CREATE
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Criar servidor
          </button>
          <button
            type="button"
            onClick={() => switchTab(TABS.JOIN)}
            className={`rounded-lg py-2 text-sm font-semibold transition ${
              tab === TABS.JOIN
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Entrar com convite
          </button>
        </div>

        {tab === TABS.CREATE ? (
          <form onSubmit={handleCreate} className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Defina um nome para começar um novo servidor.
            </p>
            <input
              type="text"
              autoFocus
              placeholder="Nome do servidor"
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
            >
              {busy ? "Criando..." : "Criar servidor"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin} className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Cole um código de convite ou o link inteiro (ex.: .../join/ABC123DEF456).
            </p>
            <input
              type="text"
              autoFocus
              placeholder="Código ou link de convite"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            />
            <button
              type="submit"
              disabled={busy || !inviteInput.trim()}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
            >
              {busy ? "Entrando..." : "Entrar no servidor"}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
