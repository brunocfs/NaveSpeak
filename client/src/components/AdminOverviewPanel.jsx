import { useEffect, useState } from "react";
import { getStats } from "../api/adminUsers.js";

const REFRESH_MS = 10_000;

const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function Card({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </section>
  );
}

// Visão geral do painel admin - só números agregados, atualizados a cada 10s.
export default function AdminOverviewPanel() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () =>
      getStats()
        .then((data) => {
          setStats(data);
          setError(null);
        })
        .catch((err) => setError(err.message));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  if (error) return <p className="text-xs text-red-500 dark:text-red-400">{error}</p>;
  if (!stats) return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>;

  const { usage, resources: r } = stats;
  const usedMem = r.systemTotalMemBytes - r.systemFreeMemBytes;

  return (
    <div className="space-y-6">
      <Section title="Uso da plataforma">
        <Card label="Usuários" value={usage.totalUsers} />
        <Card label="Online agora" value={usage.online} />
        <Card label="Em canal de servidor" value={usage.inServerVoice} />
        <Card label="Em chamada privada" value={usage.inCall} />
        <Card label="Servidores" value={usage.servers} />
        <Card label="Mensagens (24h)" value={usage.messages24h} />
        <Card label="Salas de mídia ativas" value={usage.media.rooms} />
        <Card label="Conexões de mídia" value={usage.media.peers} />
        <Card label="Banidos / suspensos" value={usage.bannedUsers} />
      </Section>

      <Section title="Recursos do servidor">
        <Card label="Uptime" value={formatUptime(r.uptimeSeconds)} />
        <Card label="Memória do processo" value={mb(r.processRssBytes)} />
        <Card label="Heap usado" value={mb(r.heapUsedBytes)} />
        <Card label="Memória do sistema" value={`${mb(usedMem)} / ${mb(r.systemTotalMemBytes)}`} />
        <Card label="Carga (1m) / CPUs" value={`${r.loadAvg[0].toFixed(2)} / ${r.cpuCount}`} />
        {r.mediasoupWorkers.map((w, i) => (
          <Card
            key={w.pid}
            label={`Worker de mídia ${i + 1}`}
            value={`${mb(w.maxRssBytes)} · ${Math.round(w.cpuMs / 1000)}s CPU`}
          />
        ))}
      </Section>
    </div>
  );
}
