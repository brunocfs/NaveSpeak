import { ChevronDown, Rocket, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

// Topo da landing: título, subtítulo e o estado do usuário. Não há pagamento,
// então quem não é TURBO vê só o aviso de falar com um admin.
export default function TurboHero({ turbo }) {
  const { t } = useTranslation();
  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center py-12 text-center">
      <div className="turbo-page-icon mb-5 flex size-20 items-center justify-center rounded-3xl border border-purple-400/30 bg-purple-500/10">
        <Rocket className="size-10 text-fuchsia-200" />
      </div>
      <h1 className="turbo-page-title text-5xl font-black tracking-tight sm:text-7xl">TURBO</h1>
      <p className="mt-4 max-w-xl text-balance text-base text-slate-300 sm:text-lg">{t("turbo.landing.heroSubtitle")}</p>

      {turbo?.active ? (
        <span className="turbo-page-badge mt-6 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-200">
          <Sparkles className="size-3.5" />
          {turbo.until ? t("turboWelcome.until", { date: new Date(turbo.until).toLocaleString() }) : t("turboWelcome.noExpiry")}
        </span>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-2">
          <span className="turbo-button inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold">
            <Rocket className="turbo-icon size-4" /> {t("turbo.landing.heroCta")}
          </span>
          <span className="text-xs text-slate-400">{t("turbo.landing.askAdmin")}</span>
        </div>
      )}

      <ChevronDown className="mt-12 size-6 animate-bounce text-fuchsia-300/70 motion-reduce:animate-none" aria-hidden="true" />
    </section>
  );
}
