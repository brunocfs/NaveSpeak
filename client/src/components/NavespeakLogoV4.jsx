import { useId } from "react";

// Logo nova V4 "Eclipse" (em validação) - uma lua em forma de balão de fala
// (cauda embaixo à esquerda, crateras discretas) passando na frente de um sol
// roxo: sobra o crescente de luz com coroa suave e o "anel de diamante" na
// borda. Referência ao anel de "falando" dos avatares em chat de voz - aqui o
// anel é a coroa do eclipse.
// Lua usa currentColor (segue o tema); luz é roxa fixa. Hover em index.css
// (`nvs4-*`): lua desliza e revela mais luz, anéis de voz se expandem e o
// brilho cintila.
export default function NavespeakLogoV4({ className = "h-10 w-10", title = "NaveSpeak" }) {
  // ids únicos por instância - mais de um logo na mesma página não pode
  // compartilhar gradiente/filtro/mask.
  const id = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 100 100"
      className={`nvs4-logo overflow-visible ${className}`}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={`${id}-sun`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="0.35" stopColor="#a855f7" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
        <filter id={`${id}-corona`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        {/* crateras: semitransparentes (cinza na mask), mostram um pouco do
            fundo - funcionam na lua escura (tema claro) e na clara (escuro) */}
        <mask id={`${id}-craters`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <g fill="#c4c4c4">
            <circle cx="39" cy="41" r="5.5" />
            <circle cx="57" cy="62" r="3.2" />
          </g>
        </mask>
      </defs>

      <g fill="none" stroke="#a855f7" strokeWidth="1.5">
        <circle className="nvs4-ring" cx="56" cy="44" r="30" />
        <circle className="nvs4-ring nvs4-ring-2" cx="56" cy="44" r="30" />
      </g>

      <circle
        cx="56"
        cy="44"
        r="31"
        fill="#a855f7"
        opacity="0.45"
        filter={`url(#${id}-corona)`}
      />
      <circle cx="56" cy="44" r="30" fill={`url(#${id}-sun)`} />

      <path
        className="nvs4-moon"
        fill="currentColor"
        mask={`url(#${id}-craters)`}
        d="M50 20a30 30 0 1 1-17.3 54.5L17 83l7.6-17.1A30 30 0 0 1 50 20z"
      />

      <g className="nvs4-glint" fill="#faf5ff">
        <path d="M77.2 15.8l1.5 5.5 5.5 1.5-5.5 1.5-1.5 5.5-1.5-5.5-5.5-1.5 5.5-1.5z" />
        <circle cx="77.2" cy="22.8" r="2" />
      </g>
    </svg>
  );
}
