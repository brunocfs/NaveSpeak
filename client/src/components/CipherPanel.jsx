import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { randomCipher, randomGlyph } from "../utils/cipher.js";

const MESSAGE = "Zeno está atravessando o universo à procura de uma nova tecnologia INSANA.";
const TICK_MS = 45;

// Teaser do botão-mistério do DmSidebar: "decodifica" a mensagem da esquerda
// pra direita (o que ainda não foi revelado fica em glifos aleatórios).
// Com prefers-reduced-motion mostra o texto pronto, sem animação.
export default function CipherPanel() {
  const [revealed, setRevealed] = useState(() =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? MESSAGE.length : 0,
  );
  const [signal, setSignal] = useState(() => randomCipher(12));

  useEffect(() => {
    if (revealed >= MESSAGE.length) return undefined;
    const id = setTimeout(() => setRevealed((n) => n + 1), TICK_MS);
    return () => clearTimeout(id);
  }, [revealed]);

  useEffect(() => {
    const id = setInterval(() => setSignal(randomCipher(12)), 140);
    return () => clearInterval(id);
  }, []);

  const text =
    MESSAGE.slice(0, revealed) +
    Array.from(MESSAGE.slice(revealed), (ch) => (ch === " " ? " " : randomGlyph())).join("");
  const done = revealed >= MESSAGE.length;

  return (
    <div className="relative h-full overflow-hidden bg-[#05030c] text-slate-100">
      <div className="turbo-page-stars absolute inset-0" aria-hidden="true" />
      <div className="cipher-page-scan absolute inset-x-0 bottom-0 -top-3" aria-hidden="true" />

      <div className="relative mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/10">
          <Lock className="cipher-icon size-8 text-violet-300" />
        </div>

        <p className="mb-4 font-[family-name:var(--font-signal)] text-xs font-semibold uppercase tracking-[0.3em] text-violet-400">
          Transmissão interceptada
        </p>

        {/* aria-live só com o texto final - leitor de tela não lê os glifos. */}
        <p aria-hidden="true" className="cipher-text font-[family-name:var(--font-signal)] text-xl leading-relaxed text-violet-100 sm:text-2xl">
          {text}
        </p>
        <p className="sr-only" aria-live="polite">
          {done ? MESSAGE : ""}
        </p>

        <p className="mt-8 font-[family-name:var(--font-signal)] text-xs text-slate-500">
          sinal instável · <span className="cipher-text text-violet-400">{signal}</span> · aguarde novas transmissões
        </p>
      </div>
    </div>
  );
}
