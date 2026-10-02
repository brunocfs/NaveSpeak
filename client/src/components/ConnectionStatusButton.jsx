import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetworkStats } from "../context/MediaSessionContext.jsx";

const QUALITY_COLOR = {
  good: "text-green-600 dark:text-green-500",
  fair: "text-amber-500 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-500",
  unknown: "text-slate-400 dark:text-slate-500",
};

// const QUALITY_LABEL = {
//   good: "Voz Conectada",
//   fair: "Conexão instável",
//   poor: "Conexão ruim",
//   unknown: "Medindo conexão...",
// };

// Só "unknown" tem rótulo visível hoje (chave de tradução); os demais ficam
// vazios de propósito - a cor do ícone já diz a qualidade.
const QUALITY_LABEL_KEY = {
  unknown: "shell.connection.connecting",
};

// Ícone de estado da chamada de voz - cor segue networkStats.quality
// (MediaSessionContext, calculado via getStats() dos transports mediasoup).
// Clicar abre um popover com o detalhe (ping/perda de pacote)
export default function ConnectionStatusButton() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const { ping, packetLoss, quality } = useNetworkStats();
  const Icon = quality === "poor" || quality === "unknown" ? WifiOff : Wifi;
  const qualityLabel = QUALITY_LABEL_KEY[quality] ? t(QUALITY_LABEL_KEY[quality]) : "";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("shell.connection.stats")}
        aria-label={t("shell.connection.stats")}
        className={` cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition hover:bg-slate-200/70 dark:hover:bg-slate-700/70 ${QUALITY_COLOR[quality]}`}
      >
        <Icon className="size-4" />
        {quality !== "unknown" && (
          <span className="hidden sm:inline">{ping} ms</span>
        )}
        <span className="hidden sm:inline">{qualityLabel}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-52 rounded-xl  border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-[#181a20]">
          <p className={`mb-2 text-xs font-semibold ${QUALITY_COLOR[quality]}`}>
            {qualityLabel}
          </p>
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span>{t("shell.connection.ping")}</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {ping != null ? `${ping} ms` : "—"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span>{t("shell.connection.packetLoss")}</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {packetLoss != null ? `${packetLoss}%` : "0%"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
