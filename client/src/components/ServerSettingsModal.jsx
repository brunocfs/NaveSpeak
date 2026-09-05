import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Trash2, Ban } from "lucide-react";
import Avatar, { avatarSrc } from "./Avatar.jsx";
import {
  updateRoom,
  updateServerSettings,
  listInvites,
  createInvite,
  revokeInvite,
  deleteInvite,
  kickMember,
  banMember,
  unbanMember,
  listBans,
} from "../api/rooms.js";
import { createRole, updateRole, deleteRole, assignRole, unassignRole } from "../api/roles.js";
import { createChannel, updateChannel, deleteChannel } from "../api/channels.js";
import { PERMISSION_LABELS, PERMISSION_KEYS, hasPermission } from "../api/roles.js";

const TABS = [
  { id: "general", label: "Geral", permission: "MANAGE_SERVER" },
  { id: "invites", label: "Convites", permission: "CREATE_INVITE" },
  { id: "roles", label: "Roles", permission: "ADMINISTRATOR" },
  { id: "channels", label: "Canais", permission: "MANAGE_CHANNELS" },
  { id: "members", label: "Membros", permission: "BAN_MEMBERS" },
];

// Modal de "Configurações do servidor" - só abre a partir do botão de
// engrenagem (ou de "Gerenciar convites" em ServerUserInvite.jsx, que usa
// `initialTab="invites"`) no header de RoomPage.jsx, que já filtra por ter
// QUALQUER permissão de admin (dono sempre vê). Cada aba individualmente
// checa de novo a permissão específica dela (myPermissions), pra nunca
// mostrar ações que o servidor recusaria.
export default function ServerSettingsModal({
  room,
  roles,
  channels,
  members,
  settings,
  myPermissions,
  isOwner,
  initialTab,
  onClose,
  onRefresh,
}) {
  const availableTabs = TABS.filter((t) => hasPermission(myPermissions, t.permission));
  const [tab, setTab] = useState(
    (initialTab && availableTabs.some((t) => t.id === initialTab) ? initialTab : availableTabs[0]?.id) ?? "general"
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Configurações do servidor"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex min-h-[32rem] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900"
      >
        <nav className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <h2 className="mb-3 px-2 text-sm font-semibold text-slate-900 dark:text-white">Configurações</h2>
          <ul className="space-y-1">
            {availableTabs.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setTab(t.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    tab === t.id
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "general" && (
            <GeneralTab room={room} settings={settings} onRefresh={onRefresh} />
          )}
          {tab === "invites" && <InvitesTab room={room} />}
          {tab === "roles" && <RolesTab room={room} roles={roles} members={members} onRefresh={onRefresh} />}
          {tab === "channels" && <ChannelsTab room={room} roles={roles} channels={channels} onRefresh={onRefresh} />}
          {tab === "members" && (
            <MembersTab room={room} members={members} isOwner={isOwner} onRefresh={onRefresh} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function fieldLabel(text) {
  return (
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {text}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

// --- Geral -----------------------------------------------------------------

function GeneralTab({ room, settings, onRefresh }) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  // undefined = não mexeu no ícone (mantém o atual); string = novo ícone
  // (preview + o que será enviado); null = removido.
  const [iconDataUrl, setIconDataUrl] = useState(undefined);
  const iconPreview = iconDataUrl === undefined ? avatarSrc(room.icon_path) : iconDataUrl;
  const [memberListMode, setMemberListMode] = useState(settings.memberListMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function handleIconChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setIconDataUrl(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateRoom(room.id, { name, icon: iconDataUrl, description: description.trim() || null });
      await updateServerSettings(room.id, { memberListMode });
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Geral</h3>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-4">
        {iconPreview ? (
          <img src={iconPreview} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <Avatar avatarPath={null} username={name} size="xl" />
        )}
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          Trocar imagem
          <input type="file" accept="image/*" className="hidden" onChange={handleIconChange} />
        </label>
      </div>

      <div>
        {fieldLabel("Nome do servidor")}
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </div>

      <div>
        {fieldLabel("Descrição (opcional)")}
        <textarea
          className={`${inputClass} resize-none`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          placeholder="Sobre o que é este servidor?"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Aparece na página de convite (/join/:code).
        </p>
      </div>

      <div>
        {fieldLabel("Lista de membros")}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              checked={memberListMode === "grouped"}
              onChange={() => setMemberListMode("grouped")}
            />
            Agrupada por role
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              checked={memberListMode === "simple"}
              onChange={() => setMemberListMode("simple")}
            />
            Simples (online/offline)
          </label>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}

// --- Convites ------------------------------------------------------------

// Gerência completa dos convites do servidor - lista TODOS (ativos,
// expirados, revogados), quem criou cada um e quem entrou por ele
// (histórico auditado, vem de server_invite_uses via GET /rooms/:roomId/
// invites). Só acessível com CREATE_INVITE (ver TABS acima); "Gerar
// convite" nunca mexe nos existentes - são múltiplos convites por servidor,
// não um só que se regenera.
function InvitesTab({ room }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { invites: data } = await listInvites(room.id);
      setInvites(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createInvite(room.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(invite) {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((prev) => (prev === invite.id ? null : prev)), 1500);
    } catch {
      window.prompt("Copie o link do convite:", invite.link);
    }
  }

  async function handleRevoke(invite) {
    if (!confirm(`Revogar o convite ${invite.code}? Ele para de funcionar imediatamente, mas continua listado aqui.`)) return;
    setBusyId(invite.id);
    try {
      await revokeInvite(room.id, invite.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(invite) {
    if (!confirm(`Excluir o convite ${invite.code}? Isso apaga também o histórico de quem entrou por ele.`)) return;
    setBusyId(invite.id);
    try {
      await deleteInvite(room.id, invite.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function statusLabel(invite) {
    if (invite.revokedAt) return { text: "Revogado", className: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
    if (!invite.usable) return { text: "Expirado", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
    return { text: "Ativo", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Convites</h3>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? "Gerando..." : "+ Gerar convite"}
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Todo convite expira 30 dias após ser gerado. Gerar um novo não afeta os já existentes.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum convite gerado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {invites.map((invite) => {
            const status = statusLabel(invite);
            const expanded = expandedId === invite.id;
            return (
              <li key={invite.id} className="rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-slate-800 dark:text-slate-100">{invite.code}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${status.className}`}>
                        {status.text}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Criado por {invite.createdByTag} em {new Date(invite.createdAt).toLocaleDateString("pt-BR")}
                      {" · "}
                      {invite.revokedAt
                        ? `revogado em ${new Date(invite.revokedAt).toLocaleDateString("pt-BR")}`
                        : `expira em ${new Date(invite.expiresAt).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => handleCopy(invite)}
                      title="Copiar link"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {copiedId === invite.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copiedId === invite.id ? "Copiado" : "Copiar"}
                    </button>
                    <button
                      onClick={() => setExpandedId(expanded ? null : invite.id)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Usado por {invite.usedBy.length}
                    </button>
                    {invite.usable && (
                      <button
                        onClick={() => handleRevoke(invite)}
                        disabled={busyId === invite.id}
                        title="Revogar"
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950/30"
                      >
                        <Ban className="size-3.5" />
                        Revogar
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(invite)}
                      disabled={busyId === invite.id}
                      title="Excluir"
                      className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="size-3.5" />
                      Excluir
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-200 px-3 py-2.5 dark:border-slate-700">
                    {invite.usedBy.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Ninguém entrou por este convite ainda.</p>
                    ) : (
                      <ul className="space-y-1">
                        {invite.usedBy.map((use, idx) => (
                          <li key={`${use.userId}-${idx}`} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                              <Avatar avatarPath={use.avatarPath} username={use.username} size="xs" />
                              {use.username}
                            </span>
                            <span className="text-slate-400 dark:text-slate-500">
                              {new Date(use.usedAt).toLocaleString("pt-BR")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- Roles -------------------------------------------------------------

function RolesTab({ room, roles, members, onRefresh }) {
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? null);
  const selected = roles.find((r) => r.id === selectedId) ?? null;

  async function handleCreate() {
    const { role } = await createRole(room.id, { name: "nova-role", color: "#99AAB5" });
    await onRefresh();
    setSelectedId(role.id);
  }

  return (
    <div className="flex gap-6">
      <div className="w-48 shrink-0">
        <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">Roles</h3>
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelectedId(r.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedId === r.id ? "bg-slate-200 dark:bg-slate-800" : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate text-slate-800 dark:text-slate-100">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={handleCreate}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          + Nova role
        </button>
      </div>

      {selected ? (
        <RoleEditor
          key={selected.id}
          room={room}
          role={selected}
          members={members}
          onRefresh={onRefresh}
          onDeleted={() => setSelectedId(null)}
        />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Selecione ou crie uma role.</p>
      )}
    </div>
  );
}

function RoleEditor({ room, role, members, onRefresh, onDeleted }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [permissions, setPermissions] = useState(role.permissions);
  const [position, setPosition] = useState(role.position);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleFlag(bit) {
    setPermissions((prev) => (prev & bit ? prev & ~bit : prev | bit));
  }

  const FLAG_VALUES = useMemo(() => {
    // Mesma ordem/valores de PERMISSIONS em server/src/utils/permissions.js -
    // duplicado aqui porque o client não importa código do servidor; se um
    // dia divergir, os checkboxes erram, mas os bits gravados vêm sempre do
    // servidor (roles prop), nunca inventados aqui.
    const bits = {};
    PERMISSION_KEYS.forEach((key, i) => { bits[key] = 1 << i; });
    return bits;
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateRole(room.id, role.id, { name, color, permissions, position: Number(position) });
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover a role "${role.name}"? Isso não afeta os canais nem os membros, só a atribuição desta role.`)) return;
    await deleteRole(room.id, role.id);
    await onRefresh();
    onDeleted();
  }

  const assignedMembers = members.filter((m) => (m.roles ?? []).some((r) => r.id === role.id));
  const candidates = members
    .filter((m) => !(m.roles ?? []).some((r) => r.id === role.id))
    .filter((m) => m.username.toLowerCase().includes(search.toLowerCase()));

  async function handleAssign(userId) {
    await assignRole(room.id, role.id, userId);
    await onRefresh();
  }
  async function handleUnassign(userId) {
    await unassignRole(room.id, role.id, userId);
    await onRefresh();
  }

  return (
    <div className="flex-1 space-y-5">
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded border border-slate-300 dark:border-slate-700"
        />
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
      </div>

      <div>
        {fieldLabel("Posição (maior = mais alta na lista de membros)")}
        <input
          type="number"
          className={`${inputClass} w-28`}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        />
      </div>

      <div>
        {fieldLabel("Permissões")}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {PERMISSION_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={Boolean(permissions & FLAG_VALUES[key])} onChange={() => toggleFlag(FLAG_VALUES[key])} />
              {PERMISSION_LABELS[key]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button
          onClick={handleDelete}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          Excluir role
        </button>
      </div>

      <div>
        {fieldLabel(`Membros com esta role (${assignedMembers.length})`)}
        <ul className="mb-2 space-y-1">
          {assignedMembers.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-2 py-1.5 dark:bg-slate-800">
              <span className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                <Avatar avatarPath={m.avatarPath} username={m.username} size="xs" />
                {m.username}
              </span>
              <button onClick={() => handleUnassign(m.id)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                Remover
              </button>
            </li>
          ))}
        </ul>
        <input
          placeholder="Buscar membro para adicionar..."
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
            {candidates.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <Avatar avatarPath={m.avatarPath} username={m.username} size="xs" />
                  {m.username}
                </span>
                <button onClick={() => handleAssign(m.id)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                  Adicionar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Canais ------------------------------------------------------------

const ROLE_ACTION_FIELDS = [
  { key: "viewRoleId", label: "Ver / acessar" },
  { key: "sendRoleId", label: "Enviar mensagem" },
  { key: "shareRoleId", label: "Compartilhar mídia (áudio/webcam/tela)" },
];

function ChannelsTab({ room, roles, channels, onRefresh }) {
  const [selectedId, setSelectedId] = useState(channels[0]?.id ?? null);
  const selected = channels.find((c) => c.id === selectedId) ?? null;
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("text");

  async function handleCreate() {
    if (!newName.trim()) return;
    const { channel } = await createChannel(room.id, { name: newName.trim(), type: newType });
    setNewName("");
    await onRefresh();
    setSelectedId(channel.id);
  }

  return (
    <div className="flex gap-6">
      <div className="w-56 shrink-0">
        <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">Canais</h3>
        <ul className="space-y-1">
          {channels.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelectedId(c.id)}
                className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedId === c.id ? "bg-slate-200 dark:bg-slate-800" : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                {c.type === "voice" ? "🔊" : "#"} {c.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-700">
          <input
            placeholder="Nome do canal"
            className={inputClass}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={64}
          />
          <select className={inputClass} value={newType} onChange={(e) => setNewType(e.target.value)}>
            <option value="text">Texto</option>
            <option value="voice">Voz</option>
          </select>
          <button onClick={handleCreate} className="w-full rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600">
            + Criar canal
          </button>
        </div>
      </div>

      {selected ? (
        <ChannelEditor key={selected.id} room={room} roles={roles} channel={selected} onRefresh={onRefresh} onDeleted={() => setSelectedId(null)} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Selecione ou crie um canal.</p>
      )}
    </div>
  );
}

function ChannelEditor({ room, roles, channel, onRefresh, onDeleted }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [roleFields, setRoleFields] = useState({
    viewRoleId: channel.viewRoleId,
    sendRoleId: channel.sendRoleId,
    shareRoleId: channel.shareRoleId,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateChannel(room.id, channel.id, {
        name,
        topic: channel.type === "text" ? topic : undefined,
        ...roleFields,
      });
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir o canal "${channel.name}"? As mensagens dele também serão apagadas.`)) return;
    await deleteChannel(room.id, channel.id);
    await onRefresh();
    onDeleted();
  }

  return (
    <div className="flex-1 space-y-5">
      <div>
        {fieldLabel("Nome")}
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </div>

      {channel.type === "text" && (
        <div>
          {fieldLabel("Tópico")}
          <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={255} />
        </div>
      )}

      <div className="space-y-3">
        {fieldLabel("Acesso por role")}
        {ROLE_ACTION_FIELDS.filter((f) => {
          if (f.key === "sendRoleId") return channel.type === "text";
          if (f.key === "shareRoleId") return channel.type === "voice";
          return true;
        }).map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">{f.label}</label>
            <select
              className={inputClass}
              value={roleFields[f.key] ?? ""}
              onChange={(e) => setRoleFields((prev) => ({ ...prev, [f.key]: e.target.value || null }))}
            >
              <option value="">Todos os membros</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button
          onClick={handleDelete}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          Excluir canal
        </button>
      </div>
    </div>
  );
}

// --- Membros -------------------------------------------------------------

function MembersTab({ room, members, isOwner, onRefresh }) {
  const [bans, setBans] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    listBans(room.id).then((data) => setBans(data.bans)).catch((err) => setError(err.message));
  }, [room.id]);

  async function handleKick(userId) {
    if (!confirm("Expulsar este membro? Ele pode reentrar com o convite.")) return;
    try {
      await kickMember(room.id, userId);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleBan(userId) {
    if (!confirm("Banir este membro? Ele não poderá reentrar até ser desbanido.")) return;
    try {
      await banMember(room.id, userId);
      const data = await listBans(room.id);
      setBans(data.bans);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUnban(userId) {
    try {
      await unbanMember(room.id, userId);
      setBans((prev) => prev.filter((b) => b.id !== userId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Membros</h3>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ul className="space-y-1">
        {members.map((m) => {
          const isCreator = room.created_by === m.id;
          return (
            <li key={m.id} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <span className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                <Avatar avatarPath={m.avatarPath} username={m.username} size="sm" />
                {m.username}
                {isCreator && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">criador</span>}
              </span>
              {!isCreator && (
                <span className="flex gap-2">
                  <button onClick={() => handleKick(m.id)} className="text-xs font-medium text-slate-600 hover:underline dark:text-slate-300">
                    Expulsar
                  </button>
                  <button onClick={() => handleBan(m.id)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                    Banir
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Banidos ({bans.length})
        </h4>
        {bans.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Ninguém banido.</p>
        ) : (
          <ul className="space-y-1">
            {bans.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-2 py-1.5 dark:bg-slate-800">
                <span className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <Avatar avatarPath={b.avatarPath} username={b.username} size="xs" />
                  {b.username}
                </span>
                <button onClick={() => handleUnban(b.id)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                  Desbanir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
