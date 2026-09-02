import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PreferencesContext = createContext(null);

const STORAGE_KEY = 'navespeak:preferences';

// Padrão pedido: dark mode é o inicial do sistema (não é "seguir o SO" -
// é sempre dark até o usuário trocar e persistir a escolha própria).
const DEFAULT_PREFERENCES = {
  theme: 'dark',
  language: 'pt-BR',
  notificationsEnabled: true,
  // null = "padrão do sistema" (nenhum deviceId específico salvo, ou o
  // salvo não existe mais no fallback de MediaSessionContext.joinVoice/
  // shareCamera - ver api/media.js getStreamWithFallback).
  micDeviceId: null,
  cameraDeviceId: null,
  // Barra de membros do servidor (RoomPage) - visível por padrão; ocultar
  // libera a coluna pro painel de chat/voz crescer. Persistido junto do
  // resto (mesma mecânica), então a escolha vale pra qualquer servidor, não
  // só o atual.
  membersSidebarVisible: true,
  // Layout de vídeo do painel de voz (VoicePanel/VideoLayoutManager):
  // 'grid' = grade simples, tamanho fixo por tile, só 1 fixado por vez
  // (o comportamento clássico, sem resize manual - ver SimpleVideoGrid.jsx);
  // 'free' = grid automático + resize manual por tile + múltiplos fixados
  // ao mesmo tempo (VideoLayoutManager.jsx). 'grid' como padrão: é o modo
  // sem o resize/pin ainda instável em popout.
  videoLayoutMode: 'grid',
  // Esconde do grid quem tá sem câmera/tela ligada (só o avatar) - quem tem
  // só o mic aberto continua ouvido normalmente, só não ocupa um quadradinho
  // visual. Fixado (pin) sempre aparece mesmo sem mídia, ver VoicePanel.jsx.
  hideParticipantsWithoutMedia: false,
  // Volume individual por usuário (0-100, padrão 100 - teto de `el.volume`
  // nativo, ver RemoteAudioPlayers.jsx; sem boost acima de 100%, tentativas
  // via Web Audio quebraram a reprodução de verdade e foram revertidas) - só
  // a REPRODUÇÃO local, não afeta o que os outros ouvem. Sem permissão nenhuma: qualquer
  // um ajusta o volume de qualquer outro participante, é só uma preferência
  // de audição própria (mesma ideia do Discord). Chave = userId, ausente ==
  // 100 (ver getUserVolume abaixo). Fica junto do resto em localStorage, sob
  // o mesmo controle de tema/idioma, então vale pra qualquer servidor/canal.
  userVolumes: {},
  // Supressor de ruído do PRÓPRIO microfone (Preferências > Áudio) - aplicado
  // ao entrar na voz (joinVoice em MediaSessionContext.jsx), igual
  // micDeviceId: trocar no meio de uma chamada só vale da próxima vez que
  // entrar. 'native' = noiseSuppression do WebRTC (só liga/desliga, é o
  // padrão de sempre); 'rnnoise' = RNNoise via WASM (audio/rnnoise.js),
  // aberto e mais eficaz em ruído não-estacionário; 'gtcrn' = GTCRN via WASM
  // (audio/gtcrn.js), rede mais nova, qualidade melhor que RNNoise nos
  // benchmarks padrão (PESQ/STOI/DNSMOS) e ainda leve o bastante pra tempo
  // real; 'off' = nenhum.
  noiseSuppressionMode: "native",
  // 0-100, só usado nos modos 'rnnoise'/'gtcrn' - mix dry/wet entre o áudio
  // cru e o processado (100 = só processado). Ver createRnnoiseStream/
  // createGtcrnStream.
  noiseSuppressionLevel: 100,
  // Sensibilidade do microfone (noise gate de verdade, audio/noiseGate.js) -
  // abaixo de `micGateThresholdDb` a track enviada vira silêncio, em vez de
  // carregar ruído de fundo constante pros outros. `false` por padrão de
  // propósito (opt-in): é uma feature nova que MUDA o que sai do mic de
  // quem ligar - ninguém deveria ter o comportamento do próprio microfone
  // alterado sem escolher isso explicitamente. Aplicado ao entrar na voz,
  // igual noiseSuppressionMode - o threshold do worklet é fixado na criação
  // do node, não dá pra reconfigurar ao vivo (ver noiseGate.js).
  micGateEnabled: false,
  // dBFS RMS - -50 é um meio-termo razoável (corta silêncio/piso de sala
  // sem exigir grito); ajustável de -70 (bem sensível, capta até sussurro)
  // a -10 (só voz alta) no slider de Preferências, com medidor ao vivo
  // (hooks/useMicLevel.js) pra calibrar vendo o próprio nível.
  micGateThresholdDb: -50,
};

