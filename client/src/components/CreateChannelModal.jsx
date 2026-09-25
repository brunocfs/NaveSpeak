import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createChannel } from "../api/channels.js";
import { Toggle } from "./Toggle.jsx";
import { LockKeyhole } from "lucide-react";
// Modal leve de "criar canal", acionado pelo botão (+) da lista de canais em
// RoomPage.jsx - um atalho pra não precisar abrir Configurações do servidor >
// Canais só pra isso. Só define nome+tipo aqui (viewRoleId/sendRoleId/
// shareRoleId ficam null = "todo mundo pode", igual ao criar canal em
// ServerSettingsModal); permissões por role em canais específicos continuam
// se configurando depois, na aba Canais, via ChannelEditor.
//
// RoomPage só monta este componente se o usuário já tem MANAGE_CHANNELS
// (ver `canManageChannels` lá) - mas o servidor reforça a mesma permissão em
// POST /rooms/:roomId/channels (requirePermission(MANAGE_CHANNELS) em
// channels.routes.js), então mesmo sem essa checagem no client a criação
// seria recusada.
export default function CreateChannelModal({ roomId, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [submitting, setSubmitting] = useState(false);
  const [privateChannel, setPrivateChannel] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);
  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { channel } = await createChannel(roomId, { name: trimmed, type });
      onCreated(channel);
    } catch (err) {
      setError(err.message ?? "Não foi possível criar o canal.");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Criar canal"
      onClick={onClose}
    >
      <div className="mx-auto w-full max-w-xl">
        <form
          onSubmit={handleSubmit}
          className="w-full rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-[#181a20] dark:ring-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Criar canal
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="cursor-pointer rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType("text")}
                  aria-pressed={type === "text"}
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    type === "text"
                      ? "border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-950/40 dark:text-purple-300"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  # Texto
                </button>
                <button
                  type="button"
                  onClick={() => setType("voice")}
                  aria-pressed={type === "voice"}
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    type === "voice"
                      ? "border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-950/40 dark:text-purple-300"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  🔊 Voz
                </button>
              </div>
            </div>
            <div>
              <label
                htmlFor="create-channel-name"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Nome do canal
              </label>
              <input
                id="create-channel-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                placeholder="geral"
                className="w-full rounded-xl border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-purple-500"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <LockKeyhole />
              <div className="flex flex-col">
                <span>Canal Privado</span>
                <span className="text-sm text-gray-400">
                  Canal privado, selecione as roles necessárias para visualizar
                  este canal!
                </span>
              </div>
              <span className="relative inline-flex shrink-0">
                <Toggle
                  defaultChecked
                  label=""
                  onChange={(ativo) => {
                    console.log("Toggle alterado:", ativo);
                  }}
                />
              </span>
            </div>

            {error && (
              <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
            )}
          </div>

          <div className="mt-6 flex justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 w-full"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400 w-full"
            >
              {submitting ? "Criando..." : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
