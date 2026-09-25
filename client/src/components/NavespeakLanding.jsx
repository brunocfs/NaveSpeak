import { NavespeakRocketV1 } from "./NavespeakLogoV1.jsx";

// Animação de voo (não é hover - roda uma vez ao montar, 9s): o foguete da
// logo V1 decola da plataforma (poeira, sobe reto, inclina e sai pelo canto de
// cima à direita), some um tempo e volta de ré pelo mesmo canto, com a chama
// freando, se endireita e pousa; poeira sai pros lados e a chama apaga. Pra
// repetir, remonte o componente (ex.: trocar a `key`).
//
// A inclinação do foguete e o skew das letras (nvsl-skew) usam os mesmos
// passos/tempo em index.css, então N e S ficam em pé na tela o tempo todo
// enquanto o foguete gira de 35deg pra 0.
export default function NavespeakLanding({ className = "h-64 w-64", title = "NaveSpeak decolando e pousando" }) {
  return (
    <svg viewBox="0 0 200 200" className={`nvsl-scene overflow-hidden ${className}`} role="img" aria-label={title}>
      <g fill="currentColor" opacity="0.5">
        <circle cx="28" cy="30" r="1.2" />
        <circle cx="70" cy="14" r="0.8" />
        <circle cx="160" cy="46" r="1" />
        <circle cx="120" cy="78" r="0.7" />
        <circle cx="36" cy="104" r="0.8" />
        <circle cx="178" cy="120" r="1.2" />
      </g>

      <ellipse className="nvsl-glow" cx="100" cy="176" rx="34" ry="5" fill="#a855f7" />

      <g className="nvsl-rocket">
        <g transform="scale(0.7) translate(-50 -100)">
          <NavespeakRocketV1 skewClassName="nvsl-skew" />
        </g>
      </g>

      <g fill="currentColor" opacity="0.3">
        <ellipse className="nvsl-dust nvsl-dust-left" cx="92" cy="173" rx="8" ry="3.5" />
        <ellipse className="nvsl-dust nvsl-dust-right" cx="108" cy="173" rx="8" ry="3.5" />
      </g>

      <g fill="currentColor">
        <rect x="58" y="176" width="84" height="6" rx="3" />
        <path d="M70 182h10l-3 14h-4zM120 182h10l-3 14h-4z" />
        <rect x="40" y="196" width="120" height="2" rx="1" opacity="0.4" />
      </g>
      <g fill="#a855f7">
        <circle className="nvsl-light" cx="63" cy="179" r="1.6" />
        <circle className="nvsl-light nvsl-light-2" cx="137" cy="179" r="1.6" />
      </g>
    </svg>
  );
}
