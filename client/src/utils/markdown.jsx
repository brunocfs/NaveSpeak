// Parser de Markdown mínimo, só para o subconjunto usado nas notas de versão
// (WelcomeModal.jsx): headings (#/##/###), listas "- item", **negrito**,
// *itálico*, links [texto](url) e parágrafos. Não é uma lib de propósito
// geral - existe pra não precisar puxar uma dependência externa só pra
// renderizar um arquivo .md estático e confiável (autoria nossa, nunca vindo
// de usuário). Produz elementos React diretamente (nunca
// dangerouslySetInnerHTML), então não há superfície de XSS mesmo que o
// conteúdo mude no futuro.

// Trecho inline (dentro de uma linha) -> array de nodes React. Suporta
// **negrito**, *itálico* e [texto](url), sem aninhamento entre eles (não é
// necessário para notas de versão).
function parseInline(text) {
  const nodes = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((.+?)\)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = re.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={key++}>{match[2]}</em>);
    } else if (match[3] !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {match[3]}
        </a>,
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const HEADING_CLASSES = {
  1: "text-xl font-bold text-slate-900 dark:text-white mt-5 first:mt-0 mb-2",
  2: "text-lg font-semibold text-slate-900 dark:text-white mt-4 first:mt-0 mb-2",
  3: "text-base font-semibold text-slate-900 dark:text-white mt-3 first:mt-0 mb-1",
};

// Markdown completo -> array de elementos React (blocos: heading, lista,
// parágrafo). Linhas em branco separam blocos.
export function renderMarkdown(markdown) {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={blocks.length} className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {parseInline(paragraph.join(" "))}
      </p>,
    );
    paragraph = [];
  }
  function flushList() {
    if (list.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
        {list.map((item, i) => (
          <li key={i}>{parseInline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const listItem = /^[-*]\s+(.*)$/.exec(line);

    if (line === "") {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={blocks.length} className={HEADING_CLASSES[level]}>
          {parseInline(heading[2])}
        </Tag>,
      );
    } else if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
