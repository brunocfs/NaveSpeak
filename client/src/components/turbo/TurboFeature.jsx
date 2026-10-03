import { Check, Lock, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEMOS } from "./demos/index.js";
import { useReveal } from "./useReveal.js";

const STATUS = {
  active: { Icon: Check, key: "statusActive", cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" },
  free: { Icon: Users, key: "statusFree", cls: "border-sky-400/30 bg-sky-500/10 text-sky-200" },
  locked: { Icon: Lock, key: "statusLocked", cls: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200" },
};

// Uma seção por benefício: demo animada de um lado, texto do outro (alterna a
// cada `index`). Entra com fade/slide quando rola até ela.
export default function TurboFeature({ benefitKey, index, status }) {
  const { t } = useTranslation();
  const [ref, visible] = useReveal();
  const Demo = DEMOS[benefitKey];
  const { Icon, key, cls } = STATUS[status];

  return (
    <section
      ref={ref}
      className={`group flex flex-col items-center gap-6 rounded-3xl p-4 transition-all duration-700 ease-out hover:bg-purple-500/5 hover:shadow-[0_0_50px_rgba(217,70,239,0.12)] md:gap-10 md:p-6 ${
        index % 2 ? "md:flex-row-reverse" : "md:flex-row"
      } ${visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
    >
      <div className="w-full md:w-1/2">{Demo && <Demo />}</div>
      <div className="w-full text-center md:w-1/2 md:text-left">
        <span className={`mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${cls}`}>
          <Icon className="size-3" /> {t(`turbo.landing.${key}`)}
        </span>
        <h2 className="text-2xl font-bold text-white sm:text-3xl">{t(`turbo.benefits.${benefitKey}.title`)}</h2>
        <p className="mt-2 text-sm text-slate-300 sm:text-base">{t(`turbo.benefits.${benefitKey}.desc`)}</p>
        {status === "locked" && <p className="mt-3 text-xs text-slate-400">{t("turbo.landing.askAdmin")}</p>}
      </div>
    </section>
  );
}
