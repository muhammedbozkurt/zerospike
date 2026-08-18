import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Lang } from "../db/types";
import { setActiveLang } from "../lang";

export const SUPPORTED_LANGS: Lang[] = [
  "tr",
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "ar",
  "ja",
];
const LANG_STORAGE_KEY = "zerospike.lang";

export const LANG_LABELS: Record<Lang, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pt: "Português (Brasil)",
  ar: "العربية",
  ja: "日本語",
};

/**
 * Per-language bundle loaders. All five used to be STATIC imports, so every cold
 * start parsed and kept the whole translation set in memory (~220 KB of object
 * literals) to render in exactly one of them. A `require` inside a function body
 * is not evaluated until it is called, so a language nobody selected costs
 * nothing.
 *
 * Only two bundles are ever loaded up front: the one being rendered, and the
 * 'en' fallback (fallbackLng below), so a key missing from a locale resolves
 * exactly as it did when all five were resident.
 */
type Bundle = Record<string, unknown>;
const LOCALE_LOADERS: Record<Lang, () => Bundle> = {
  tr: () => require("./locales/tr").default as Bundle,
  en: () => require("./locales/en").default as Bundle,
  de: () => require("./locales/de").default as Bundle,
  es: () => require("./locales/es").default as Bundle,
  fr: () => require("./locales/fr").default as Bundle,
  it: () => require("./locales/it").default as Bundle,
  pt: () => require("./locales/pt").default as Bundle,
  ar: () => require("./locales/ar").default as Bundle,
  ja: () => require("./locales/ja").default as Bundle,
};

const FALLBACK_LANG: Lang = "en";
const loadedLangs = new Set<Lang>();

/** Loads a language's bundle into the live i18next instance, once. */
function ensureLangLoaded(lang: Lang): void {
  if (loadedLangs.has(lang)) return;
  loadedLangs.add(lang);
  i18n.addResourceBundle(lang, "translation", LOCALE_LOADERS[lang](), true, true);
}

function deviceLang(): Lang {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    if (code && (SUPPORTED_LANGS as string[]).includes(code)) return code as Lang;
  } catch {
    // expo-localization not ready, fall through
  }
  return "en"; // unsupported system language → English (global default)
}

// Initialize i18next SYNCHRONOUSLY at module load with the device language, so
// react-i18next always has a bound instance before any component renders (an
// async init caused "pass in an i18next instance" + a hook-order crash). The
// bundles are resolved through synchronous require()s here, so lazy loading
// does NOT reintroduce an async init.
if (!i18n.isInitialized) {
  const initial = deviceLang();
  const resources: Record<string, { translation: Bundle }> = {
    [initial]: { translation: LOCALE_LOADERS[initial]() },
  };
  loadedLangs.add(initial);
  if (initial !== FALLBACK_LANG) {
    resources[FALLBACK_LANG] = { translation: LOCALE_LOADERS[FALLBACK_LANG]() };
    loadedLangs.add(FALLBACK_LANG);
  }
  i18n.use(initReactI18next).init({
    resources,
    lng: initial,
    fallbackLng: FALLBACK_LANG,
    interpolation: { escapeValue: false },
    returnNull: false,
    compatibilityJSON: "v3",
  });
}

// Mirror the language into the lightweight holder that the pure format helpers
// read (they must not import this heavy module). Set once now and on every change.
setActiveLang(i18n.language);
i18n.on("languageChanged", (lng) => setActiveLang(lng));

/**
 * Initializes i18next.
 * - First launch (no saved choice): follow the device/system language.
 * - After the user picks a language in Settings: that choice is persisted and
 *   always wins on subsequent launches, regardless of the system language.
 */
export async function initI18n(): Promise<void> {
  // i18n is already initialized synchronously with the device language above.
  // Here we only apply the user's saved choice, if any, so it overrides the
  // system language on subsequent launches.
  try {
    const saved = await AsyncStorage.getItem(LANG_STORAGE_KEY);
    if (
      saved &&
      (SUPPORTED_LANGS as string[]).includes(saved) &&
      i18n.language !== saved
    ) {
      ensureLangLoaded(saved as Lang);
      await i18n.changeLanguage(saved);
    }
  } catch {
    // ignore storage errors, keep the device language
  }
}

export async function setLanguage(lang: Lang): Promise<void> {
  ensureLangLoaded(lang);
  await i18n.changeLanguage(lang);
  try {
    await AsyncStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // best-effort persistence
  }
}

export function currentLang(): Lang {
  const code = (i18n.language || "tr").slice(0, 2);
  return (SUPPORTED_LANGS as string[]).includes(code) ? (code as Lang) : "tr";
}

export default i18n;
