import { useRef } from "react";
import { Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import { TURBO_BENEFITS } from "../utils/turboBenefits.js";
import TurboFeature from "./turbo/TurboFeature.jsx";
import TurboHero from "./turbo/TurboHero.jsx";
import { prefersReducedMotion } from "./turbo/useReveal.js";

// Landing do TURBO (aberta pelo botão TURBO do DmSidebar). Os fundos ficam
// FORA da área rolável (sempre cobrem a tela); as estrelas sobem devagar ao
// rolar (parallax leve, direto no DOM, sem re-render).
export default function TurboPanel() {
  const { t } = useTranslation();
  const { turbo } = useAuth();
  const starsRef = useRef(null);
  const frame = useRef(0);

  function handleScroll(e) {
    if (prefersReducedMotion()) return;
    const top = e.currentTarget.scrollTop;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (starsRef.current) starsRef.current.style.transform = `translateY(${-Math.min(top * 0.15, 140)}px)`;
    });
  }

  // Só o que o admin não desligou; "free" = incluso pra todos, senão depende de quem tem.
  const features = TURBO_BENEFITS.map((b) => ({ key: b.key, mode: turbo?.catalog?.[b.key] }))
    .filter((f) => f.mode && f.mode !== "off")
    .map((f) => ({ ...f, status: f.mode === "free" ? "free" : turbo.benefits?.[f.key] ? "active" : "locked" }));

  return (
    <div className="turbo-page relative h-full overflow-hidden bg-[#05030c] text-slate-100">
      <div ref={starsRef} className="turbo-page-stars absolute inset-x-0 -top-8 h-[130%] will-change-transform" aria-hidden="true" />
      <div className="turbo-page-flame absolute inset-x-0 bottom-0 h-2/3" aria-hidden="true" />

      <div className="relative h-full overflow-y-auto" onScroll={handleScroll}>
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
          <TurboHero turbo={turbo} />

          <div className="space-y-10 pb-10 sm:space-y-16">
            {features.map((f, i) => (
              <TurboFeature key={f.key} benefitKey={f.key} index={i} status={f.status} />
            ))}
          </div>

          <footer className="flex flex-col items-center gap-3 py-16 text-center">
            <Rocket className="size-8 text-fuchsia-300" />
            <h2 className="turbo-page-title text-3xl font-black sm:text-4xl">{t("turbo.landing.footerTitle")}</h2>
            <p className="max-w-md text-sm text-slate-300">{t("turbo.landing.footerText")}</p>
            {!turbo?.active && (
              <span className="turbo-button mt-2 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold">
                <Rocket className="turbo-icon size-4" /> {t("turbo.landing.askAdmin")}
              </span>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
