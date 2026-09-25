import { OrbitLogo } from "./NavespeakLogoV3.jsx";

// Logo nova V6 (em validação) - variação da V3: mesmo anel e foguete em órbita
// (cena compartilhada `OrbitLogo`), com uma estrela "de verdade" (um sol) no
// lugar do balão com voz: esfera de plasma com núcleo quase branco e borda
// mais escura (limb darkening), granulação da superfície e coroa de borda
// irregular (feTurbulence). Roxo pra ficar na paleta do app. Hover:
// órbita/estrelas de fundo como na V3 (`nvs3-*`) + coroa gira e tremula, sol
// pulsa, brilho respira (`nvs6-*` em index.css).
export default function NavespeakLogoV6({ className = "h-10 w-10", title = "NaveSpeak" }) {
  return (
    <OrbitLogo
      className={className}
      title={title}
      logoClassName="nvs6-logo"
      center={(id) => (
        <>
          <defs>
            <radialGradient id={`${id}-sun`} cx="0.42" cy="0.4" r="0.62">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.22" stopColor="#f5d0fe" />
              <stop offset="0.55" stopColor="#c084fc" />
              <stop offset="0.88" stopColor="#9333ea" />
              <stop offset="1" stopColor="#6b21a8" />
            </radialGradient>
            {/* coroa: disco borrado e deformado por ruído - borda de chama */}
            <filter id={`${id}-corona`} x="-60%" y="-60%" width="220%" height="220%">
              <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" />
              <feDisplacementMap in="SourceGraphic" scale="9" />
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
            <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            {/* granulação: ruído em manchas escuras, só dentro da esfera */}
            <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="3" />
              <feColorMatrix
                values="0 0 0 0 0.35  0 0 0 0 0.08  0 0 0 0 0.55  0 0 0 -2.2 1.25"
              />
            </filter>
            <clipPath id={`${id}-disc`}>
              <circle cx="50" cy="50" r="20" />
            </clipPath>
          </defs>

          <circle
            className="nvs6-glow"
            cx="50"
            cy="50"
            r="26"
            fill="#a855f7"
            opacity="0.45"
            filter={`url(#${id}-glow)`}
          />
          <circle
            className="nvs6-corona"
            cx="50"
            cy="50"
            r="23.5"
            fill="#c084fc"
            opacity="0.75"
            filter={`url(#${id}-corona)`}
          />

          <g className="nvs6-sun">
            <circle cx="50" cy="50" r="20" fill={`url(#${id}-sun)`} />
            <rect
              x="30"
              y="30"
              width="40"
              height="40"
              clipPath={`url(#${id}-disc)`}
              filter={`url(#${id}-grain)`}
              opacity="0.22"
            />
          </g>
        </>
      )}
    />
  );
}
