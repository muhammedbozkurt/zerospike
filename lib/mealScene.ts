/**
 * The foods a locale's meal-compose scene and empty-state starters use: a
 * local breakfast per app language, named by their English catalogue name
 * (foods.name_en, resolved with getCatalogFoodByEnglishName; the display name
 * then follows the user's language). Pure data, no React and no database.
 *
 * `grams` is what the scene row shows (one household portion of the food).
 */
export type SceneLang = "tr" | "en" | "de" | "fr" | "es" | "it" | "pt" | "ar" | "ja";

export const SCENE_LANGS: readonly SceneLang[] = [
  "tr",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "ar",
  "ja",
];

export interface SceneFood {
  /** Exact foods.name_en of the catalogue row. */
  en: string;
  grams: number;
}

const SCENES: Record<SceneLang, readonly [SceneFood, SceneFood, SceneFood]> = {
  tr: [
    { en: "Simit", grams: 100 },
    { en: "Feta cheese", grams: 56 },
    { en: "Sweetened tea", grams: 200 },
  ],
  de: [
    { en: "Bread roll", grams: 55 },
    { en: "Gouda", grams: 28 },
    { en: "Filter coffee", grams: 250 },
  ],
  en: [
    { en: "Toast bread", grams: 60 },
    { en: "Egg", grams: 50 },
    { en: "Milk", grams: 244 },
  ],
  fr: [
    { en: "Baguette", grams: 64 },
    { en: "Camembert", grams: 40 },
    { en: "Café au lait", grams: 200 },
  ],
  es: [
    { en: "White bread", grams: 56 },
    { en: "Egg", grams: 50 },
    { en: "Orange juice", grams: 248 },
  ],
  it: [
    { en: "Ciabatta", grams: 60 },
    { en: "Mozzarella", grams: 50 },
    { en: "Cappuccino", grams: 180 },
  ],
  pt: [
    { en: "Pão francês (Brazilian French roll)", grams: 50 },
    { en: "Boiled egg", grams: 50 },
    { en: "Orange juice", grams: 248 },
  ],
  ar: [
    { en: "Pita bread", grams: 60 },
    { en: "Hummus", grams: 30 },
    { en: "Arabic coffee (Qahwa)", grams: 60 },
  ],
  ja: [
    { en: "Onigiri", grams: 110 },
    { en: "Miso soup", grams: 240 },
    { en: "Green tea", grams: 240 },
  ],
};

/** "tr-TR", "pt_BR", "AR" -> a supported scene language; anything else -> en. */
export function sceneLang(locale: string): SceneLang {
  const base = String(locale).slice(0, 2).toLowerCase();
  return (SCENE_LANGS as readonly string[]).includes(base) ? (base as SceneLang) : "en";
}

/** The three scene foods for a locale (the screenshot compose scene). */
export function sceneFoods(locale: string): readonly SceneFood[] {
  return SCENES[sceneLang(locale)];
}

/** The English catalogue names offered as starters when the sheet is empty
 *  and the user has no recent or favourite foods yet. */
export function sceneStarters(locale: string): readonly string[] {
  return SCENES[sceneLang(locale)].map((f) => f.en);
}
