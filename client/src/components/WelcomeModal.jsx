import { useState } from "react";
import { createPortal } from "react-dom";
import { renderMarkdown } from "../utils/markdown.jsx";
import patchNotesRaw from "../content/patch-notes.md?raw";

// Modal de novidades/patch notes - conteúdo vem do .md em
// src/content/patch-notes.md (renderizado por utils/markdown.jsx, sem
// dependência externa). Quando abrir sozinho (primeiro login, nova versão)
// e como fechar sem/com "não mostrar novamente" é decidido por quem chama
// (ver hooks/useWhatsNew.js); este componente só é o card em si, mesmo
// padrão de overlay em portal do PreferencesModal.jsx.
export default function WelcomeModal({ open, version, onClose }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) return null;

  function handleClose() {
    onClose(dontShowAgain);
    setDontShowAgain(false);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Novidades da versão ${version}`}
      onClick={handleClose}
    >
      <div className="mx-auto w-full max-w-lg">
        <div
          className="w-full rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Novidades</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">Versão {version}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Fechar"
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {renderMarkdown(patchNotesRaw)}
          </div>

          <label className="mt-5 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700"
            />
            Não mostrar novamente
          </label>

          <button
            type="button"
            onClick={handleClose}
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
