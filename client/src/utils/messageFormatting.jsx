// Gramática de formatação inline usada em TODA mensagem de chat (canal e DM) - um
// único regex/parser consumido nos dois pontos que precisam entender o mesmo texto:
// o preview "ao vivo" enquanto o usuário digita (MessageInput.jsx, marcador visível
// e apagado) e a renderização final da mensagem enviada (MessageContent.jsx,
// marcador removido). Existir num módulo só evita que as duas leituras divirjam -
// é o mesmo motivo que já levava @menção/link a viverem num regex único antes desta
// mudança (ver comentário histórico em MessageContent.jsx).
//
// Precedência (maior primeiro): `código` > **negrito** > ~~riscado~~ > *itálico* >
// @menção > URL crua. Sem aninhamento entre eles (mesmo nível de ambição do
// utils/markdown.jsx das patch notes) e só inline - chat não tem heading/lista/bloco.
const TOKEN_RE =
  /(`[^`\n]+?`)|(\*\*[^*\n]+?\*\*)|(~~[^~\n]+?~~)|(\*[^*\n]+?\*)|(@[A-Za-z0-9_]{3,32})|(https?:\/\/[^\s<]+)/g;

// Quebra `text` em tokens { type, raw, inner } - `raw` é o trecho original completo
// (com marcador, se houver), `inner` é o conteúdo sem marcador (só em spans com
// marcador; menção/link/texto puro usam o próprio `raw`).
function tokenize(text) {
  const tokens = [];
  let lastIndex = 0;
  let match;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(text))) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", raw: text.slice(lastIndex, match.index) });
    }
    const [raw, code, bold, strike, italic, mention, url] = match;
    if (code !== undefined) {
      tokens.push({ type: "code", raw, inner: raw.slice(1, -1) });
    } else if (bold !== undefined) {
      tokens.push({ type: "bold", raw, inner: raw.slice(2, -2) });
    } else if (strike !== undefined) {
      tokens.push({ type: "strike", raw, inner: raw.slice(2, -2) });
    } else if (italic !== undefined) {
      tokens.push({ type: "italic", raw, inner: raw.slice(1, -1) });
    } else if (mention !== undefined) {
      tokens.push({ type: "mention", raw });
    } else if (url !== undefined) {
      tokens.push({ type: "url", raw });
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", raw: text.slice(lastIndex) });
  }
  return tokens;
}

const LIVE_MARKER_CLASS = "text-slate-400 dark:text-slate-500";

// Preview "ao vivo" do composer: NUNCA remove caractere - só estiliza. O texto por
// trás (MessageInput.jsx) é um <textarea> transparente sobreposto a esta div; se o
// comprimento renderizado aqui divergisse do valor real do textarea, o caret
// desalinharia visualmente do texto. Marcadores (**, ~~, etc.) ficam visíveis, só
// esmaecidos - o conteúdo entre eles ganha o estilo de verdade.
export function renderLiveTokens(text) {
  return tokenize(text).map((token, i) => {
    switch (token.type) {
      case "code":
        return (
          <span key={i}>
            <span className={LIVE_MARKER_CLASS}>`</span>
            <code className="rounded bg-slate-200/70 px-1 font-mono dark:bg-slate-700/70">
              {token.inner}
            </code>
            <span className={LIVE_MARKER_CLASS}>`</span>
          </span>
        );
      case "bold":
        return (
          <span key={i}>
            <span className={LIVE_MARKER_CLASS}>**</span>
            <strong>{token.inner}</strong>
            <span className={LIVE_MARKER_CLASS}>**</span>
          </span>
        );
      case "strike":
        return (
          <span key={i}>
            <span className={LIVE_MARKER_CLASS}>~~</span>
            <span className="line-through">{token.inner}</span>
            <span className={LIVE_MARKER_CLASS}>~~</span>
          </span>
        );
      case "italic":
        return (
          <span key={i}>
            <span className={LIVE_MARKER_CLASS}>*</span>
            <em>{token.inner}</em>
            <span className={LIVE_MARKER_CLASS}>*</span>
          </span>
        );
      case "mention":
      case "url":
        return (
          <span key={i} className="text-blue-600 dark:text-blue-400">
            {token.raw}
          </span>
        );
      default:
        return <span key={i}>{token.raw}</span>;
    }
  });
}

// Texto final da mensagem já enviada (MessageContent.jsx): marcador removido,
// conteúdo formatado de verdade. `mentionableUsernames` (Set em minúsculas) decide
// se um "@algo" vira destaque de menção ou fica texto puro - mesma regra que já
// existia (só "@algo" que bate com alguém de verdade da conversa é destacado).
export function renderMessageTokens(text, mentionableUsernames) {
  return tokenize(text).map((token, i) => {
    switch (token.type) {
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-700/70"
          >
            {token.inner}
          </code>
        );
      case "bold":
        return <strong key={i}>{token.inner}</strong>;
      case "strike":
        return (
          <span key={i} className="line-through">
            {token.inner}
          </span>
        );
      case "italic":
        return <em key={i}>{token.inner}</em>;
      case "mention": {
        const isMention = mentionableUsernames.has(
          token.raw.slice(1).toLowerCase(),
        );
        return isMention ? (
          <strong
            key={i}
            className="font-semibold text-blue-600 dark:text-blue-400"
          >
            {token.raw}
          </strong>
        ) : (
          token.raw
        );
      }
      case "url":
        return (
          <a
            key={i}
            href={token.raw}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline decoration-slate-400 underline-offset-2 hover:decoration-current"
          >
            {token.raw}
          </a>
        );
      default:
        return token.raw;
    }
  });
}
