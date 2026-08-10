/**
 * Pure parsing for Open Food Facts barcode results. Kept free of network and
 * React Native imports so it can be exercised by a standalone harness: this is
 * the boundary where untrusted third-party JSON becomes a carbohydrate figure
 * that feeds an insulin estimate, so it validates rather than trusts.
 *
 * The network call lives in lib/services/openFoodFacts.ts.
 */

import { isFoodCategory, type FoodCategory } from "../db/categories";

/** Where a cached food row came from, stored in foods.source. */
export const OFF_SOURCE = "off";

/** Human-readable attribution shown next to a food we did not author. */
export const OFF_ATTRIBUTION = "Open Food Facts";

/** Carbohydrate content per 100 g cannot exceed 100 g. */
const MAX_CARB_100G = 100;

/** A serving larger than this is data we do not trust as a default portion. */
const MAX_SERVING_G = 2000;

/** The product name in each of the app's five languages. */
export interface OffNames {
  tr: string;
  en: string;
  de: string;
  es: string;
  fr: string;
}

export interface OffProduct {
  barcode: string;
  /** The name to show and to fall back on; never empty. */
  name: string;
  /** Per-language names, each falling back to `name`. */
  names: OffNames;
  brand: string | null;
  /** Best-effort shelf from the product's tags; "other" when nothing matched. */
  category: FoodCategory;
  /** grams of carbohydrate per 100 g of product */
  carb100g: number;
  /** typical serving in grams; 100 when the product does not state a usable one */
  portionG: number;
}

/**
 * Open Food Facts is keyed by numeric EAN/UPC codes. The scanner also reads QR
 * and Code39, whose payloads are not product barcodes; querying with those
 * would send whatever text they contain to a third party, so they never leave
 * the device.
 */
export function isProductBarcode(code: string): boolean {
  return /^[0-9]{6,14}$/.test(code.trim());
}

/**
 * Display name for a `foods.source` value. Attribution is a factual credit, not
 * translated copy, so it reads the same in every language. An unrecognised
 * source shows verbatim rather than being silently hidden.
 */
export function foodSourceLabel(source: string): string {
  return source === OFF_SOURCE ? OFF_ATTRIBUTION : source;
}

/** Open Food Facts reports numbers as either a number or a numeric string. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * An Open Food Facts tag is `locale:slug` ("en:breads", "fr:pains"). Both halves
 * are kept: the slug is what gets matched, but the locale cannot simply be
 * thrown away, because the same slug means different things in different
 * languages. "legumes" is pulses in English and vegetables in French.
 */
function tagParts(tag: unknown): { full: string; slug: string } | null {
  if (typeof tag !== "string") return null;
  const full = tag.trim().toLowerCase();
  if (!full) return null;
  const colon = full.indexOf(":");
  const slug = colon === -1 ? full : full.slice(colon + 1);
  return slug ? { full, slug } : null;
}

/**
 * Exact tag → shelf. These are the slugs Open Food Facts actually attaches to
 * everyday supermarket products, so an exact hit is the confident answer and is
 * tried before the looser word matching below.
 */
