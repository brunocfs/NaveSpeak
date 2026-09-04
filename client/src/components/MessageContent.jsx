import { Paperclip } from "lucide-react";
import { API_URL } from "../api/config.js";
import { renderMessageTokens } from "../utils/messageFormatting.jsx";

// URL de imagem "solta" no texto (sem attachment) - regra: termina numa
// extensão de imagem conhecida, com querystring opcional (ex.: CDN com
// ?w=800). YouTube: extrai o ID pra montar a URL previsível de thumbnail
// (img.youtube.com) - sem chamada de rede nenhuma, sem embed/iframe.
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i;
const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/;

function extractImageUrl(text) {
  const urls = text.match(/https?:\/\/[^\s<]+/g);
  if (!urls) return null;
  return urls.find((url) => IMAGE_URL_RE.test(url)) ?? null;
}

function extractYoutubeId(text) {
  return YOUTUBE_RE.exec(text)?.[1] ?? null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes ?? 0} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

// Mesmo padrão de avatarSrc em Avatar.jsx - caminho relativo gravado no
// banco (message_attachments.path) vira URL absoluta contra o /uploads
// estático (server/src/index.js).
function attachmentSrc(relativePath) {
  return `${API_URL}/uploads/${relativePath}`;
}

// Renderiza **negrito**, *itálico*, ~~riscado~~, `código`, URL clicável e
// @username em destaque (só quando bate com alguém de verdade -
// mentionableUsernames: membros do servidor no chat de canal, os dois lados
// da conversa na DM) - regra compartilhada com o preview "ao vivo" do
// composer em utils/messageFormatting.jsx, pra nunca divergir entre o que o
// usuário vê digitando e o que é renderizado na mensagem enviada. React
// escapa tudo automaticamente (sem dangerouslySetInnerHTML), então nada aqui
// vira HTML/script executável.
function MessageText({ text, mentionableUsernames }) {
  return renderMessageTokens(text, mentionableUsernames);
}

function AttachmentItem({ attachment }) {
  const src = attachmentSrc(attachment.path);

  if (attachment.mime.startsWith("image/")) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img
          src={src}
          alt={attachment.name}
          className="max-h-60 rounded-lg border border-slate-200 object-contain dark:border-slate-700"
        />
      </a>
    );
  }
  if (attachment.mime.startsWith("video/")) {
    return (
      <video
        src={src}
        controls
        className="max-h-60 rounded-lg border border-slate-200 dark:border-slate-700"
      />
    );
  }
  if (attachment.mime.startsWith("audio/")) {
    return <audio src={src} controls className="w-full max-w-xs" />;
  }
  return (
    <a
      href={src}
      download={attachment.name}
      className="inline-flex max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <Paperclip className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{attachment.name}</span>
      <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
        {formatBytes(attachment.size)}
      </span>
    </a>
  );
}

// Corpo de uma mensagem (texto + preview de link + anexos) - compartilhado
// por ChatPanel.jsx (canal) e DmPanel.jsx (privado), pra nunca divergir a
// regra de renderização entre os dois chats. `mentionableUsernames`: lista
// de quem pode ser @mencionado nesta conversa (membros do servidor no chat
// de canal; os dois lados da conversa na DM) - ver MessageText acima.
export default function MessageContent({ content, attachments = [], mentionableUsernames = [] }) {
  const trimmed = content?.trim() ?? "";
  const imageUrl = trimmed ? extractImageUrl(trimmed) : null;
  const youtubeId = !imageUrl && trimmed ? extractYoutubeId(trimmed) : null;
  const mentionableSet = new Set(mentionableUsernames.map((u) => u.toLowerCase()));

  return (
    <div className="space-y-2">
      {trimmed && (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
          <MessageText text={trimmed} mentionableUsernames={mentionableSet} />
        </p>
      )}

      {imageUrl && (
        <a href={imageUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="max-h-60 rounded-lg border border-slate-200 object-contain dark:border-slate-700"
          />
        </a>
      )}

      {youtubeId && (
        <a
          href={`https://www.youtube.com/watch?v=${youtubeId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block"
        >
          <img
            src={`https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`}
            alt="Miniatura do vídeo"
            loading="lazy"
            className="max-h-60 rounded-lg border border-slate-200 dark:border-slate-700"
          />
        </a>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentItem key={attachment.path} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}
