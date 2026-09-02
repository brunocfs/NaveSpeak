import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Check, Loader2, Paperclip, X } from "lucide-react";
import { uploadAttachment } from "../api/attachments.js";
import Avatar from "./Avatar.jsx";

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB - mesmo limite validado no server (attachments.routes.js)
const MAX_MENTION_SUGGESTIONS = 8;

// Acha a menção que o usuário está digitando AGORA, se houver: um "@" logo
// antes do cursor (ou no início do texto), sem espaço no meio, seguido só de
// caracteres válidos de username. "@" no meio de uma palavra (ex.:
// "user@example") não conta - só dispara sugestão no INÍCIO de um token,
// igual Discord/Slack.
function findActiveMention(text, cursorPos) {
  const uptoCursor = text.slice(0, cursorPos);
  const match = /(?:^|\s)@([A-Za-z0-9_]{0,32})$/.exec(uptoCursor);
  if (!match) return null;
  const query = match[1];
  return { start: cursorPos - query.length - 1, query };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

let nextFileId = 0;

// Aceita ref (ChatPanel.jsx/DmPanel.jsx expõem drag&drop pelo painel inteiro
// via AttachmentDropZone, mas quem guarda a lista de arquivo é este
// componente) - addDroppedFiles é o método exposto pra isso.
const MessageInput = forwardRef(function MessageInput({ onSend, disabled, mentionCandidates = [] }, ref) {
  const [content, setContent] = useState("");
  // Menção sendo digitada agora: { start, query } (start = índice do "@" em
  // `content`) ou null quando o cursor não está num token de menção. Ver
  // findActiveMention acima.
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textInputRef = useRef(null);
  // Cada item: { id, file, name, size, status, attachment?, error? }
  // status: 'pending' (arrastado, aguardando confirmação) | 'uploading' |
  // 'done' | 'error'. Arquivo escolhido pelo seletor (clipe) pula direto pra
  // 'uploading' - já é uma ação explícita do usuário, não precisa de mais
  // confirmação. Arquivo ARRASTADO fica em 'pending' até o usuário clicar no
  // check do chip - só então sobe de verdade.
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const uploading = files.some((f) => f.status === "uploading");
  const hasPending = files.some((f) => f.status === "pending");
  const readyAttachments = files.filter((f) => f.status === "done").map((f) => f.attachment);
  const canSubmit = !disabled && !uploading && !hasPending && (content.trim() || readyAttachments.length > 0);

  const mentionMatches = mention
    ? mentionCandidates
        .filter((c) => c.username.toLowerCase().startsWith(mention.query.toLowerCase()))
        .slice(0, MAX_MENTION_SUGGESTIONS)
    : [];

  function handleContentChange(e) {
    const value = e.target.value;
    setContent(value);
    setMention(findActiveMention(value, e.target.selectionStart ?? value.length));
    setMentionIndex(0);
  }

  // `mention.start`/`query` (não a posição atual do cursor) definem o trecho
  // substituído - robusto mesmo quando a seleção veio de clique (que já
  // passou por onMouseDown com preventDefault, mas não custa não depender
  // disso).
  function insertMention(username) {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const before = content.slice(0, mention.start);
    const inserted = `@${username} `;
    const after = content.slice(end);
    const next = `${before}${inserted}${after}`;

    setContent(next);
    setMention(null);

    const cursor = before.length + inserted.length;
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function handleTextKeyDown(e) {
    if (!mention || mentionMatches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(mentionMatches[mentionIndex].username);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    }
  }

  function updateFile(id, patch) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function startUpload(id, file) {
    updateFile(id, { status: "uploading" });
    uploadAttachment(file)
      .then((attachment) => updateFile(id, { status: "done", attachment }))
      .catch((err) => updateFile(id, { status: "error", error: err.message }));
  }

  // Compartilhado pelo seletor de arquivo e pelo drop - só muda o status
  // inicial de cada item (auto-upload ou pendente de confirmação).
  function addFiles(fileList, { autoUpload }) {
    const incoming = Array.from(fileList ?? []);
    if (!incoming.length) return;

    if (files.length + incoming.length > MAX_ATTACHMENTS) {
      setError(`Máximo de ${MAX_ATTACHMENTS} anexos por mensagem.`);
      return;
    }
    setError(null);

    for (const file of incoming) {
      const id = nextFileId++;

      if (file.size > MAX_ATTACHMENT_BYTES) {
        setFiles((prev) => [
          ...prev,
          { id, file, name: file.name, size: file.size, status: "error", error: "Arquivo maior que 20MB." },
        ]);
        continue;
      }

      setFiles((prev) => [
        ...prev,
        { id, file, name: file.name, size: file.size, status: autoUpload ? "uploading" : "pending" },
      ]);
      if (autoUpload) startUpload(id, file);
    }
  }

  useImperativeHandle(ref, () => ({
    addDroppedFiles: (fileList) => addFiles(fileList, { autoUpload: false }),
  }));

  function handleFilesSelected(e) {
    addFiles(e.target.files, { autoUpload: true });
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois de remover
  }

  function confirmFile(id) {
    const entry = files.find((f) => f.id === id);
    if (entry?.status === "pending") startUpload(id, entry.file);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    const result = await onSend(content.trim(), readyAttachments);

    if (result?.error) {
      setError(result.error);
      return;
    }

    setContent("");
    setFiles([]);
    setMention(null);
  }

  const CHIP_STYLES = {
    error:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
    pending:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300",
    default: "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className={`flex max-w-[240px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                CHIP_STYLES[f.status] ?? CHIP_STYLES.default
              }`}
              title={f.status === "error" ? f.error : f.name}
            >
              {f.status === "uploading" && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="shrink-0 text-[10px] opacity-70">{formatBytes(f.size)}</span>
              {f.status === "pending" && (
                <button
                  type="button"
                  onClick={() => confirmFile(f.id)}
                  className="shrink-0 opacity-80 hover:opacity-100"
                  title="Confirmar upload"
                  aria-label={`Confirmar upload de ${f.name}`}
                >
                  <Check className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="shrink-0 opacity-60 hover:opacity-100"
                title="Remover"
                aria-label={`Remover ${f.name}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {hasPending && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Confirme (✓) ou remova (✕) os arquivos arrastados antes de enviar.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFilesSelected}
          disabled={disabled}
        />
        <div className="relative flex w-full gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Anexar arquivo"
            aria-label="Anexar arquivo"
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <Paperclip className="size-4" />
          </button>
          <input
            ref={textInputRef}
            type="text"
            placeholder="Escreva uma mensagem... (@ pra mencionar)"
            maxLength={2000}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleTextKeyDown}
            onBlur={() => setMention(null)}
            disabled={disabled}
            role="combobox"
            aria-expanded={mentionMatches.length > 0}
            aria-autocomplete="list"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
          />

          {mentionMatches.length > 0 && (
            <div
              role="listbox"
              className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-[80vw] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
            >
              {mentionMatches.map((candidate, i) => (
                <button
                  key={candidate.id ?? candidate.username}
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseEnter={() => setMentionIndex(i)}
                  // onMouseDown (não onClick) + preventDefault: impede o
                  // input de perder foco ANTES do clique ser processado -
                  // sem isso o input dispararia onBlur (fechando a lista)
                  // um instante antes do clique registrar.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(candidate.username);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    i === mentionIndex
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                      : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  <Avatar avatarPath={candidate.avatarPath} username={candidate.username} size="xs" />
                  <span className="truncate">{candidate.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
        >
          Enviar
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
});

export default MessageInput;