const OFF_TAG_CATEGORY: Record<string, FoodCategory> = {
  // bakery
  breads: "bakery",
  bread: "bakery",
  baguettes: "bakery",
  "sandwich-breads": "bakery",
  "wholemeal-breads": "bakery",
  "sliced-breads": "bakery",
  toasts: "bakery",
  rusks: "bakery",
  crispbreads: "bakery",
  viennoiserie: "bakery",
  croissants: "bakery",
  brioches: "bakery",
  bagels: "bakery",
  pretzels: "bakery",
  tortillas: "bakery",
  "pita-breads": "bakery",
  breadcrumbs: "bakery",
  // dairy
  dairies: "dairy",
  "dairy-products": "dairy",
  milks: "dairy",
  cheeses: "dairy",
  "fresh-cheeses": "dairy",
  yogurts: "dairy",
  yoghurts: "dairy",
  "fermented-milk-products": "dairy",
  creams: "dairy",
  butters: "dairy",
  // beverages
  beverages: "beverages",
  drinks: "beverages",
  waters: "beverages",
  "spring-waters": "beverages",
  "sparkling-waters": "beverages",
  sodas: "beverages",
  "carbonated-drinks": "beverages",
  "sugary-drinks": "beverages",
  "fruit-juices": "beverages",
  juices: "beverages",
  nectars: "beverages",
  teas: "beverages",
  "iced-teas": "beverages",
  coffees: "beverages",
  "energy-drinks": "beverages",
  "sports-drinks": "beverages",
  "alcoholic-beverages": "beverages",
  beers: "beverages",
  wines: "beverages",
  spirits: "beverages",
  "plant-based-milk-alternatives": "beverages",
  "plant-based-beverages": "beverages",
  // sweets
  "sweet-snacks": "sweets",
  chocolates: "sweets",
  "chocolate-spreads": "sweets",
  confectioneries: "sweets",
  candies: "sweets",
  biscuits: "sweets",
  "biscuits-and-cakes": "sweets",
  cakes: "sweets",
  desserts: "sweets",
  "frozen-desserts": "sweets",
  "ice-creams": "sweets",
  "ice-cream": "sweets",
  jams: "sweets",
  honeys: "sweets",
  sugars: "sweets",
  // nuts
  nuts: "nuts",
  "nuts-and-their-products": "nuts",
  almonds: "nuts",
  hazelnuts: "nuts",
  walnuts: "nuts",
  peanuts: "nuts",
  pistachios: "nuts",
  cashews: "nuts",
  "peanut-butters": "nuts",
  seeds: "nuts",
  "sunflower-seeds": "nuts",
  "sesame-seeds": "nuts",
  // legumes
  legumes: "legumes",
  "legumes-and-their-products": "legumes",
  pulses: "legumes",
  lentils: "legumes",
  chickpeas: "legumes",
  beans: "legumes",
  "canned-legumes": "legumes",
  hummus: "legumes",
  // vegetables
  vegetables: "vegetables",
  "vegetables-and-their-products": "vegetables",
  "fresh-vegetables": "vegetables",
  "canned-vegetables": "vegetables",
  "frozen-vegetables": "vegetables",
  pickles: "vegetables",
  olives: "vegetables",
  "tomato-products": "vegetables",
  salads: "vegetables",
  // fruits
  fruits: "fruits",
  "fruits-and-their-products": "fruits",
  "fresh-fruits": "fruits",
  "dried-fruits": "fruits",
  "canned-fruits": "fruits",
  compotes: "fruits",
  // protein
  meats: "protein",
  "meats-and-their-products": "protein",
  poultry: "protein",
  hams: "protein",
  sausages: "protein",
  charcuteries: "protein",
  fishes: "protein",
  "fishes-and-their-products": "protein",
  seafood: "protein",
  "canned-fishes": "protein",
  eggs: "protein",
  tofu: "protein",
  "meat-analogues": "protein",
  // staples
  cereals: "staples",
  "cereals-and-their-products": "staples",
  "breakfast-cereals": "staples",
  pastas: "staples",
  "dried-pastas": "staples",
  noodles: "staples",
  rices: "staples",
  rice: "staples",
  flours: "staples",
  semolinas: "staples",
  couscous: "staples",
  potatoes: "staples",
  // dishes
  meals: "dishes",
  "prepared-meals": "dishes",
  "ready-made-meals": "dishes",
  "canned-meals": "dishes",
  "frozen-meals": "dishes",
  soups: "dishes",
  pizzas: "dishes",
  // fast food
  "fast-food": "fastfood",
  hamburgers: "fastfood",
  sandwiches: "fastfood",
  "french-fries": "fastfood",
  kebabs: "fastfood",
  "hot-dogs": "fastfood",
  wraps: "fastfood",
};

/**
 * Tags whose meaning depends on the language that contributed them, so these are
 * matched on the WHOLE tag rather than on the slug. The trap this exists for:
 * "fr:legumes" is vegetables and "en:legumes" is pulses, and stripping the
 * locale would file every French vegetable under beans.
 *
 * Only the shelves a European supermarket product actually lands on. Everything
 * else falls through to the English table and then to word matching, which is
 * the honest behaviour for a taxonomy we do not own.
 */
