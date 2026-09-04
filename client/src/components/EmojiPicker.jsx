import { useMemo, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { EMOJI_CATEGORIES } from "../utils/emoji.js";

// Popover simples de emoji - botão Smile abre/fecha, busca filtra por
// nome+keywords (utils/emoji.js), clique chama onSelect(char) e fecha. Fechar ao
// perder foco usa o mesmo truque de onMouseDown+preventDefault que a lista de
// menção de MessageInput.jsx já usa (senão o onBlur do botão fecha o popover
// antes do clique registrar).
export default function EmojiPicker({ onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const buttonRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJI_CATEGORIES;
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      emojis: cat.emojis.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.keywords.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.emojis.length > 0);
  }, [query]);

  function toggle() {
    setOpen((o) => !o);
    setQuery("");
  }

  function pick(char) {
    onSelect(char);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        title="Inserir emoji"
        aria-label="Inserir emoji"
        aria-expanded={open}
        className={`cursor-pointer inline-flex shrink-0 items-center justify-center rounded-xl border px-3 py-3 transition disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? "border-blue-500 bg-blue-50 text-blue-600 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-300"
            : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        }`}
      >
        <Smile className="size-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Seletor de emoji"
          className="absolute bottom-full right-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="border-b border-slate-200 p-2 dark:border-slate-700">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar emoji..."
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-2">
            {filtered.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-slate-400">
                Nenhum emoji encontrado.
              </p>
            )}
            {filtered.map((cat) => (
              <div key={cat.label} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {cat.label}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {cat.emojis.map((e) => (
                    <button
                      key={e.char}
                      type="button"
                      title={e.name}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        pick(e.char);
                      }}
                      className="flex items-center justify-center rounded-lg py-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {e.char}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
