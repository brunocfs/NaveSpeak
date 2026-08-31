// Metadados compartilhados do status de presença (online/busy/away/offline
// + invisible, só pro próprio dono no StatusSelector.jsx) - usado por toda
// tela que exibe a bolinha de status: FriendsPanel, DmPanel, RoomPage
// (membros do servidor) e o próprio seletor no cabeçalho de RoomsPage.
export const STATUS_META = {
  online: { label: "Online", dot: "bg-emerald-500" },
  busy: { label: "Ocupado", dot: "bg-red-500" },
  away: { label: "Ausente", dot: "bg-amber-500" },
  offline: { label: "Offline", dot: "bg-slate-400 dark:bg-slate-500" },
  invisible: { label: "Invisível", dot: "bg-slate-400 dark:bg-slate-500" },
};

export function statusLabel(status) {
  return STATUS_META[status]?.label ?? STATUS_META.offline.label;
}

// Bolinha colorida de status - mesmo elemento que já existia (h-2.5 w-2.5
// rounded-full) só/agora com 4 cores em vez de 2.
export default function StatusDot({ status, className = "" }) {
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <span
      title={meta.label}
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot} ${className}`}
    />
  );
}