const OFF_LOCALE_TAG_CATEGORY: Record<string, FoodCategory> = {
  // French
  "fr:legumes": "vegetables",
  "fr:fruits": "fruits",
  "fr:pains": "bakery",
  "fr:viennoiseries": "bakery",
  "fr:fromages": "dairy",
  "fr:laits": "dairy",
  "fr:yaourts": "dairy",
  "fr:boissons": "beverages",
  "fr:eaux": "beverages",
  "fr:jus-de-fruits": "beverages",
  "fr:viandes": "protein",
  "fr:poissons": "protein",
  "fr:oeufs": "protein",
  "fr:charcuteries": "protein",
  "fr:pates": "staples",
  "fr:riz": "staples",
  "fr:plats-prepares": "dishes",
  "fr:soupes": "dishes",
  // German
  "de:brot": "bakery",
  "de:brote": "bakery",
  "de:backwaren": "bakery",
  "de:kase": "dairy",
  "de:milch": "dairy",
  "de:joghurt": "dairy",
  "de:getranke": "beverages",
  "de:wasser": "beverages",
  "de:fleisch": "protein",
  "de:wurst": "protein",
  "de:fisch": "protein",
  "de:eier": "protein",
  "de:nudeln": "staples",
  "de:reis": "staples",
  "de:gemuse": "vegetables",
  "de:obst": "fruits",
  "de:susswaren": "sweets",
  "de:fertiggerichte": "dishes",
  // Spanish
  "es:panes": "bakery",
  "es:quesos": "dairy",
  "es:leches": "dairy",
  "es:yogures": "dairy",
  "es:bebidas": "beverages",
  "es:aguas": "beverages",
  "es:zumos": "beverages",
  "es:carnes": "protein",
  "es:pescados": "protein",
  "es:huevos": "protein",
  "es:embutidos": "protein",
  "es:arroces": "staples",
  "es:verduras": "vegetables",
  "es:hortalizas": "vegetables",
  "es:frutas": "fruits",
  "es:legumbres": "legumes",
  "es:platos-preparados": "dishes",
  // Turkish
  "tr:ekmek": "bakery",
  "tr:peynir": "dairy",
  "tr:sut": "dairy",
  "tr:yogurt": "dairy",
  "tr:icecekler": "beverages",
  "tr:su": "beverages",
  "tr:et": "protein",
  "tr:balik": "protein",
  "tr:yumurta": "protein",
  "tr:sebzeler": "vegetables",
  "tr:meyveler": "fruits",
  "tr:bakliyat": "legumes",
  "tr:makarna": "staples",
  "tr:pirinc": "staples",
};

/**
 * Looser matching for the tags the exact tables miss ("en:milk-chocolates",
 * "en:whole-milk-yogurts"). The slug is split on its hyphens and a needle has to
 * START one of those words, which is what keeps a needle from firing on a
 * fragment: "chocolates" is not a cola and "steaks" is not a tea.
 *
 * ORDER IS THE RULE: the first needle that matches wins, so anything a broader
 * word would swallow has to come first. "fruit-juice" reads as a drink before it
 * reads as fruit, "milk-chocolate" as a sweet before "milk" makes it dairy, and
 * "peanut-butter" as a nut before "butter" does.
 */
const OFF_TAG_WORDS: readonly [string, FoodCategory][] = [
  ["juice", "beverages"],
  ["soda", "beverages"],
  ["nectar", "beverages"],
  ["smoothie", "beverages"],
  ["lemonade", "beverages"],
  ["water", "beverages"],
  ["beer", "beverages"],
  ["wine", "beverages"],
  ["cola", "beverages"],
  ["coffee", "beverages"],
  ["tea", "beverages"],
  ["drink", "beverages"],
  ["beverage", "beverages"],
  ["peanut", "nuts"],
  ["almond", "nuts"],
  ["hazelnut", "nuts"],
  ["walnut", "nuts"],
  ["pistachio", "nuts"],
  ["cashew", "nuts"],
  ["nut", "nuts"],
  ["seed", "nuts"],
  ["chocolate", "sweets"],
  ["biscuit", "sweets"],
  ["cookie", "sweets"],
  ["candy", "sweets"],
  ["dessert", "sweets"],
  ["cake", "sweets"],
  ["wafer", "sweets"],
  ["jam", "sweets"],
  ["honey", "sweets"],
  ["sugar", "sweets"],
  ["burger", "fastfood"],
  ["sandwich", "fastfood"],
  ["fries", "fastfood"],
  ["kebab", "fastfood"],
  ["nugget", "fastfood"],
  ["yogurt", "dairy"],
  ["yoghurt", "dairy"],
  ["cheese", "dairy"],
  ["milk", "dairy"],
  ["cream", "dairy"],
  ["butter", "dairy"],
  ["dairy", "dairy"],
  ["lentil", "legumes"],
  ["chickpea", "legumes"],
  ["bean", "legumes"],
  ["legume", "legumes"],
  ["bread", "bakery"],
  ["baguette", "bakery"],
  ["croissant", "bakery"],
  ["brioche", "bakery"],
  ["pastr", "bakery"],
  ["pasta", "staples"],
  ["spaghetti", "staples"],
  ["noodle", "staples"],
  ["rice", "staples"],
  ["flour", "staples"],
  ["cereal", "staples"],
  ["potato", "staples"],
  ["oat", "staples"],
  ["meat", "protein"],
  ["chicken", "protein"],
  ["beef", "protein"],
  ["pork", "protein"],
  ["ham", "protein"],
  ["sausage", "protein"],
  ["fish", "protein"],
  ["tuna", "protein"],
  ["salmon", "protein"],
  ["egg", "protein"],
  ["tofu", "protein"],
  ["vegetable", "vegetables"],
  ["tomato", "vegetables"],
  ["olive", "vegetables"],
  ["salad", "vegetables"],
  ["fruit", "fruits"],
  ["pizza", "dishes"],
  ["soup", "dishes"],
  ["meal", "dishes"],
];

