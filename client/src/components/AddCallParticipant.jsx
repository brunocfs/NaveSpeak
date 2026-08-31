import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { useCall } from "../context/CallContext.jsx";
import { listFriends } from "../api/friends.js";

// Convidar mais alguém para a chamada PRIVADA ativa (grupo) - só renderizado
// por VoicePanel quando o canal de voz atual é uma chamada (channelId
// "call:<uuid>"), nunca para canal de voz de servidor (lá quem quer entrar
// já é membro do servidor, não precisa de convite). Não mexe em nenhum
// producer/transport dos participantes já conectados - só dispara
// call:invite (ver CallContext.jsx).
export default function AddCallParticipant({ roster }) {
  const { inviteToCall } = useCall();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    listFriends()
      .then((data) => setFriends(data.friends))
      .catch((err) => setError(err.message));
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Exclui quem já está na chamada (convidado, aceito ou ainda tocando) -
  // "saiu" (left) pode ser convidado de novo.
  const rosterIds = new Set(
    roster.filter((p) => p.status === "invited" || p.status === "accepted").map((p) => p.userId)
  );
  const invitable = friends.filter((f) => !rosterIds.has(f.id));

  async function handleInvite(friend) {
    setBusyId(friend.id);
    setError(null);
    const res = await inviteToCall(friend);
    setBusyId(null);
    if (res?.error) setError(res.error);
    else setOpen(false);
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
      >
        <UserPlus className="size-4" /> Adicionar
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
            Adicionar à chamada
          </p>
          {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          {invitable.length === 0 && (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
              Nenhum amigo disponível.
            </p>
          )}
          <ul className="max-h-56 overflow-y-auto">
            {invitable.map((friend) => (
              <li key={friend.id}>
                <button
                  onClick={() => handleInvite(friend)}
                  disabled={busyId === friend.id}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <span className="truncate">{friend.username}</span>
                  {busyId === friend.id && <span className="text-xs text-slate-400">...</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
