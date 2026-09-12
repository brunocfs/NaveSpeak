// Fontes já carregadas via <link> em index.html (Space Grotesk/JetBrains
// Mono, ver --font-display/--font-signal em styles/index.css) - reaproveita
// em vez de baixar fonte nova só pra isto. "serif" usa o font-serif nativo
// do Tailwind (pilha genérica do sistema, nenhum carregamento extra).
const FONT_CLASS = {
  serif: "font-serif",
  mono: "font-[family-name:var(--font-signal)]",
  display: "font-[family-name:var(--font-display)]",
};

// Efeitos animados = classes CSS simples (ver @keyframes em styles/index.css),
// nada de biblioteca de animação pra isto.
const EFFECT_CLASS = {
  shine: "styled-name-shine",
  pulse: "styled-name-pulse",
};

// Renderiza um nome de usuário com a personalização de client/name_style
// (cor sólida OU gradiente, negrito/itálico/sublinhado, fonte, efeito) - ver
// nameStyleSchema no servidor, que é quem valida a forma deste objeto antes
// de chegar aqui. `style` ausente/vazio = nome sem nenhuma personalização,
// mesmo comportamento de sempre.
export default function StyledUsername({ username, style, className = "" }) {
  if (!style || Object.keys(style).length === 0) {
    return <span className={className}>{username}</span>;
  }

  const classes = [className];
  if (style.bold) classes.push("font-bold");
  if (style.italic) classes.push("italic");
  if (style.underline) classes.push("underline");
  if (style.font && FONT_CLASS[style.font]) classes.push(FONT_CLASS[style.font]);
  if (style.effect && EFFECT_CLASS[style.effect]) classes.push(EFFECT_CLASS[style.effect]);

  // Gradiente tem prioridade sobre cor sólida (os dois nunca fazem sentido
  // juntos) - "recorta" o texto do gradiente de fundo via background-clip,
  // técnica padrão de texto em gradiente em CSS puro.
  const inlineStyle = {};
  if (style.gradient?.length === 2) {
    inlineStyle.backgroundImage = `linear-gradient(90deg, ${style.gradient[0]}, ${style.gradient[1]})`;
    inlineStyle.WebkitBackgroundClip = "text";
    inlineStyle.backgroundClip = "text";
    inlineStyle.color = "transparent";
  } else if (style.color) {
    inlineStyle.color = style.color;
  }

  return (
    <span className={classes.join(" ")} style={inlineStyle}>
      {username}
    </span>
  );
}
