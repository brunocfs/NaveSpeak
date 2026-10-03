import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Palette, Rocket, Sparkles } from "lucide-react";

const COLORS = ["#d946ef", "#a855f7", "#f0abfc", "#fbbf24", "#60a5fa"];
// Posições/atrasos fixos: sem random() no render, e CSS puro (sem dep).
const CONFETTI = Array.from({ length: 24 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${((i * 53) % 25) / 10}s`,
  color: COLORS[i % COLORS.length],
}));

// Popup de boas-vindas ao ganhar TURBO (evento account:turboGranted, ver
// AuthContext.jsx). Mesmo padrão de overlay em portal do WelcomeModal.jsx.
export default function TurboWelcomeModal({ open, until, onClose }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const benefits = [
    { Icon: Rocket, text: t("turboWelcome.benefitBadge") },
    { Icon: Palette, text: t("turboWelcome.benefitNameStyle") },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("turboWelcome.title")}
      onClick={onClose}
    >
      <div
        className="turbo-welcome-card relative w-full max-w-md overflow-hidden rounded-2xl p-6 text-center text-slate-100 shadow-2xl ring-1 ring-fuchsia-400/30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {CONFETTI.map((c, i) => (
            <span key={i} className="turbo-confetti" style={{ left: c.left, animationDelay: c.delay, background: c.color }} />
          ))}
        </div>

        <div className="relative">
          <div className="turbo-welcome-rocket mx-auto mb-3 flex size-20 items-center justify-center rounded-3xl border border-purple-400/30 bg-purple-500/10">
            <Rocket className="size-10 text-fuchsia-200" />
          </div>
          <h2 className="turbo-page-title text-3xl font-black tracking-tight">{t("turboWelcome.title")}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {until ? t("turboWelcome.until", { date: new Date(until).toLocaleString() }) : t("turboWelcome.noExpiry")}
          </p>

          <ul className="mt-5 space-y-2 text-left">
            {benefits.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 rounded-xl border border-purple-400/25 bg-purple-500/10 px-4 py-3 text-sm">
                <Icon className="size-5 shrink-0 text-fuchsia-300" />
                {text}
              </li>
            ))}
          </ul>

          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="turbo-button mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white"
          >
            <Sparkles className="turbo-icon size-4" /> {t("turboWelcome.cta")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
