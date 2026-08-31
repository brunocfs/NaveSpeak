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
      setTheme: (theme) => setPreferences((prev) => ({ ...prev, theme })),
      toggleTheme: () =>
        setPreferences((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' })),
      setLanguage: (language) => setPreferences((prev) => ({ ...prev, language })),
      setNotificationsEnabled: (notificationsEnabled) =>
        setPreferences((prev) => ({ ...prev, notificationsEnabled })),
      setMicDeviceId: (micDeviceId) => setPreferences((prev) => ({ ...prev, micDeviceId })),
      setCameraDeviceId: (cameraDeviceId) => setPreferences((prev) => ({ ...prev, cameraDeviceId })),
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
