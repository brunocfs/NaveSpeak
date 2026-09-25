import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { listAdmins, addAdmin, removeAdmin } from "../api/adminAdmins.js";
import { BroadcastsPanel } from "../pages/AdminBroadcastsPage.jsx";
import { SoundboardSettingsPanel } from "../pages/AdminSoundboardSettingsPage.jsx";
import { InvitesPanel } from "../pages/AdminInvitesPage.jsx";
import Avatar from "./Avatar.jsx";
import AdminOverviewPanel from "./AdminOverviewPanel.jsx";
import AdminUsersPanel from "./AdminUsersPanel.jsx";
import AdminTurboPanel from "./AdminTurboPanel.jsx";

const TABS = [
  { id: "overview", label: "Visão geral", Panel: AdminOverviewPanel },
  { id: "users", label: "Usuários", Panel: AdminUsersPanel },
  { id: "turbo", label: "TURBO", Panel: AdminTurboPanel },
  { id: "admins", label: "Administradores", Panel: AdminsPanel },
  { id: "broadcasts", label: "Comunicados", Panel: BroadcastsPanel },
  {
    id: "soundboard",
    label: "Soundboard e fundos",
    Panel: SoundboardSettingsPanel,
  },
  { id: "invites", label: "Convites", Panel: InvitesPanel },
];

// Painel admin único (users.is_admin) - todas as ferramentas administrativas
// em abas, aberto pelo DmSidebar em RoomsPage.jsx.
export default function AdminPanel() {
  const [tab, setTab] = useState(TABS[0].id);
  const { Panel } = TABS.find((t) => t.id === tab);

  return (
    <div className="mx-auto space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? "bg-purple-600 text-white dark:bg-purple-500"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Panel />
    </div>
  );
}

function AdminsPanel() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [tag, setTag] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listAdmins()
      .then((data) => setAdmins(data.admins))
      .catch((err) => setError(err.message));
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { admin } = await addAdmin(tag.trim());
      setAdmins((prev) => [...prev, admin]);
      setTag("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(admin) {
    if (!window.confirm(`Remover o acesso de administrador de ${admin.tag}?`))
      return;
    setError(null);
    try {
      await removeAdmin(admin.id);
      setAdmins((prev) => prev.filter((a) => a.id !== admin.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
        Administradores do sistema
      </h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Administradores têm acesso a todas as ferramentas deste painel.
      </p>

      <form onSubmit={handleAdd} className="mb-4 flex gap-2">
        <input
          type="text"
          required
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="usuario#12345"
          aria-label="Usuário"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400"
        >
          Tornar admin
        </button>
      </form>

      {error && (
        <p className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</p>
      )}

      <ul className="space-y-2">
        {admins.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/60"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-slate-900 dark:text-white">
              <Avatar avatarPath={a.avatarPath} username={a.tag} size="sm" />
              <span className="truncate">{a.tag}</span>
            </span>
            {a.id !== user?.id && (
              <button
                type="button"
                onClick={() => handleRemove(a)}
                className="shrink-0 cursor-pointer rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
