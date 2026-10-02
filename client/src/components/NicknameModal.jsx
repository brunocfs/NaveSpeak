import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { setMemberNickname } from "../api/rooms.js";

// Alterar o apelido de um membro NESTE servidor - aberto pelo menu de clique
// direito do roster de voz ou da lista de membros (RoomPage.jsx). RoomPage
// só oferece a opção pra si mesmo ou com MANAGE_NICKNAMES, mas quem decide é
// o servidor (PATCH /rooms/:roomId/members/:userId/nickname). Campo vazio
// remove o apelido. O nome novo chega a todo mundo via 'member:nickname'
// (NicknamesContext), inclusive pra quem salvou - sem atualização otimista.
export default function NicknameModal({
  roomId,
  userId,
  username,
  nickname,
  isSelf,
  onClose,
}) {
  const [value, setValue] = useState(nickname ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await setMemberNickname(roomId, userId, value.trim() || null);
      onClose();
    } catch (err) {
      setError(err.message ?? "Não foi possível alterar o apelido.");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Alterar apelido"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-[#181a20] dark:ring-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isSelf ? "Alterar meu apelido" : `Alterar apelido de ${username}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="cursor-pointer rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="member-nickname"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Apelido
            </label>
            <input
              id="member-nickname"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={32}
              placeholder={username}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Vale só neste servidor. Deixe vazio para usar o nome de usuário.
            </p>
          </div>
          {error && (
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full cursor-pointer rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="w-full cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400"
          >
            {submitting ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
