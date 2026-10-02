import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptBR from '../locales/pt-BR.json';

// pt-BR vai no bundle (é o idioma padrão e o fallback de qualquer chave
// faltando). Os demais só são baixados quando escolhidos - quem usa pt-BR
// nunca paga por eles.
const loaders = {
  'en-US': () => import('../locales/en-US.json'),
  'es-ES': () => import('../locales/es-ES.json'),
};

export const DEFAULT_LANGUAGE = 'pt-BR';
export const SUPPORTED_LANGUAGES = [DEFAULT_LANGUAGE, ...Object.keys(loaders)];

i18n.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources: { [DEFAULT_LANGUAGE]: { translation: ptBR } },
  // React já escapa o que renderiza - escapar aqui de novo mostraria
  // "&amp;" etc. na tela.
  interpolation: { escapeValue: false },
});

// Idioma do navegador/SO se for um dos suportados (exato, ou só pelo prefixo:
// "en-GB" -> "en-US"), senão pt-BR. Só usado quando o usuário ainda não
// escolheu um idioma (ver DEFAULT_PREFERENCES em PreferencesContext.jsx).
export function detectLanguage() {
  const candidates = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  for (const lang of candidates) {
    if (!lang) continue;
    const exact = SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === lang.toLowerCase());
    if (exact) return exact;
    const prefix = lang.split('-')[0].toLowerCase();
    const byPrefix = SUPPORTED_LANGUAGES.find((l) => l.split('-')[0] === prefix);
    if (byPrefix) return byPrefix;
  }
  return DEFAULT_LANGUAGE;
}

// Troca o idioma da interface, baixando o arquivo dele antes se preciso.
// Nunca lança: idioma desconhecido ou falha ao baixar (offline) fica em pt-BR.
export async function setAppLanguage(language) {
  let lng = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  if (loaders[lng] && !i18n.hasResourceBundle(lng, 'translation')) {
    try {
      const mod = await loaders[lng]();
      i18n.addResourceBundle(lng, 'translation', mod.default);
    } catch (err) {
      console.warn(`[i18n] Não foi possível carregar o idioma "${lng}":`, err.message);
      lng = DEFAULT_LANGUAGE;
    }
  }
  await i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
}

export default i18n;
