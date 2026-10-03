import { useEffect, useState } from "react";
import { Check, Lock, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getProfile, updateProfile } from "../api/profile.js";
import { useAuth, useBenefit } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useOpenTurbo } from "../hooks/useOpenTurbo.js";
import { speakingRingColor, TURBO_BENEFITS } from "../utils/turboBenefits.js";
import GhostVoiceToggle from "./GhostVoiceToggle.jsx";
import { Toggle } from "./Toggle.jsx";
import JoinSoundControl from "./turbo/JoinSoundControl.jsx";
import PersonalSoundsSection from "./turbo/PersonalSoundsSection.jsx";
import TurboBadge from "./TurboBadge.jsx";
import TurboProfileSection from "./TurboProfileSection.jsx";

// Um recurso: título + descrição + controle. Benefício desligado pelo admin
// (off) some; sem acesso mostra o cadeado com CTA pro TurboPanel.
function Section({ title, desc, benefit, children }) {
  const { t } = useTranslation();
  const openTurbo = useOpenTurbo();
  if (benefit.mode === "off" && !benefit.has) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mb-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>
      {benefit.locked ? (
        <button type="button" onClick={openTurbo} className="inline-flex cursor-pointer items-center gap-1 text-xs text-fuchsia-500 hover:underline dark:text-fuchsia-300">
          <Lock className="size-3" /> {t("turbo.locked.cta")}
        </button>
      ) : (
        children
      )}
    </section>
  );
}

function SpeakingRingSetting() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { user, updateUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const enabled = user?.speakingRing !== false; // default ligado
  const color = speakingRingColor(user?.nameStyle) ?? "#d946ef";

  async function change(value) {
    setBusy(true);
    try {
      const data = await updateProfile({ speakingRing: value });
      updateUser({ speakingRing: data.user.speakingRing });
    } catch (err) {
      showToast(err.message || "Não foi possível salvar.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Toggle checked={enabled} disabled={busy} label={t("turbo.settings.speakingRing.toggle")} onChange={change} />
      {enabled && (
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="size-10 animate-pulse rounded-full bg-linear-to-br from-purple-400 to-fuchsia-500 motion-reduce:animate-none"
            style={{ boxShadow: `0 0 0 3px ${color}, 0 0 14px 2px ${color}` }}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">{t("turbo.settings.speakingRing.preview")}</span>
        </div>
      )}
    </div>
  );
}

// Aba "TURBO" das Preferências: onde o usuário ativa/configura os benefícios.
export default function TurboSettings() {
  const { t } = useTranslation();
  const { turbo } = useAuth();
  const openTurbo = useOpenTurbo();
  const [profile, setProfile] = useState(null);
  const speakingRing = useBenefit("speakingRing");
  const joinSound = useBenefit("joinSound");
  const personalSounds = useBenefit("personalSounds");
  const ghostVoice = useBenefit("ghostVoice");

  useEffect(() => {
    getProfile().then((d) => setProfile(d.user)).catch(() => {});
  }, []);

  // Benefícios sem nada pra configurar: só um resumo do estado.
  const summary = ["mediaPopout", "hdScreen", "bigUploads", "extraBackgrounds", "animatedAvatar", "longMessages", "serverPerks"]
    .filter((k) => TURBO_BENEFITS.some((b) => b.key === k) && turbo?.catalog?.[k] && turbo.catalog[k] !== "off")
    .map((k) => ({ key: k, has: Boolean(turbo.benefits?.[k]) }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-purple-400/30 bg-linear-to-r from-purple-600/10 to-fuchsia-500/10 px-4 py-3">
        <TurboBadge className="size-5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">NaveSpeak TURBO</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {!turbo?.active
              ? t("turbo.settings.inactive")
              : turbo.until
                ? t("turboWelcome.until", { date: new Date(turbo.until).toLocaleString() })
                : t("turboWelcome.noExpiry")}
          </p>
        </div>
        {!turbo?.active && (
          <button type="button" onClick={openTurbo} className="turbo-button inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold">
            <Rocket className="turbo-icon size-3.5" /> {t("turbo.settings.discover")}
          </button>
        )}
      </div>

      <Section title={t("turbo.benefits.speakingRing.title")} desc={t("turbo.benefits.speakingRing.desc")} benefit={speakingRing}>
        <SpeakingRingSetting />
      </Section>

      <Section title={t("turbo.sounds.joinTitle")} desc={t("turbo.sounds.joinHint")} benefit={joinSound}>
        <JoinSoundControl />
      </Section>

      <Section title={t("turbo.sounds.title")} desc={t("turbo.settings.personalDesc")} benefit={personalSounds}>
        <PersonalSoundsSection />
      </Section>

      <Section title={t("privacy.ghostVoice.label")} desc={t("turbo.benefits.ghostVoice.desc")} benefit={ghostVoice}>
        <GhostVoiceToggle />
      </Section>

      {profile && <TurboProfileSection profile={profile} onSaved={setProfile} />}

      {summary.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{t("turbo.settings.summary")}</h3>
          <ul className="space-y-1">
            {summary.map(({ key, has }) => (
              <li key={key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                {has ? <Check className="size-3.5 text-emerald-500" /> : <Lock className="size-3.5 text-fuchsia-400" />}
                <span className="min-w-0 flex-1 truncate">{t(`turbo.benefits.${key}.title`)}</span>
                <span className="text-slate-400">{has ? t("turbo.settings.active") : t("turbo.landing.statusLocked")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