/**
 * Best-effort shelf for an Open Food Facts product from its `categories_tags`.
 *
 * The list runs general to specific ("en:plant-based-foods", then
 * "en:cereals-and-potatoes", then "en:breads"), so it is read BACKWARDS: the most
 * specific tag that we recognise is the most informative one. Nothing recognised
 * means "other" rather than a guess, which is also what the column defaults to.
 *
 * A wrong shelf is cosmetic (it decides an emoji and which list the row appears
 * in) and never touches a carbohydrate figure, so best-effort is the right bar
 * here in a way it would not be for the nutrition fields.
 */
export function mapOffCategory(rawTags: unknown): FoodCategory {
  if (!Array.isArray(rawTags)) return "other";
  const tags: { full: string; slug: string }[] = [];
  for (const tag of rawTags) {
    const parts = tagParts(tag);
    if (parts) tags.push(parts);
  }

  // Most confident first: a tag whose language we accounted for, then a slug we
  // know outright, then a word inside one. Each pass walks the whole list before
  // the next begins, so a confident hit anywhere beats a loose hit anywhere.
  for (let i = tags.length - 1; i >= 0; i--) {
    const hit = OFF_LOCALE_TAG_CATEGORY[tags[i].full];
    if (hit && isFoodCategory(hit)) return hit;
  }
  for (let i = tags.length - 1; i >= 0; i--) {
    const hit = OFF_TAG_CATEGORY[tags[i].slug];
    if (hit && isFoodCategory(hit)) return hit;
  }
  for (let i = tags.length - 1; i >= 0; i--) {
    const words = tags[i].slug.split("-");
    for (const [needle, category] of OFF_TAG_WORDS) {
      if (words.some((w) => w.startsWith(needle))) return category;
    }
  }
  return "other";
}

/** The five per-language product name fields, in column order. */
const NAME_FIELDS: readonly [keyof OffNames, string][] = [
  ["tr", "product_name_tr"],
  ["en", "product_name_en"],
  ["de", "product_name_de"],
  ["es", "product_name_es"],
  ["fr", "product_name_fr"],
];

/**
 * Maps a raw product payload onto what the calculator needs, or null when the
 * product is unusable: no name at all, or no trustworthy carbohydrate figure. A
 * missing serving size is not a failure; it falls back to 100 g, and a missing
 * translation falls back to the product's main name rather than to a blank.
 *
 * Open Food Facts carries no glycemic index and this does not invent one.
 */
export function parseOffProduct(barcode: string, raw: unknown): OffProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const product = raw as Record<string, unknown>;

  // The generic `product_name` is what the contributors filled in first, so it
  // leads. A product that only ever got a translated name is still a named
  // product; only one with no name anywhere is unusable.
  let name = trimmedString(product.product_name);
  if (!name) {
    for (const [, field] of NAME_FIELDS) {
      name = trimmedString(product[field]);
      if (name) break;
    }
  }
  if (!name) return null;

  const nutriments =
    product.nutriments && typeof product.nutriments === "object"
      ? (product.nutriments as Record<string, unknown>)
      : {};

  const carb100g = toNumber(nutriments.carbohydrates_100g);
  if (carb100g === null || carb100g < 0 || carb100g > MAX_CARB_100G) return null;

  const serving = toNumber(product.serving_quantity);
  const portionG =
    serving !== null && serving > 0 && serving <= MAX_SERVING_G ? serving : 100;

  const names = { tr: name, en: name, de: name, es: name, fr: name } as OffNames;
  for (const [lang, field] of NAME_FIELDS) {
    names[lang] = trimmedString(product[field]) ?? name;
  }

  return {
    barcode: barcode.trim(),
    name,
    names,
    brand: trimmedString(product.brands),
    category: mapOffCategory(product.categories_tags),
    carb100g,
    portionG,
  };
}
