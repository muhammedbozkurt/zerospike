// Curated references Spike may attach to a reply. The model only ever returns
// ids from this list; titles and URLs come from here, so a reply can never
// carry a link nobody vetted. URLs checked 2026-10-06.
import type { Locale } from "./prompt.ts";

export interface SourceRef {
  id: string;
  title: string;
  url: string;
}

interface CuratedSource {
  id: string;
  /** Organisation names are proper nouns and stay verbatim in every language,
   *  as on app/sources.tsx; only the app's own screen has a translated title. */
  title: string | Record<Locale, string>;
  url: string;
  /** Told to the model so it can pick a fitting source; never shown. */
  covers: string;
}

export const MAX_SOURCES = 2;

export const SOURCES: readonly CuratedSource[] = [
  {
    id: "ada_standards",
    title: "ADA Standards of Care in Diabetes",
    url: "https://professional.diabetes.org/standards-of-care",
    covers: "American Diabetes Association clinical guideline: glucose targets, time in range, A1C, standards of care",
  },
  {
    id: "idf",
    title: "International Diabetes Federation (IDF)",
    url: "https://idf.org/about-diabetes/what-is-diabetes/",
    covers: "what diabetes is, the main types, global facts",
  },
  {
    id: "diabetes_uk",
    title: "Diabetes UK",
    url: "https://www.diabetes.org.uk/about-diabetes",
    covers: "plain-language basics: types, symptoms, everyday life with diabetes",
  },
  {
    id: "niddk",
    title: "NIDDK (NIH)",
    url: "https://www.niddk.nih.gov/health-information/diabetes",
    covers: "US National Institutes of Health information: types, tests, managing diabetes, low blood glucose basics",
  },
  {
    id: "app_sources",
    // Same wording as the existing sources.link key in lib/i18n/locales.
    title: {
      en: "Medical information & sources",
      tr: "Tıbbi bilgi ve kaynaklar",
      de: "Medizinische Informationen & Quellen",
      fr: "Informations et sources médicales",
      es: "Información y fuentes médicas",
      it: "Informazioni e fonti mediche",
      pt: "Informações e fontes médicas",
      ar: "معلومات ومصادر طبية",
      ja: "医学情報と参考資料",
    },
    url: "zerospike://sources",
    covers: "the app's own medical information screen listing the references behind its calculations and education",
  },
];

/** Model-supplied ids to vetted references: unknown ids dropped, duplicates
 *  removed, at most MAX_SOURCES. */
export function resolveSources(ids: unknown, locale: Locale): SourceRef[] {
  if (!Array.isArray(ids)) return [];
  const out: SourceRef[] = [];
  for (const id of ids) {
    if (out.length >= MAX_SOURCES) break;
    const source = SOURCES.find((s) => s.id === id);
    if (!source || out.some((o) => o.id === source.id)) continue;
    const title = typeof source.title === "string" ? source.title : source.title[locale];
    out.push({ id: source.id, title, url: source.url });
  }
  return out;
}
