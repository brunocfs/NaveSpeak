// Feedback de "fulano está digitando", em chat de servidor e DM. Recebe a
// lista de quem está digitando AGORA (já filtrada/deduplicada por quem
// escuta os eventos chat:typing/dm:typing - ver ChatPanel.jsx/DmPanel.jsx) e
// só decide o texto e a animação dos pontinhos.
export default function TypingIndicator({ usernames = [] }) {
  if (usernames.length === 0) return null;

  let text;
  if (usernames.length === 1) {
    text = `${usernames[0]} está digitando`;
  } else if (usernames.length === 2) {
    text = `${usernames[0]} e ${usernames[1]} estão digitando`;
  } else if (usernames.length === 3) {
    text = `${usernames[0]}, ${usernames[1]} e ${usernames[2]} estão digitando`;
  } else {
    text = `${usernames.length} pessoas estão digitando`;
  }

  return (
    <div className="flex h-5 items-center gap-1.5 px-4 text-xs text-slate-500 sm:px-5 dark:text-slate-400">
      <span className="flex shrink-0 items-end gap-0.5">
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1 animate-bounce rounded-full bg-current" />
      </span>
      <span className="truncate italic">{text}</span>
    </div>
  );
}
