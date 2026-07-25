import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Lang } from "../db/types";
import { setActiveLang } from "../lang";

import tr from "./locales/tr";
import en from "./locales/en";
import de from "./locales/de";
import es from "./locales/es";
import fr from "./locales/fr";

export const SUPPORTED_LANGS: Lang[] = ["tr", "en", "de", "es", "fr"];
const LANG_STORAGE_KEY = "zerospike.lang";

export const LANG_LABELS: Record<Lang, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
};

const resources = {
  tr: { translation: tr },
  en: { translation: en },
  de: { translation: de },
  es: { translation: es },
  fr: { translation: fr },
};

function deviceLang(): Lang {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    if (code && (SUPPORTED_LANGS as string[]).includes(code)) return code as Lang;
  } catch {
    // expo-localization not ready — fall through
  }
  return "en"; // unsupported system language → English (global default)
}

// Initialize i18next SYNCHRONOUSLY at module load with the device language, so
// react-i18next always has a bound instance before any component renders (an
// async init caused "pass in an i18next instance" + a hook-order crash).
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: deviceLang(),
    fallbackLng: "en",
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
      await i18n.changeLanguage(saved);
    }
  } catch {
    // ignore storage errors — keep the device language
  }
}

export async function setLanguage(lang: Lang): Promise<void> {
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
