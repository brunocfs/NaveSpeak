import { useId } from "react";

// Logo nova V3 (em validação) - conceito próprio, não derivado da V1/V2:
// planeta que também é balão de fala (cauda embaixo à direita) com ondas de
// voz dentro, anel orbital (o "servidor" onde a galera se encontra) e um
// foguete em órbita anti-horária (em repouso sobe pela frente do anel). Anel,
// foguete e estrelas usam currentColor (seguem o tema); planeta e chama são
// roxos fixos.
//
// No hover o foguete percorre a órbita passando POR TRÁS do planeta: ele é
// desenhado duas vezes, uma antes do planeta recortada na metade de trás do
// anel e outra depois, recortada na metade da frente. Regras fixas em
// index.css (`nvs3-*`); só os keyframes da órbita são gerados aqui (abaixo).

const RX = 44;
const RY = 14;
const K = RY / RX;
const START = 35; // posição de repouso no anel (graus)
const STEP = 15;

// Foguete anda numa elipse sem deformar: o grupo de fora achata a rotação
// (scaleY(K)) e o de dentro desfaz o achatamento e aponta o bico na tangente,
// que não é linear no ângulo - por isso keyframe a cada STEP graus.
function orbitKeyframes() {
  const orbit = [];
  const counter = [];
  let prev = null;
  for (let i = 0; i <= 360; i += STEP) {
    const t = START - i;
    const r = (t * Math.PI) / 180;
    let tangent =
      (Math.atan2(-RY * Math.cos(r), RX * Math.sin(r)) * 180) / Math.PI;
    while (prev !== null && tangent - prev > 180) tangent -= 360;
    while (prev !== null && tangent - prev < -180) tangent += 360;
    prev = tangent;
    const pct = `${((i / 360) * 100).toFixed(3)}%`;
    orbit.push(`${pct}{transform:rotate(${t}deg)}`);
    counter.push(
      `${pct}{transform:rotate(${-t}deg) scale(1,${1 / K}) rotate(${tangent}deg)}`,
    );
  }
  return {
    css: `@keyframes nvs3-orbit{${orbit.join("")}}@keyframes nvs3-counter{${counter.join("")}}`,
    restOrbit: orbit[0].match(/transform:([^}]+)/)[1],
    restCounter: counter[0].match(/transform:([^}]+)/)[1],
  };
}

const KF = orbitKeyframes();

function Rocket({ flameId }) {
  return (
    <g className="nvs3-orbit" style={{ transform: KF.restOrbit }}>
      <g transform={`translate(${RX} 0)`}>
        <g className="nvs3-counter" style={{ transform: KF.restCounter }}>
          <g transform="scale(1.3)">
            <path
              className="nvs3-flame"
              d="M-5 -1.7 L-11 0 L-5 1.7z"
              fill={`url(#${flameId})`}
            />
            <path
              d="M-3 -2.6 L-7 -5.6 L-5.4 -1.4z M-3 2.6 L-7 5.6 L-5.4 1.4z"
              fill="currentColor"
            />
            <path
              d="M7 0C4 -3.3 -2 -3.4 -5.2 -2.6V2.6C-2 3.4 4 3.3 7 0z"
              fill="currentColor"
            />
            <circle cx="1.8" cy="0" r="1.1" fill="#a855f7" />
          </g>
        </g>
      </g>
    </g>
  );
}

export default function NavespeakLogoV3({
  className = "h-10 w-10",
  title = "NaveSpeak",
}) {
  return (
    <OrbitLogo
      className={className}
      title={title}
      center={(id) => (
        <>
          <defs>
            <radialGradient id={`${id}-planet`} cx="0.35" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#d8b4fe" />
              <stop offset="0.45" stopColor="#a855f7" />
              <stop offset="1" stopColor="#5b21b6" />
            </radialGradient>
          </defs>
          <path
            d="M50 24a26 26 0 1 0 12.4 48.9L79 81l-7.2-16.8A26 26 0 0 0 50 24z"
            fill={`url(#${id}-planet)`}
          />
          <g fill="#fff">
            <rect className="nvs3-bar" x="36.6" y="46" width="3.6" height="8" rx="1.8" />
            <rect className="nvs3-bar nvs3-bar-2" x="42.8" y="43" width="3.6" height="14" rx="1.8" />
            <rect className="nvs3-bar nvs3-bar-3" x="48.2" y="39" width="3.6" height="22" rx="1.8" />
            <rect className="nvs3-bar nvs3-bar-2" x="53.6" y="43" width="3.6" height="14" rx="1.8" />
            <rect className="nvs3-bar" x="59.8" y="46" width="3.6" height="8" rx="1.8" />
          </g>
        </>
      )}
    />
  );
}

// Cena orbital compartilhada (V3 e V6): estrelas de fundo, anel e foguete em
// órbita, com o corpo central trocável. `center(id)` desenha o corpo entre a
// metade de trás e a da frente do anel (recebe um id único pra gradientes).
// `logoClassName` soma classes ao <svg> (hover próprio do corpo central).
export function OrbitLogo({ className, title, logoClassName = "", center }) {
  // ids únicos por instância - mais de um logo na mesma página não pode
  // compartilhar gradiente/clip.
  const id = useId().replace(/:/g, "");
  const orbitFrame = "translate(50 50) rotate(-20)";

  return (
    <svg
      viewBox="0 0 100 100"
      className={`nvs3-logo ${logoClassName} overflow-visible ${className}`}
      role="img"
      aria-label={title}
    >
      <style>{KF.css}</style>
      <defs>
        <linearGradient id={`${id}-flame`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#f5d0fe" />
          <stop offset="1" stopColor="#a855f7" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-back`}>
          <rect x="-60" y="-40" width="120" height="40" />
        </clipPath>
        <clipPath id={`${id}-front`}>
          <rect x="-60" y="0" width="120" height="40" />
        </clipPath>
      </defs>

      <g fill="currentColor">
        <path
          className="nvs3-star"
          d="M16 12l1.4 4.1 4.1 1.4-4.1 1.4L16 23l-1.4-4.1-4.1-1.4 4.1-1.4z"
        />
        <path
          className="nvs3-star nvs3-star-2"
          d="M86 8l1 2.8 2.8 1-2.8 1L86 15.6l-1-2.8-2.8-1 2.8-1z"
        />
        <circle className="nvs3-star nvs3-star-3" cx="10" cy="40" r="1.4" />
        <circle className="nvs3-star nvs3-star-2" cx="92" cy="88" r="1.2" />
      </g>

      {/* metade de trás do anel + foguete quando passa por trás */}
      <g transform={orbitFrame}>
        <path
          d={`M${-RX} 0A${RX} ${RY} 0 0 1 ${RX} 0`}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.55"
        />
        <g clipPath={`url(#${id}-back)`}>
          <g transform={`scale(1 ${K})`}>
            <Rocket flameId={`${id}-flame`} />
          </g>
        </g>
      </g>

      {center(id)}

      {/* metade da frente do anel + foguete quando passa pela frente */}
      <g transform={orbitFrame}>
        <path
          d={`M${RX} 0A${RX} ${RY} 0 0 1 ${-RX} 0`}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <g clipPath={`url(#${id}-front)`}>
          <g transform={`scale(1 ${K})`}>
            <Rocket flameId={`${id}-flame`} />
          </g>
        </g>
      </g>
    </svg>
  );
}
