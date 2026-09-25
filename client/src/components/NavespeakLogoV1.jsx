import { useId } from "react";

// Logo definitiva (V1) - usada nas páginas no lugar de src/assets/nvspk*.svg
// (que seguem só como base dos favicons). Variações em NavespeakLogoV2..V5.jsx.
// SVG inline em vez de <img> pra o hover animar as partes internas (foguete
// gira, chama acelera - keyframes `nvs-*` em index.css). Corpo usa
// currentColor, então segue o tema pela cor do texto do pai: um único
// componente serve claro e escuro.
export default function NavespeakLogoV1({ className = "h-10 w-10", title = "NaveSpeak" }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`nvs-logo overflow-visible ${className}`}
      role="img"
      aria-label={title}
    >
      <g className="nvs-logo-rocket">
        <g transform="rotate(35 50 50) translate(50 50) scale(0.75) translate(-50 -61)">
          <NavespeakRocketV1 />
        </g>
      </g>
    </svg>
  );
}

// Desenho do foguete da V1, compartilhado com NavespeakLanding.jsx.
//
// Como na logo original, o corpo do foguete É formado por três peças: ponta
// (com a janela) e N+S - a perna direita do N desce e emenda na barra de
// cima do S (ligadura), então as duas letras formam praticamente uma peça.
// Desenhado em pé (bico em y=0, base do S em y=100, chama até ~124, eixo em
// x=50); quem usa inclina. As peças e a chama ficam em grupos com
// skewY(-35deg), que desfaz a inclinação de 35deg da logo só na horizontal -
// barras do S e cortes entre as peças saem retos na tela, pernas do N seguem
// o eixo do foguete. `skewClassName` deixa o chamador trocar esse skew via
// CSS (o transform do CSS substitui o atributo) quando a inclinação muda.
// A silhueta do corpo (mask) recorta as letras no contorno.
export function NavespeakRocketV1({ skewClassName }) {
  // ids únicos por instância - mais de um foguete na mesma página não pode
  // compartilhar gradiente/mask.
  const id = useId().replace(/:/g, "");
  const skew = "translate(50 0) skewY(-35) translate(-50 0)";

  return (
    <>
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

      {/* Mesmo skew das letras: topo da chama fica paralelo à base do S. */}
      <g className={skewClassName} transform={skew}>
        <g className="nvs-logo-flame">
          <path d="M40 102.5c0 9 4 15 8 21 4-6 8-12 8-21z" fill={`url(#${id}-flame)`} />
          <path className="nvs-logo-core" d="M44 102.5c0 6 2 10 4 14 2-4 4-8 4-14z" fill={`url(#${id}-core)`} />
        </g>
      </g>

      <g fill="currentColor">
        <g mask={`url(#${id}-body)`}>
          <g className={skewClassName} transform={skew}>
            <rect x="0" y="-40" width="100" height="70" />
            <path d="M20 62V33.5h23.5l13 15.5V33.5H80v32H56.5V62l-13-15.5V62z" />
            <path
              d="M80 69.5H47.4a6.625 6.625 0 0 0 0 13.25h5.2a6.625 6.625 0 0 1 0 13.25H20"
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
    </>
  );
}
