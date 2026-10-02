import StyledUsername from "./StyledUsername.jsx";
import { Toggle } from "./Toggle.jsx";

export const DEFAULT_NAME_STYLE = {
  colorMode: "none", // "none" | "solid" | "gradient" - só de controle local, nunca vai pro servidor
  color: "#7c3aed",
  gradient: ["#7c3aed", "#22d3ee"],
  bold: false,
  italic: false,
  underline: false,
  font: "default",
  effect: "none",
  showInVoice: true,
};

const FONT_OPTIONS = [
  { value: "default", label: "Padrão" },
  { value: "serif", label: "Serifada" },
  { value: "mono", label: "Monoespaçada" },
  { value: "display", label: "Destaque" },
];

const EFFECT_OPTIONS = [
  { value: "none", label: "Nenhum" },
  { value: "shine", label: "Brilho" },
  { value: "pulse", label: "Pulsante" },
  { value: "cipher", label: "Criptografado" },
];

// name_style do servidor (color/gradient/bold/italic/underline/font/effect)
// <-> estado local do formulário (mesmos campos + colorMode, que só existe
// aqui pra decidir qual dos dois - color ou gradient - o formulário mostra).
export function nameStyleFromServer(nameStyle) {
  const s = nameStyle ?? {};
  return {
    ...DEFAULT_NAME_STYLE,
    ...s,
    colorMode: s.gradient ? "gradient" : s.color ? "solid" : "none",
    color: s.color ?? DEFAULT_NAME_STYLE.color,
    gradient: s.gradient ?? DEFAULT_NAME_STYLE.gradient,
  };
}

export function nameStyleToPayload(styleForm) {
  return {
    color: styleForm.colorMode === "solid" ? styleForm.color : null,
    gradient: styleForm.colorMode === "gradient" ? styleForm.gradient : null,
    bold: styleForm.bold,
    italic: styleForm.italic,
    underline: styleForm.underline,
    font: styleForm.font,
    effect: styleForm.effect,
    showInVoice: styleForm.showInVoice,
  };
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white";
const colorInputClass =
  "h-10 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#0f1117]";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300";

function optionClass(selected) {
  return `cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
    selected
      ? "border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-950/40 dark:text-purple-300"
      : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;
}

// Editor controlado do estilo do nome (preview + cor/gradiente, negrito/
// itálico/sublinhado, fonte, efeito). `value` no formato de
// nameStyleFromServer; quem usa decide quando salvar (nameStyleToPayload).
// Usado no perfil do Zeno (admin) e no perfil do usuário TURBO.
export default function NameStyleEditor({ value, onChange, disabled, previewName, idPrefix = "name-style" }) {
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/60">
        <StyledUsername
          username={previewName}
          style={nameStyleToPayload(value)}
          className="text-base font-semibold text-slate-900 dark:text-white"
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Cor</p>
        <div className="mb-2 grid grid-cols-3 gap-2">
          {[
            { value: "none", label: "Padrão" },
            { value: "solid", label: "Sólida" },
            { value: "gradient", label: "Gradiente" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set({ colorMode: opt.value })}
              aria-pressed={value.colorMode === opt.value}
              disabled={disabled}
              className={optionClass(value.colorMode === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {value.colorMode === "solid" && (
          <input
            type="color"
            aria-label="Cor do nome"
            value={value.color}
            onChange={(e) => set({ color: e.target.value })}
            disabled={disabled}
            className={colorInputClass}
          />
        )}
        {value.colorMode === "gradient" && (
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Cor inicial do gradiente"
              value={value.gradient[0]}
              onChange={(e) => set({ gradient: [e.target.value, value.gradient[1]] })}
              disabled={disabled}
              className={colorInputClass}
            />
            <span className="text-xs text-slate-400 dark:text-slate-500">até</span>
            <input
              type="color"
              aria-label="Cor final do gradiente"
              value={value.gradient[1]}
              onChange={(e) => set({ gradient: [value.gradient[0], e.target.value] })}
              disabled={disabled}
              className={colorInputClass}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "bold", label: "Negrito" },
          { key: "italic", label: "Itálico" },
          { key: "underline", label: "Sublinhado" },
        ].map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => set({ [opt.key]: !value[opt.key] })}
            aria-pressed={value[opt.key]}
            disabled={disabled}
            className={optionClass(value[opt.key])}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-font`} className={labelClass}>
            Fonte
          </label>
          <select
            id={`${idPrefix}-font`}
            value={value.font}
            onChange={(e) => set({ font: e.target.value })}
            disabled={disabled}
            className={inputClass}
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-effect`} className={labelClass}>
            Efeito
          </label>
          <select
            id={`${idPrefix}-effect`}
            value={value.effect}
            onChange={(e) => set({ effect: e.target.value })}
            disabled={disabled}
            className={inputClass}
          >
            {EFFECT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Toggle
        checked={value.showInVoice}
        onChange={(showInVoice) => set({ showInVoice })}
        disabled={disabled}
        label="Exibir estilo na lista do canal de voz"
      />
    </div>
  );
}
