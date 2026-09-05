import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, Plus, Send, Settings2 } from "lucide-react";
import { listInvites, createInvite } from "../api/rooms.js";
import { listFriends } from "../api/friends.js";
import { getSocket } from "../api/socket.js";
import Avatar from "./Avatar.jsx";

function formatExpiry(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Modal de "Convidar para o servidor" - só é montado por RoomPage.jsx quando
// o usuário já tem CREATE_INVITE (ou é dono); o servidor reforça a mesma
// permissão em POST /rooms/:roomId/invites (requirePermission
// (CREATE_INVITE)), então mesmo sem essa checagem no client a criação seria
// recusada. Mostra só UM link "atual" (o convite ativo mais recente, ou um
// novo se nenhum existir) - gerenciar TODOS os convites (revogar, deletar,
// ver quem entrou por cada um) é na aba "Convites" de ServerSettingsModal.jsx
// (`onManageInvites` leva pra lá). "Gerar novo link" cria mais um convite,
// nunca substitui/apaga os anteriores.
export default function ServerUserInvite({ room, onClose, onManageInvites }) {
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsError, setFriendsError] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [sentIds, setSentIds] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invites } = await listInvites(room.id);
        if (cancelled) return;
        const active = invites.find((i) => i.usable);
        if (active) {
          setCurrent(active);
          setLoading(false);
        } else {
          // Nenhum convite ativo (servidor novo, ou todos expirados/
          // revogados) - gera um pra já deixar um link pronto pra copiar.
          const { invite } = await createInvite(room.id);
          if (!cancelled) setCurrent(invite);
          if (!cancelled) setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message ?? "Não foi possível carregar os convites.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  useEffect(() => {
    listFriends()
      .then((data) => setFriends(data.friends))
      .catch((err) => setFriendsError(err.message))
      .finally(() => setFriendsLoading(false));
  }, []);

  async function handleCopy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copie o link do convite:", current.link);
    }
  }

  async function handleGenerateNew() {
    setGenerating(true);
    setError(null);
    try {
      const { invite } = await createInvite(room.id);
      setCurrent(invite);
      setSentIds(new Set());
    } catch (err) {
      setError(err.message ?? "Não foi possível gerar um novo link.");
    } finally {
      setGenerating(false);
    }
  }

  function handleSendToFriend(friend) {
    if (!current) return;
    setSendingId(friend.id);
    const socket = getSocket();
    socket.emit(
      "dm:send",
      { userId: friend.id, content: `Vem pro meu servidor "${room.name}"! ${current.link}`, attachments: [] },
      (response) => {
        setSendingId(null);
        if (response?.error) {
          setFriendsError(response.error);
        } else {
          setSentIds((prev) => new Set(prev).add(friend.id));
        }
      }
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Convidar para o servidor"
      onClick={onClose}
    >
      <div className="mx-auto w-full max-w-md">
        <div
          className="w-full rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Convidar para {room.name}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Link de convite
              </label>
              {loading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Gerando link...</p>
              ) : current ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={current.link}
                      onFocus={(e) => e.target.select()}
                      className="w-full truncate rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      title="Copiar link"
                      aria-label="Copiar link"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    Esse convite expira em 30 dias (válido até {formatExpiry(current.expiresAt)}).
                  </p>
                </>
              ) : null}
              {error && <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>}
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleGenerateNew}
                  disabled={generating || loading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-700 disabled:opacity-60 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {generating ? "Gerando..." : "Gerar novo link"}
                </button>
                {onManageInvites && (
                  <button
                    type="button"
                    onClick={onManageInvites}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Gerenciar convites
                  </button>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                Enviar por mensagem privada
              </p>
              {friendsError && (
                <p className="mb-1.5 text-xs text-red-500 dark:text-red-400">{friendsError}</p>
              )}
              {friendsLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Carregando amigos...</p>
              ) : friends.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Você ainda não tem amigos adicionados.
                </p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1 dark:border-slate-700">
                  {friends.map((friend) => {
                    const sent = sentIds.has(friend.id);
                    return (
                      <li key={friend.id}>
                        <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                          <span className="flex min-w-0 items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                            <Avatar avatarPath={friend.avatarPath} username={friend.username} size="xs" />
                            <span className="truncate">{friend.username}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSendToFriend(friend)}
                            disabled={sendingId === friend.id || sent || !current}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            {sent ? (
                              <>
                                <Check className="h-3.5 w-3.5" /> Enviado
                              </>
                            ) : (
                              <>
                                <Send className="h-3.5 w-3.5" />
                                {sendingId === friend.id ? "Enviando..." : "Enviar"}
                              </>
                            )}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
