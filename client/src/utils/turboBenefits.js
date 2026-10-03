// Catálogo de benefícios TURBO (espelha TURBO_KEYS em server/src/utils/turbo.js).
// Benefício novo = entrada nova aqui + no servidor + locales (turbo.benefits.<key>).
export const TURBO_BENEFITS = [
  'nameStyle', 'hdScreen', 'bigUploads', 'mediaPopout', 'ghostVoice', 'profileBanner', 'speakingRing',
  'extraBackgrounds', 'animatedAvatar', 'longMessages', 'personalSounds', 'joinSound', 'serverPerks',
].map((key) => ({ key }));

// Cor do anel de fala = cor do nome (sólido ou 1ª cor do gradiente); null = anel padrão.
export const speakingRingColor = (nameStyle) => nameStyle?.gradient?.[0] ?? nameStyle?.color ?? null;
