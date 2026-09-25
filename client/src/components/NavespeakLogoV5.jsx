import { useId } from "react";

// Logo nova V5 "Nave" (em validação) - nave vista de cima, traço mínimo:
// fuselagem esguia e duas asas em lâmina separadas por frestas (em
// currentColor, segue o tema), cabine roxa e três rastros de propulsão com
// comprimentos diferentes, que também lembram barras de áudio (voz).
// Desenhada apontando pra cima e inclinada 45deg. Hover em index.css (`nvs5-*`): nave avança e
// trepida, rastros viram equalizador.
export default function NavespeakLogoV5({ className = "h-10 w-10", title = "NaveSpeak" }) {
  // ids únicos por instância - mais de um logo na mesma página não pode
  // compartilhar gradiente.
  const id = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 100 100"
      className={`nvs5-logo overflow-visible ${className}`}
      role="img"
      aria-label={title}
    >
      <defs>
        {/* userSpaceOnUse: rastro é linha reta (caixa de largura zero), com
            objectBoundingBox o degradê não renderiza */}
        <linearGradient id={`${id}-trail`} gradientUnits="userSpaceOnUse" x1="0" y1="74" x2="0" y2="98">
          <stop offset="0" stopColor="#c084fc" />
          <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g transform="rotate(45 50 50) translate(0 -2)">
        <g className="nvs5-ship">
          <g fill="none" stroke={`url(#${id}-trail)`} strokeWidth="3.2" strokeLinecap="round">
            <path className="nvs5-trail" d="M44.5 78V86" />
            <path className="nvs5-trail nvs5-trail-2" d="M50 78V96" />
            <path className="nvs5-trail nvs5-trail-3" d="M55.5 78V90" />
          </g>

          <g fill="currentColor">
            <path d="M50 6c6 10 8 28 8 46v18a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V52c0-18 2-36 8-46z" />
            <path d="M39 38v34l-19 10c4-16 10-32 19-44z" />
            <path d="M61 38v34l19 10c-4-16-10-32-19-44z" />
          </g>
          <path fill="#a855f7" d="M50 18c2.6 4 4 9 4 14l-4-2-4 2c0-5 1.4-10 4-14z" />
        </g>
      </g>
    </svg>
  );
}
