import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listBroadcasts, sendBroadcast } from "../api/adminBroadcasts.js";
import MessageInput from "../components/MessageInput.jsx";
import MessageContent from "../components/MessageContent.jsx";
import SystemUserProfile from "../components/SystemUserProfile.jsx";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Comunicado pode ter até 20k chars: no histórico colapsa em 6 linhas com
// toggle "ver mais" quando longo (muito texto ou muitas quebras).
function CollapsibleContent({ content, attachments }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isLong = (content?.length ?? 0) > 400 || (content?.split("\n").length ?? 0) > 6;
  return (
    <div className="mt-2">
      <div className={isLong && !expanded ? "line-clamp-6" : undefined}>
        <MessageContent content={content} attachments={attachments} />
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-semibold text-purple-600 hover:underline dark:text-purple-300"
        >
          {expanded ? t("common.showLess") : t("common.showMore")}
        </button>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500";

// Painel do "Zeno, o Astronauta" - único lugar que consegue mandar mensagem
// como a conta oficial do sistema (ver server/src/routes/adminBroadcasts.routes.js).
// Mesmo esqueleto visual de AdminInvitesPage.jsx (form em cima, histórico
// embaixo). Aba do painel admin (AdminPanel.jsx).
export function BroadcastsPanel() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [target, setTarget] = useState("all");
  const [tag, setTag] = useState("");
  const [submitNotice, setSubmitNotice] = useState(null);
  const messageInputRef = useRef(null);

  async function loadBroadcasts() {
    try {
      const data = await listBroadcasts();
      setBroadcasts(data.broadcasts);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBroadcasts();
  }, []);

  // Contrato de onSend do MessageInput.jsx (mesmo usado por ChatPanel/DmPanel):
  // recebe (content, attachments), devolve {error} pro próprio componente
  // mostrar - ou nada/{ok:true}, que já limpa o campo sozinho.
  async function handleComposerSend(content, attachments) {
    setSubmitNotice(null);
    if (target === "user" && !tag.trim()) {
      return { error: "Informe o usuário (usuario#12345)." };
    }
    try {
      const payload = { content, attachments, target };
      if (target === "user") payload.tag = tag.trim();

      const data = await sendBroadcast(payload);
      setSubmitNotice(
        target === "all"
          ? `Comunicado enviado para ${data.recipientCount} usuário(s).`
          : `Comunicado enviado.`,
      );
      await loadBroadcasts();
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  return (
      <div className="space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Perfil do Zeno
          </h2>
          <SystemUserProfile />
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
            Novo comunicado
          </h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Enviado como "Zeno, o Astronauta" - os usuários não conseguem
            responder essa conta.
          </p>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                Destinatário
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTarget("all")}
                  aria-pressed={target === "all"}
                  className={`cursor-pointer rounded-xl border px-4 py-3 text-left transition ${
                    target === "all"
                      ? "border-purple-500 bg-purple-50 dark:border-purple-400 dark:bg-purple-950/40"
                      : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0f1117] dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                    Todos os usuários
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    Broadcast pra base inteira.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTarget("user")}
                  aria-pressed={target === "user"}
                  className={`cursor-pointer rounded-xl border px-4 py-3 text-left transition ${
                    target === "user"
                      ? "border-purple-500 bg-purple-50 dark:border-purple-400 dark:bg-purple-950/40"
                      : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0f1117] dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                    Usuário específico
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    Só quem você indicar recebe.
                  </span>
                </button>
              </div>
            </div>

            {target === "user" && (
              <div>
                <label htmlFor="broadcast-tag" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Identificador do usuário
                </label>
                <input
                  id="broadcast-tag"
                  type="text"
                  required
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="usuario#12345"
                  className={inputClass}
                />
              </div>
            )}

            {submitNotice && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                {submitNotice}
              </p>
            )}

            {/* Composer completo (negrito/itálico/riscado/código, emoji,
                anexos por drag&drop ou clipe) - mesmo componente do chat de
                canal e da DM (ver ChatPanel.jsx/DmPanel.jsx), assim o
                comunicado sai formatado e pode levar foto/arquivo do mesmo
                jeito que qualquer mensagem normal. */}
            {/* 20000 espelha BROADCAST_MAX_CHARS em server/src/validation/schemas.js */}
            <MessageInput ref={messageInputRef} onSend={handleComposerSend} maxChars={20000} />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Histórico</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {broadcasts.length}
            </span>
          </div>

          {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
          {loadError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          )}
          {!loading && !loadError && broadcasts.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum comunicado enviado ainda.</p>
          )}

          <ul className="space-y-3">
            {broadcasts.map((b) => (
              <li
                key={b.id}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                      b.target === "all"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {b.target === "all" ? "Todos" : "Individual"}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {b.recipientCount} destinatário(s) · por {b.createdByTag} em {formatDate(b.createdAt)}
                  </span>
                </div>
                <CollapsibleContent content={b.content} attachments={b.attachments} />
              </li>
            ))}
          </ul>
        </section>
      </div>
  );
}
