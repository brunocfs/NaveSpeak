import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";

// Mesmo cálculo de MessageContent.jsx/MessageInput.jsx - duplicado de
// propósito, é o padrão já usado nesses dois arquivos (sem util compartilhado
// pra isso ainda).
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes ?? 0} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

// Degraus de zoom - "fit" (padrão) mostra a imagem inteira contida na tela;
// os demais são % do tamanho NATURAL (naturalWidth/naturalHeight), dentro de
// um container com overflow-auto - passar de 100% do container vira scroll
// nativo do navegador, sem precisar implementar pan manual (arrastar) na mão.
const ZOOM_STEPS = ["fit", 50, 100, 150, 200, 300, 400];

// Lightbox de imagem do chat (ChatPanel/DmPanel, via MessageContent.jsx) -
// abre no clique em vez de abrir a URL numa aba nova (era o comportamento
// antigo). Mesmo padrão visual/portal de PreferencesModal.jsx (overlay
// fixed inset-0 + Esc/clique fora fecha).
export default function ImagePreviewModal({ src, name, size, onClose }) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [naturalSize, setNaturalSize] = useState(null); // { width, height } | null até a imagem carregar

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const zoom = ZOOM_STEPS[zoomIndex];
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_STEPS.length - 1;

  function zoomIn() {
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  }
  function zoomOut() {
    setZoomIndex((i) => Math.max(0, i - 1));
  }
  // Clique na própria imagem: alterna rápido entre "ajustada à tela" e
  // "tamanho real" (100%) - atalho comum de lightbox, sem precisar sempre
  // usar os botões +/-.
  function toggleZoomOnImage() {
    setZoomIndex((i) => (i === 0 ? ZOOM_STEPS.indexOf(100) : 0));
  }

  const displayName = name || src.split("/").pop().split("?")[0];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualização de ${displayName}`}
      onClick={onClose}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 p-3 text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate text-sm font-medium" title={displayName}>
          {displayName}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={!canZoomOut}
            aria-label="Diminuir zoom"
            className="rounded-lg p-2 transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ZoomOut className="size-5" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-slate-400">
            {zoom === "fit" ? "Ajustar" : `${zoom}%`}
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={!canZoomIn}
            aria-label="Aumentar zoom"
            className="rounded-lg p-2 transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ZoomIn className="size-5" />
          </button>
          <a
            href={src}
            download={displayName}
            onClick={(e) => e.stopPropagation()}
            aria-label="Baixar imagem"
            className="ml-1 rounded-lg p-2 transition hover:bg-white/10"
          >
            <Download className="size-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 transition hover:bg-white/10"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto px-4 pb-4"
        onClick={onClose}
      >
        <div className="flex min-h-full items-center justify-center">
          <img
            src={src}
            alt={displayName}
            onClick={(e) => {
              e.stopPropagation();
              toggleZoomOnImage();
            }}
            onLoad={(e) =>
              setNaturalSize({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            style={
              zoom === "fit"
                ? { maxWidth: "90vw", maxHeight: "calc(100vh - 8rem)" }
                : naturalSize
                  ? { width: (naturalSize.width * zoom) / 100 }
                  : undefined
            }
            className={`rounded-lg object-contain ${zoom === "fit" ? "cursor-zoom-in" : "cursor-zoom-out"}`}
          />
        </div>
      </div>

      {/* Detalhes: nome/tamanho do arquivo/resolução. Resolução só aparece
        depois do onLoad acima (natural*); tamanho em bytes só existe pra
        anexos de verdade (attachment.size) - imagem solta por URL no texto
        não tem esse dado, a linha some nesse caso. */}
      <div
        className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-white/10 p-3 text-xs text-slate-400"
        onClick={(e) => e.stopPropagation()}
      >
        {naturalSize && (
          <span>
            {naturalSize.width} × {naturalSize.height}px
          </span>
        )}
        {Number.isFinite(size) && <span>{formatBytes(size)}</span>}
      </div>
    </div>,
    document.body
  );
}
