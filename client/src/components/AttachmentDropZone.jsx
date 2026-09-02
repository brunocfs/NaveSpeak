import { useState } from "react";
import { Paperclip } from "lucide-react";

// Overlay de "solte pra anexar" em volta de qualquer conteúdo (ChatPanel.jsx/
// DmPanel.jsx envolvem o painel inteiro com isso, não só o MessageInput -
// arrastar em qualquer lugar do chat funciona). Só chama onFilesDropped no
// drop de verdade; NÃO sobe nada sozinho - quem decide start do upload é
// MessageInput.addDroppedFiles (fica em estado "pendente" até confirmação).
export default function AttachmentDropZone({ onFilesDropped, disabled, className = "", children }) {
  // Contador em vez de bool simples: dragenter/dragleave disparam pra cada
  // filho do container conforme o cursor passa por cima deles - sem o
  // contador o overlay "pisca" toda hora que o mouse cruza uma borda interna.
  const [depth, setDepth] = useState(0);
  const active = depth > 0;

  function hasFiles(e) {
    return Array.from(e.dataTransfer?.types ?? []).includes("Files");
  }

  function handleDragEnter(e) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    setDepth((d) => d + 1);
  }

  function handleDragOver(e) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault(); // necessário pra permitir o drop
  }

  function handleDragLeave(e) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    setDepth((d) => Math.max(d - 1, 0));
  }

  function handleDrop(e) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    setDepth(0);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFilesDropped(files);
  }

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/90 dark:bg-blue-950/85">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
            <Paperclip className="size-5" />
            Solte para anexar
          </div>
        </div>
      )}
    </div>
  );
}
