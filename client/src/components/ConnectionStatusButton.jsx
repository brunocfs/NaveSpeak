import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useMediaSession } from "../context/MediaSessionContext.jsx";

const QUALITY_COLOR = {
  good: "text-green-600 dark:text-green-500",
  fair: "text-amber-500 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-500",
  unknown: "text-slate-400 dark:text-slate-500",
};

const QUALITY_LABEL = {
  good: "Online",
  fair: "Conexão instável",
  poor: "Conexão ruim",
  unknown: "Medindo conexão...",
};

// Ícone de estado da chamada de voz - cor segue media.networkStats.quality
// (MediaSessionContext, calculado via getStats() dos transports mediasoup).
// Clicar abre um popover com o detalhe (ping/perda de pacote); nada disso
// existia antes - o lugar era ocupado por um <span>Online!</span> fixo, sem
// ligação nenhuma com o estado real da chamada.
export default function ConnectionStatusButton() {
  const media = useMediaSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const { ping, packetLoss, quality } = media.networkStats;
  const Icon = quality === "poor" || quality === "unknown" ? WifiOff : Wifi;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Estatísticas de conexão"
        aria-label="Estatísticas de conexão"
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition hover:bg-slate-200/70 dark:hover:bg-slate-700/70 ${QUALITY_COLOR[quality]}`}
      >
        <Icon className="size-4" />
        <span className="hidden sm:inline">{QUALITY_LABEL[quality]}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-52 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <p className={`mb-2 text-xs font-semibold ${QUALITY_COLOR[quality]}`}>
            {QUALITY_LABEL[quality]}
          </p>
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span>Ping</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {ping != null ? `${ping} ms` : "—"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span>Perda de pacotes</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {packetLoss != null ? `${packetLoss}%` : "0%"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
