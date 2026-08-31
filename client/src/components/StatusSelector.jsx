import { useEffect, useRef, useState } from "react";
import { usePresence } from "../context/PresenceContext.jsx";
import { STATUS_META } from "./StatusDot.jsx";

// Ordem fixa de exibição no menu - não é a mesma ordem de STATUS_META
// (que também guarda 'offline', irrelevante aqui: ninguém "escolhe" ficar
// offline, isso é só desconectar).
const OPTIONS = ["online", "busy", "away", "invisible"];

// Seletor de presença no cabeçalho de RoomsPage.jsx, ao lado do username.
// Mostra sempre a PREFERÊNCIA escolhida (nunca o "Ausente" automático por
// inatividade - ver PresenceContext.jsx effectiveStatus) e persiste a troca
// via PATCH /api/users/me/status, que já propaga em tempo real pros
// servidores e amigos do usuário (ver online.handler.js/presenceBroadcast.js).
export default function StatusSelector() {
  const { status, setStatus } = usePresence();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSelect(next) {
    setOpen(false);
    if (next === status) return;
    setBusy(true);
    try {
      await setStatus(next);
    } finally {
      setBusy(false);
    }
  }

  const current = STATUS_META[status] ?? STATUS_META.online;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${current.dot}`} />
        {current.label}
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {OPTIONS.map((option) => {
            const meta = STATUS_META[option];
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option === status}
                  onClick={() => handleSelect(option)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    option === status
                      ? "bg-slate-100 font-semibold text-slate-900 dark:bg-slate-700 dark:text-white"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                  {meta.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
