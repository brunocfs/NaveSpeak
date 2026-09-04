import { Bold, Italic, Strikethrough, Code } from "lucide-react";

// Barra de formatação sob demanda - aparece acima do textarea (MessageInput.jsx)
// quando `visible` é true (seleção de texto ativa OU botão auxiliar "Aa" fixado).
// Não é um popover flutuante no caret: <textarea> não expõe coordenada de pixel de
// uma seleção via Selection API sem hack de mirror-div, então a barra fica fixa
// acima do campo - ainda assim só aparece/some conforme o pedido ("ao selecionar
// texto ou clicar em botão").
const BUTTONS = [
  { marker: "**", Icon: Bold, label: "Negrito" },
  { marker: "*", Icon: Italic, label: "Itálico" },
  { marker: "~~", Icon: Strikethrough, label: "Riscado" },
  { marker: "`", Icon: Code, label: "Código" },
];

export default function FormatToolbar({ visible, onFormat, disabled }) {
  if (!visible) return null;

  return (
    <div
      role="toolbar"
      aria-label="Formatação de texto"
      className="flex w-fit gap-1 rounded-xl border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
    >
      {BUTTONS.map(({ marker, Icon, label }) => (
        <button
          key={marker}
          type="button"
          title={label}
          aria-label={label}
          disabled={disabled}
          // onMouseDown+preventDefault: mantém a seleção do textarea viva -
          // um onClick normal perderia o foco/seleção antes do handler rodar.
          onMouseDown={(e) => {
            e.preventDefault();
            onFormat(marker);
          }}
          className="cursor-pointer inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
