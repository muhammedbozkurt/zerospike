import { currentLang } from "./i18n";

/**
 * Language-aware legal links on greeneyeapp.com.
 * The site hosts Turkish at /legal/... and other languages at /en/legal/...
 * So Turkish users open the TR pages; everyone else opens the EN pages.
 */
const BASE = "https://greeneyeapp.com";

function prefix(): string {
  return currentLang() === "tr" ? "/legal" : "/en/legal";
}

export function privacyUrl(): string {
  return `${BASE}${prefix()}/zerospike-privacy`;
}

export function termsUrl(): string {
  return `${BASE}${prefix()}/zerospike-terms`;
}

export function supportUrl(): string {
  // Support lives at /<app>/support (TR) and /en/<app>/support (others),
  // matching the sibling apps — not under /legal/.
  return `${BASE}${currentLang() === "tr" ? "" : "/en"}/zerospike/support`;
}
