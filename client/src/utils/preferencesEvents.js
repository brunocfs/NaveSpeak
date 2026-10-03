// PreferencesModal vive dentro da VoiceControlBar e guarda o próprio `open`;
// quem está fora dele abre/fecha por evento (mínimo, sem contexto novo).
export const PREFERENCES_EVENT = 'navespeak:preferences';

export const openPreferences = (tab) =>
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { tab } }));

export const closePreferences = () =>
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { close: true } }));
