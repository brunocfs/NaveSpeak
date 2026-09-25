import { Rocket } from "lucide-react";

// Foguete ao lado do nome de quem tem NaveSpeak TURBO ativo. `isTurbo` vem
// sempre do servidor (expiração já calculada lá).
export default function TurboBadge({ className = "size-3.5" }) {
  return (
    <span role="img" aria-label="NaveSpeak TURBO" title="NaveSpeak TURBO" className="inline-flex shrink-0">
      <Rocket
        aria-hidden="true"
        className={`${className} text-fuchsia-500 drop-shadow-[0_0_3px_rgba(217,70,239,0.6)] dark:text-fuchsia-300`}
      />
    </span>
  );
}