// Lista fechada por enquanto (sem i18n real ainda - ver LANGUAGES abaixo),
// mas guardar o `code` já no formato BCP 47 deixa a troca por um i18n de
// verdade (react-i18next etc.) direta no futuro: só passar a consumir
// `language` num provider de traduções, sem mexer nesta tela.
export const LANGUAGES = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'es-ES', label: 'Español' },
];

function loadStoredPreferences() {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    // localStorage indisponível (modo privado restrito) ou JSON corrompido -
    // segue com o padrão em vez de quebrar o app inteiro por causa de uma
    // preferência.
    return DEFAULT_PREFERENCES;
  }
}

// Provider fica ACIMA de <Routes> em App.jsx (mesmo padrão de
// PresenceProvider/MediaSessionProvider): tema é global, precisa estar
// aplicado antes de qualquer tela (inclusive Login/Register) e não pode
// depender de o usuário estar autenticado.
export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(loadStoredPreferences);

  // Aplica o tema na <html> (classe .dark) - é nela que a variant
  // `dark:` do Tailwind (custom-variant em styles/index.css) e as
  // variáveis CSS legadas (--bg/--panel/etc.) se penduram, então qualquer
  // tela da aplicação segue sem precisar saber que essa troca aconteceu.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', preferences.theme === 'dark');
    root.style.colorScheme = preferences.theme;
  }, [preferences.theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Idem loadStoredPreferences: persistência é "nice to have", não pode
      // derrubar a troca de preferência em memória se o storage falhar.
    }
  }, [preferences]);

  const value = useMemo(
    () => ({
      theme: preferences.theme,
      language: preferences.language,
      notificationsEnabled: preferences.notificationsEnabled,
      micDeviceId: preferences.micDeviceId,
      cameraDeviceId: preferences.cameraDeviceId,
      membersSidebarVisible: preferences.membersSidebarVisible,
      videoLayoutMode: preferences.videoLayoutMode,
      hideParticipantsWithoutMedia: preferences.hideParticipantsWithoutMedia,
      userVolumes: preferences.userVolumes,
      getUserVolume: (userId) => preferences.userVolumes[userId] ?? 100,
      noiseSuppressionMode: preferences.noiseSuppressionMode,
      noiseSuppressionLevel: preferences.noiseSuppressionLevel,
      micGateEnabled: preferences.micGateEnabled,
      micGateThresholdDb: preferences.micGateThresholdDb,
      setTheme: (theme) => setPreferences((prev) => ({ ...prev, theme })),
      toggleTheme: () =>
        setPreferences((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' })),
      setLanguage: (language) => setPreferences((prev) => ({ ...prev, language })),
      setNotificationsEnabled: (notificationsEnabled) =>
        setPreferences((prev) => ({ ...prev, notificationsEnabled })),
      setMicDeviceId: (micDeviceId) => setPreferences((prev) => ({ ...prev, micDeviceId })),
      setCameraDeviceId: (cameraDeviceId) => setPreferences((prev) => ({ ...prev, cameraDeviceId })),
      toggleMembersSidebar: () =>
        setPreferences((prev) => ({ ...prev, membersSidebarVisible: !prev.membersSidebarVisible })),
      setVideoLayoutMode: (videoLayoutMode) => setPreferences((prev) => ({ ...prev, videoLayoutMode })),
      toggleHideParticipantsWithoutMedia: () =>
        setPreferences((prev) => ({
          ...prev,
          hideParticipantsWithoutMedia: !prev.hideParticipantsWithoutMedia,
        })),
      setUserVolume: (userId, volume) =>
        setPreferences((prev) => ({
          ...prev,
          userVolumes: { ...prev.userVolumes, [userId]: volume },
        })),
      setNoiseSuppressionMode: (noiseSuppressionMode) =>
        setPreferences((prev) => ({ ...prev, noiseSuppressionMode })),
      setNoiseSuppressionLevel: (noiseSuppressionLevel) =>
        setPreferences((prev) => ({ ...prev, noiseSuppressionLevel })),
      setMicGateEnabled: (micGateEnabled) =>
        setPreferences((prev) => ({ ...prev, micGateEnabled })),
      setMicGateThresholdDb: (micGateThresholdDb) =>
        setPreferences((prev) => ({ ...prev, micGateThresholdDb })),
    }),
    [preferences]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences precisa estar dentro de <PreferencesProvider>.');
  return ctx;
}
