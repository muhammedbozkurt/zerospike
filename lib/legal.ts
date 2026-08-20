import { currentLang } from "./i18n";

/**
 * Language-aware legal/support links on greeneyeapp.com.
 * The site hosts Turkish at the root (/legal/..., /zerospike/support), and
 * localized pages for de, fr and es at /<lang>/legal/..., /<lang>/zerospike/support.
 * Every other supported language (it, pt, ar, ja) has no localized page, so it
 * falls back to the English pages at /en/legal/..., /en/zerospike/support.
 */
const BASE = "https://greeneyeapp.com";

const LOCALIZED_LANGS = new Set(["de", "fr", "es"]);

function prefix(): string {
  const lang = currentLang();
  if (lang === "tr") return "/legal";
  if (LOCALIZED_LANGS.has(lang)) return `/${lang}/legal`;
  return "/en/legal";
}

export function privacyUrl(): string {
  return `${BASE}${prefix()}/zerospike-privacy`;
}

export function termsUrl(): string {
  return `${BASE}${prefix()}/zerospike-terms`;
}

export function supportUrl(): string {
  const lang = currentLang();
  const supportPrefix = lang === "tr" ? "" : LOCALIZED_LANGS.has(lang) ? `/${lang}` : "/en";
  return `${BASE}${supportPrefix}/zerospike/support`;
}
