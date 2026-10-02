import { useEffect, useState } from "react";
import { randomGlyph } from "../utils/cipher.js";

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
  cipher: "styled-name-cipher",
};

// Efeito "cipher": nome se descriptografa letra a letra, fica legível, volta
// a se criptografar e repete - mesmos glifos do botão "Transmissão
// criptografada" (utils/cipher.js). Um tick = 110ms (mesmo ritmo do botão);
// cada letra leva 2 ticks.
const CIPHER_TICK_MS = 90;
const CIPHER_HOLD_CLEAR = 30; // ~2.4s legível
const CIPHER_HOLD_SCRAMBLED = 10; // ~0.5s embaralhado

function cipherFrame(username, tick) {
  const n = username.length;
  const sweep = n * 2;
  const t = tick % (sweep * 2 + CIPHER_HOLD_CLEAR + CIPHER_HOLD_SCRAMBLED);
  let revealed;
  if (t < sweep) revealed = Math.floor(t / 2);
  else if (t < sweep + CIPHER_HOLD_CLEAR) return username;
  else if (t < sweep * 2 + CIPHER_HOLD_CLEAR)
    revealed = n - Math.floor((t - sweep - CIPHER_HOLD_CLEAR) / 2);
  else revealed = 0;
  return Array.from(username, (ch, i) =>
    i < revealed || ch === " " ? ch : randomGlyph(),
  ).join("");
}

// ponytail: um setInterval por instância; se o chat com muitas mensagens do
// mesmo usuário pesar, trocar por um único ticker compartilhado.
function CipherName({ username }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setTick((t) => t + 1), CIPHER_TICK_MS);
    return () => clearInterval(id);
  }, []);
  // aria-label mantém o nome real pra leitor de tela (não lê os glifos).
  return tick === 0 ? (
    username
  ) : (
    <span aria-label={username}>{cipherFrame(username, tick)}</span>
  );
}

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
  // "cipher" força mono (como o botão) - glifos trocando em fonte
  // proporcional fariam a largura do nome tremer.
  if (style.effect === "cipher") classes.push(FONT_CLASS.mono);
  else if (style.font && FONT_CLASS[style.font])
    classes.push(FONT_CLASS[style.font]);
  if (style.effect && EFFECT_CLASS[style.effect])
    classes.push(EFFECT_CLASS[style.effect]);

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
      {style.effect === "cipher" && username ? (
        <CipherName username={username} />
      ) : (
        username
      )}
    </span>
  );
}
