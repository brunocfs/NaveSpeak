import { useId } from "react";

// Logo nova V2 (em validação) - mesma base da V1 (NavespeakLogoV1.jsx) com
// N e S num desenho próprio: S angular de cantos chanfrados, N com terminais
// chanfrados.
// SVG inline em vez de <img> pra o hover animar as partes internas (foguete
// gira, chama acelera - keyframes `nvs-*` em index.css). Corpo usa
// currentColor, então segue o tema pela cor do texto do pai: um único
// componente serve claro e escuro.
//
// Como na logo original, o corpo do foguete É formado por três peças: ponta
// (com a janela) e N+S - a perna direita do N desce e emenda na barra de
// cima do S (ligadura), então as duas letras formam praticamente uma peça. Tudo é desenhado com o
// foguete em pé e depois inclinado 35deg; as peças ficam num grupo com
// skewY(-35deg), que desfaz a inclinação só na horizontal - barras do S e
// cortes entre as peças saem retos na tela, pernas do N seguem o eixo do
// foguete. A silhueta do corpo (mask) recorta as letras no contorno.
export default function NavespeakLogoV2({ className = "h-10 w-10", title = "NaveSpeak" }) {
  // ids únicos por instância - mais de um logo na mesma página não pode
  // compartilhar gradiente/mask.
  const id = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 100 100"
      className={`nvs-logo overflow-visible ${className}`}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={`${id}-flame`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c084fc" />
          <stop offset="0.6" stopColor="#a855f7" />
          <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-core`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#faf5ff" />
          <stop offset="1" stopColor="#e879f9" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-body`} maskUnits="userSpaceOnUse" x="-50" y="-50" width="200" height="200">
          <path
            fill="#fff"
            d="M50 0C62 11 65 26 65 42v62a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4V42C35 26 38 11 50 0z"
          />
          <circle cx="50" cy="17" r="5.5" fill="#000" />
        </mask>
      </defs>

      <g className="nvs-logo-rocket">
        <g transform="rotate(35 50 50) translate(50 50) scale(0.75) translate(-50 -61)">
          {/* Mesmo skew das letras: topo da chama fica paralelo à base do S. */}
          <g transform="translate(50 0) skewY(-35) translate(-50 0)">
            <g className="nvs-logo-flame">
              <path d="M40 102.5c0 9 4 15 8 21 4-6 8-12 8-21z" fill={`url(#${id}-flame)`} />
              <path className="nvs-logo-core" d="M44 102.5c0 6 2 10 4 14 2-4 4-8 4-14z" fill={`url(#${id}-core)`} />
            </g>
          </g>

          <g fill="currentColor">
            <g mask={`url(#${id}-body)`}>
              <g transform="translate(50 0) skewY(-35) translate(-50 0)">
                <rect x="0" y="-40" width="100" height="70" />
                <path d="M20 62V33.5h23.5l13 15.5V33.5H59l21 21v11H56.5V62l-13-15.5V56l-6 6z" />
                <path
                  d="M80 69.5H45l-5 5v3.25l5 5h10l5 5v3.25l-5 5H20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                />
              </g>
            </g>
            <circle cx="50" cy="17" r="2.4" fill="#a855f7" />
            <path d="M33 64c-10 4-15 18-14 34l14-9z" />
            <path d="M67 64c10 4 15 18 14 34l-14-9z" />
          </g>
        </g>
      </g>
    </svg>
  );
}
