// Fonte única do catálogo TURBO (contrato: modos por chave + limites por usuário).
// Modos: 'turbo' (só TURBO), 'free' (todos), 'off' (ninguém); hdScreen também
// aceita 'turboBitrate' (modo A: resolução/fps livres, bitrate só com TURBO).
export const TURBO_DEFAULTS = Object.freeze({
  nameStyle: 'turbo',
  hdScreen: 'turboBitrate',
  bigUploads: 'turbo',
  mediaPopout: 'free',
  ghostVoice: 'turbo',
  profileBanner: 'turbo',
  speakingRing: 'turbo',
  extraBackgrounds: 'turbo',
  animatedAvatar: 'free',
  longMessages: 'turbo',
  personalSounds: 'turbo',
  joinSound: 'turbo',
  serverPerks: 'off',
});

export const TURBO_KEYS = Object.freeze(Object.keys(TURBO_DEFAULTS));

export const TURBO_LIMITS = Object.freeze({
  screenBase: { screenMaxResolution: '1080p', screenMaxFps: 30, screenMaxBitrateKbps: 4000 },
  screenHd: { screenMaxResolution: '1440p', screenMaxFps: 60, screenMaxBitrateKbps: 6000 },
  attachmentMaxBytes: 20 * 1024 * 1024,
  attachmentMaxBytesTurbo: 50 * 1024 * 1024,
  messageMaxChars: 2000,
  messageMaxCharsTurbo: 4000,
  backgroundsMax: 10,
  personalSoundsPerUser: 3, // por servidor, fora da cota do servidor
  joinSoundMaxMs: 5000,
  bannerMaxBytes: 2 * 1024 * 1024,
  serverPerksMultiplier: 2,
});

// Defaults aplicados + booleanos legados (true -> turbo, false -> off).
// Ignora chaves/valores desconhecidos.
export function normalizeCatalog(raw) {
  const out = { ...TURBO_DEFAULTS };
  for (const key of TURBO_KEYS) {
    let v = raw?.[key];
    if (v === true) v = 'turbo';
    else if (v === false) v = 'off';
    if (v === 'turbo' || v === 'free' || v === 'off' || (key === 'hdScreen' && v === 'turboBitrate')) out[key] = v;
  }
  return out;
}

// catalog: já normalizado; benefits: { key: boolean } efetivo do usuário.
// backgroundsBase = app_settings.user_backgrounds_max_count.
export function resolveLimits(catalog, benefits, backgroundsBase = TURBO_LIMITS.backgroundsMax) {
  const L = TURBO_LIMITS;
  const has = (k) => benefits?.[k] === true;
  const mode = catalog?.hdScreen ?? TURBO_DEFAULTS.hdScreen;
  let screen = L.screenBase;
  if (mode === 'free' || (mode === 'turbo' && has('hdScreen'))) screen = L.screenHd;
  else if (mode === 'turboBitrate') {
    screen = { ...L.screenHd, screenMaxBitrateKbps: has('hdScreen') ? L.screenHd.screenMaxBitrateKbps : L.screenBase.screenMaxBitrateKbps };
  }
  return {
    ...screen,
    attachmentMaxBytes: has('bigUploads') ? L.attachmentMaxBytesTurbo : L.attachmentMaxBytes,
    messageMaxChars: has('longMessages') ? L.messageMaxCharsTurbo : L.messageMaxChars,
    backgroundsMax: has('extraBackgrounds') ? backgroundsBase * 2 : backgroundsBase,
  };
}

// Maior maxBitrate (bps) declarado nos encodings do producer excede o teto
// de tela (kbps)? Sem maxBitrate declarado não há o que comparar.
export function exceedsScreenBitrate(rtpParameters, limits) {
  const capBps = limits.screenMaxBitrateKbps * 1000;
  return (rtpParameters?.encodings ?? []).some((e) => Number(e?.maxBitrate) > capBps);
}

// Código estável (i18n no client) + max pra mensagem grande demais.
export const messageTooLong = (content, limits) =>
  content.length > limits.messageMaxChars
    ? { error: `Mensagem muito longa (máx. ${limits.messageMaxChars} caracteres).`, code: 'message_too_long', max: limits.messageMaxChars }
    : null;

// Um som pode virar som de entrada? sound vem de findSoundForJoin: som do
// servidor exige ser membro; som pessoal só o do próprio usuário com o
// benefício personalSounds. Devolve o code de erro ou null.
export function joinSoundCheck(sound) {
  if (sound.ownerUserId != null) {
    if (!sound.isOwn || !sound.hasPersonal) return 'join_sound_forbidden';
  } else if (!sound.isMember) {
    return 'join_sound_forbidden';
  }
  return sound.durationMs > TURBO_LIMITS.joinSoundMaxMs ? 'join_sound_too_long' : null;
}

// Anel de fala efetivo = benefício AND preferência do usuário.
export const isSpeakingRingOn = ({ hasBenefit, pref }) => Boolean(hasBenefit && pref);

// serverPerks (dono do servidor com o benefício): cota e duração dos sons do
// servidor ×2. base = app_settings; duração continua <= 60s (teto do schema).
export function soundboardLimits(base, serverPerks) {
  const k = serverPerks ? TURBO_LIMITS.serverPerksMultiplier : 1;
  return {
    maxSounds: base.soundboardMaxSounds * k,
    maxDurationMs: Math.min(base.soundboardMaxDurationMs * k, 60_000),
    maxBytes: base.soundboardMaxBytes,
    personalPerUser: TURBO_LIMITS.personalSoundsPerUser,
  };
}
