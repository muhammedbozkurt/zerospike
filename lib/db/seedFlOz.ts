/**
 * Grams per US fluid ounce for the catalog's liquids, so the meal-card chips
 * can say "1 glass (8 fl oz)" in the US and "1 glass (237 ml)" elsewhere in
 * English (lib/portionUnits). Keyed by the catalog's English name.
 *
 * Every figure is the USDA FoodData Central household measure "1 fl oz" of the
 * same drink (SR Legacy where it exists, FNDDS otherwise); the FDC id is the
 * second tuple member. A liquid USDA has no fl oz measure for is not listed and
 * keeps the plain gram caption: nothing here is a density guess. Display only:
 * it is not stored, so it needs no migration and no catalog version bump.
 */
type FlOzEntry = readonly [gramsPerFlOz: number, fdcId: string];

export const FL_OZ_GRAMS: Readonly<Record<string, FlOzEntry>> = {
  Milk: [30.5, "SR171265"],
  "Whole milk": [30.5, "SR171265"],
  "Semi-skimmed milk": [30.5, "SR171267"],
  "Skimmed milk": [30.6, "SR171269"],
  "Lactose-free milk": [30.5, "FN2705392"],
  "Goat milk": [30.5, "SR171278"],
  Buttermilk: [30.6, "SR170874"],
  "Almond milk": [30, "SR168751"],
  "Soy milk": [30.6, "SR172446"],
  "Oat milk": [30.5, "FN2705412"],
  "Rice milk": [30.5, "FN2705411"],
  Kefir: [30.5, "FN2705394"],
  "Chocolate milk": [31.2, "SR170879"],
  "Evaporated milk": [31.5, "SR171276"],
  "Tomato juice": [30.4, "SR170545"],
  "Orange juice": [31.1, "SR169099"],
  "Apple juice": [31, "SR167771"],
  "Grape juice": [31.6, "SR168207"],
  "Pineapple juice": [31.3, "SR168187"],
  "Carrot juice": [29.5, "SR170491"],
  "Pomegranate juice": [31.4, "SR167787"],
  "Peach nectar": [31, "FN2709346"],
  Lemonade: [31, "FN2710570"],
  "Coconut water": [30, "FN2707572"],
  "Fruit smoothie": [27, "FN2705513"],
  Milkshake: [28, "FN2705504"],
  "Hot chocolate": [31, "FN2705472"],
  Cola: [30.7, "SR174852"],
  "Sugar-free cola": [29.6, "SR171876"],
  "Orange soda": [31, "SR174854"],
  "Lemon-lime soda": [30.8, "SR173205"],
  "Tonic water": [30.5, "SR171869"],
  "Energy drink": [31, "FN2710752"],
  "Sports drink": [31, "FN2710771"],
  Kombucha: [31, "FN2710509"],
  "Filter coffee": [29.6, "SR171890"],
  Espresso: [29.6, "SR171891"],
  Americano: [29.6, "SR171890"],
  Cappuccino: [30, "FN2710472"],
  "Caffè latte": [30, "FN2710386"],
  "Iced coffee": [30, "FN2710428"],
  "Tea (unsweetened)": [29.6, "SR173227"],
  "Green tea": [29.6, "SR171917"],
  Beer: [29.7, "SR168746"],
  "Alcohol-free beer": [29.6, "SR174863"],
  "Red wine": [29.4, "SR173190"],
  "White wine": [29.4, "SR174837"],
  "Sparkling wine": [30, "FN2710687"],
};

/** Grams per fl oz of a catalog liquid, or null for a solid, a custom food or
 *  a drink USDA has no fl oz measure for. */
export function flOzGramsFor(nameEn: string | null | undefined): number | null {
  if (!nameEn) return null;
  const hit = Object.prototype.hasOwnProperty.call(FL_OZ_GRAMS, nameEn)
    ? FL_OZ_GRAMS[nameEn]
    : undefined;
  return hit ? hit[0] : null;
}
