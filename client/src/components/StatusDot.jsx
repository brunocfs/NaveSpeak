import { useTranslation } from "react-i18next";
import i18n from "../i18n/index.js";

// Metadados compartilhados do status de presença (online/busy/away/offline
// + invisible, só pro próprio dono no StatusSelector.jsx) - usado por toda
// tela que exibe a bolinha de status: FriendsPanel, DmPanel, RoomPage
// (membros do servidor) e o próprio seletor no cabeçalho de RoomsPage.
// `labelKey` = chave de tradução (i18n/index.js).
export const STATUS_META = {
  online: { labelKey: "status.online", dot: "bg-emerald-500" },
  busy: { labelKey: "status.busy", dot: "bg-red-500" },
  away: { labelKey: "status.away", dot: "bg-amber-500" },
  offline: { labelKey: "status.offline", dot: "bg-slate-400 dark:bg-slate-500" },
  invisible: { labelKey: "status.invisible", dot: "bg-slate-400 dark:bg-slate-500" },
};

export function statusLabel(status) {
  return i18n.t((STATUS_META[status] ?? STATUS_META.offline).labelKey);
}

// Bolinha colorida de status - mesmo elemento que já existia (h-2.5 w-2.5
// rounded-full) só/agora com 4 cores em vez de 2.
export default function StatusDot({ status, className = "" }) {
  const { t } = useTranslation();
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <span
      title={t(meta.labelKey)}
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot} ${className}`}
    />
  );
}
