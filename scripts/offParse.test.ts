/**
 * Standalone, dependency-free harness for the Open Food Facts parsing boundary.
 * No jest; compile + run with node:
 *
 *   npx tsc scripts/offParse.test.ts lib/services/offParse.ts --ignoreConfig \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution bundler --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/offParse.test.js
 *
 * This is where untrusted third-party JSON becomes a carbohydrate figure that
 * feeds an insulin estimate. Anything it cannot vouch for must come back null
 * so the scanner falls into the manual "add a new food" flow instead.
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  foodSourceLabel,
  isProductBarcode,
  mapOffCategory,
  parseOffProduct,
  OFF_ATTRIBUTION,
} from "../lib/services/offParse";

let failures = 0;

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}: expected ${e}, got ${a}`);
  }
}

/** The shape every `names` assertion compares against: one entry per app
 *  language, in NAME_FIELDS order, so a language quietly dropped from that list
 *  fails a test rather than silently costing that locale its own name. */
function allNames(n: {
  tr: string;
  en: string;
  de: string;
  es: string;
  fr: string;
  it: string;
  pt: string;
  ar: string;
  ja: string;
}) {
  return n;
}

/** Every language reading the same name: the single-name product's shape. */
function sameName(name: string) {
  return allNames({
    tr: name,
    en: name,
    de: name,
    es: name,
    fr: name,
    it: name,
    pt: name,
    ar: name,
    ja: name,
  });
}

console.log("barcode shape");

eq("EAN-13 is a product barcode", isProductBarcode("3017624010701"), true);
eq("EAN-8 is a product barcode", isProductBarcode("40084022"), true);
eq("surrounding whitespace is tolerated", isProductBarcode(" 40084022 "), true);
// A QR payload must never be sent to a third party as if it were a barcode.
eq("a URL is not a product barcode", isProductBarcode("https://example.com"), false);
eq("Code39 text is not a product barcode", isProductBarcode("ABC-123"), false);
eq("too short is not a product barcode", isProductBarcode("12345"), false);
eq("too long is not a product barcode", isProductBarcode("123456789012345"), false);
eq("empty is not a product barcode", isProductBarcode(""), false);

console.log("\nproduct parsing");

// The shape the live API actually returns (verified against openfoodfacts.org).
const nutella = {
  product_name: "Nutella",
  brands: "Ferrero",
  categories_tags: [
    "en:breakfasts",
    "en:spreads",
    "en:sweet-spreads",
    "en:chocolate-spreads",
  ],
  nutriments: { carbohydrates_100g: 57.5, carbohydrates_unit: "g" },
  serving_quantity: 15,
};
eq("a complete product parses", parseOffProduct("3017624010701", nutella), {
  barcode: "3017624010701",
  name: "Nutella",
  names: sameName("Nutella"),
  brand: "Ferrero",
  category: "sweets",
  carb100g: 57.5,
  portionG: 15,
});

// Open Food Facts sometimes serialises numbers as strings.
eq(
  "numeric strings are accepted",
  parseOffProduct("40084022", {
    product_name: "Test",
    nutriments: { carbohydrates_100g: "12.5" },
    serving_quantity: "30",
  }),
  {
    barcode: "40084022",
    name: "Test",
    names: sameName("Test"),
    brand: null,
    category: "other",
    carb100g: 12.5,
    portionG: 30,
  }
);

eq(
  "a comma decimal is accepted",
  parseOffProduct("40084022", {
    product_name: "Test",
    nutriments: { carbohydrates_100g: "12,5" },
  })?.carb100g,
  12.5
);

// Zero carbohydrate is a real, usable value (water, diet soda). Not a miss.
eq(
  "zero carbohydrate is a valid product",
  parseOffProduct("40084022", {
    product_name: "Water",
    nutriments: { carbohydrates_100g: 0 },
  })?.carb100g,
  0
);

console.log("\nunusable products come back null");

eq("no payload", parseOffProduct("40084022", undefined), null);
eq("null payload", parseOffProduct("40084022", null), null);
eq("a string payload", parseOffProduct("40084022", "nope"), null);
eq(
  "no name",
  parseOffProduct("40084022", { nutriments: { carbohydrates_100g: 10 } }),
  null
);
eq(
  "a blank name",
  parseOffProduct("40084022", {
    product_name: "   ",
    nutriments: { carbohydrates_100g: 10 },
  }),
  null
);
eq("no nutriments at all", parseOffProduct("40084022", { product_name: "X" }), null);
eq(
  "no carbohydrate figure",
  parseOffProduct("40084022", { product_name: "X", nutriments: { fat_100g: 3 } }),
  null
);
eq(
  "a non-numeric carbohydrate figure",
  parseOffProduct("40084022", {
    product_name: "X",
    nutriments: { carbohydrates_100g: "unknown" },
  }),
  null
);
// More than 100 g of carbohydrate in 100 g of food is impossible; refuse it
// rather than feed it to a dose estimate.
eq(
  "an impossible carbohydrate figure",
  parseOffProduct("40084022", {
    product_name: "X",
    nutriments: { carbohydrates_100g: 140 },
  }),
  null
);
eq(
  "a negative carbohydrate figure",
  parseOffProduct("40084022", {
    product_name: "X",
    nutriments: { carbohydrates_100g: -5 },
  }),
  null
);

console.log("\nserving size falls back to 100 g");

const noServing = { product_name: "X", nutriments: { carbohydrates_100g: 10 } };
eq("absent serving", parseOffProduct("40084022", noServing)?.portionG, 100);
eq(
  "zero serving",
  parseOffProduct("40084022", { ...noServing, serving_quantity: 0 })?.portionG,
  100
);
eq(
  "an absurd serving",
  parseOffProduct("40084022", { ...noServing, serving_quantity: 5000 })?.portionG,
  100
);
eq(
  "a plausible serving is kept",
  parseOffProduct("40084022", { ...noServing, serving_quantity: 330 })?.portionG,
  330
);

console.log("\nper-language names");

// The product carries its own translations; each column gets the right one.
const multi = {
  product_name: "Vollkornbrot",
  product_name_de: "Vollkornbrot",
  product_name_tr: "Tam buğday ekmeği",
  product_name_en: "Wholemeal bread",
  product_name_fr: "Pain complet",
  product_name_es: "Pan integral",
  nutriments: { carbohydrates_100g: 41 },
};
eq(
  "every translated name is kept",
  parseOffProduct("40084022", multi)?.names,
  allNames({
    tr: "Tam buğday ekmeği",
    en: "Wholemeal bread",
    de: "Vollkornbrot",
    es: "Pan integral",
    fr: "Pain complet",
    // No it/pt/ar/ja on this product: they fall back to the main name.
    it: "Vollkornbrot",
    pt: "Vollkornbrot",
    ar: "Vollkornbrot",
    ja: "Vollkornbrot",
  })
);

// The four languages the catalogue has no column for are parsed all the same;
// lib/db/foods stores them as search aliases so the scan is findable in them.
eq(
  "the column-less languages are kept too",
  parseOffProduct("40084022", {
    product_name: "Rice",
    product_name_it: "Riso",
    product_name_pt: "Arroz",
    product_name_ar: "أرز",
    product_name_ja: "米",
    nutriments: { carbohydrates_100g: 80 },
  })?.names,
  allNames({
    tr: "Rice",
    en: "Rice",
    de: "Rice",
    es: "Rice",
    fr: "Rice",
    it: "Riso",
    pt: "Arroz",
    ar: "أرز",
    ja: "米",
  })
);

// A missing or blank translation falls back to the product's main name, which is
// exactly what a single-name product used to get in every column.
eq(
  "a missing translation falls back to the main name",
  parseOffProduct("40084022", {
    product_name: "Ayran",
    product_name_tr: "Ayran",
    product_name_de: "  ",
    product_name_fr: "",
    nutriments: { carbohydrates_100g: 4 },
  })?.names,
  sameName("Ayran")
);

// A product whose only name is a translated one is still a named product.
eq(
  "a translated name alone is enough",
  parseOffProduct("40084022", {
    product_name_fr: "Yaourt nature",
    nutriments: { carbohydrates_100g: 5 },
  })?.name,
  "Yaourt nature"
);
eq(
  "and it fills the other columns",
  parseOffProduct("40084022", {
    product_name: "   ",
    product_name_tr: "Sade yoğurt",
    nutriments: { carbohydrates_100g: 5 },
  })?.names,
  sameName("Sade yoğurt")
);
// Names are not nutrition: a non-string in a name field is ignored, never coerced.
eq(
  "a non-string translation is ignored",
  parseOffProduct("40084022", {
    product_name: "Su",
    product_name_de: 42,
    product_name_fr: { a: 1 },
    product_name_ja: ["米"],
    nutriments: { carbohydrates_100g: 0 },
  })?.names,
  sameName("Su")
);

console.log("\ncategory tags map to a shelf");

eq("bread is bakery", mapOffCategory(["en:plant-based-foods", "en:breads"]), "bakery");
eq("cheese is dairy", mapOffCategory(["en:dairies", "en:cheeses"]), "dairy");
eq("soda is a beverage", mapOffCategory(["en:beverages", "en:sodas"]), "beverages");
eq("canned fish is protein", mapOffCategory(["en:canned-fishes"]), "protein");
eq("dried fruit is fruit", mapOffCategory(["en:fruits", "en:dried-fruits"]), "fruits");
eq("pasta is a staple", mapOffCategory(["en:cereals-and-potatoes", "en:pastas"]), "staples");
eq("hummus is a legume", mapOffCategory(["en:legumes", "en:hummus"]), "legumes");
eq("a frozen pizza is a dish", mapOffCategory(["en:meals", "en:pizzas"]), "dishes");
eq("a burger is fast food", mapOffCategory(["en:fast-food", "en:hamburgers"]), "fastfood");
eq("pickles are vegetables", mapOffCategory(["en:vegetables", "en:pickles"]), "vegetables");
eq("almonds are nuts", mapOffCategory(["en:nuts", "en:almonds"]), "nuts");

// The tag list runs general to specific, so the LAST thing we recognise wins.
eq(
  "the most specific recognised tag wins",
  mapOffCategory(["en:beverages", "en:dairies", "en:milks", "en:yogurts"]),
  "dairy"
);
// A tag we do not know sits between two we do; the specific known one still wins.
eq(
  "an unknown tag does not stop the search",
  mapOffCategory(["en:snacks", "en:some-brand-new-tag", "en:biscuits"]),
  "sweets"
);

// Contributors tag in their own language; the locale prefix is not the product.
eq("a non-English tag prefix is stripped", mapOffCategory(["fr:fromages"]), "dairy");
eq("a tag with no prefix still matches", mapOffCategory(["breads"]), "bakery");
eq("casing and padding are tolerated", mapOffCategory(["  EN:Breads "]), "bakery");

// Word matching for the tags the exact table misses, in the order that keeps a
// broader word from swallowing a narrower one.
eq(
  "milk chocolate is a sweet, not dairy",
  mapOffCategory(["en:snacks", "en:milk-chocolates"]),
  "sweets"
);
eq("a fruit juice is a drink, not fruit", mapOffCategory(["en:orange-juices"]), "beverages");
eq("peanut butter is a nut, not dairy", mapOffCategory(["en:peanut-butters"]), "nuts");

console.log("\nunrecognised or broken tags mean 'other', never a guess");

eq("no tags at all", mapOffCategory(undefined), "other");
eq("null tags", mapOffCategory(null), "other");
eq("a string instead of a list", mapOffCategory("en:breads"), "other");
eq("an empty list", mapOffCategory([]), "other");
eq("nothing recognised", mapOffCategory(["en:zzz", "en:qqq"]), "other");
eq("non-string entries", mapOffCategory([1, null, {}, ["en:breads"]]), "other");
eq("blank entries", mapOffCategory(["", "  ", "en:"]), "other");
eq(
  "a product with no tags field lands on the column default",
  parseOffProduct("40084022", {
    product_name: "X",
    nutriments: { carbohydrates_100g: 10 },
  })?.category,
  "other"
);

console.log("\nattribution");
eq("the off source is credited", foodSourceLabel("off"), OFF_ATTRIBUTION);
eq("an unknown source shows verbatim", foodSourceLabel("usda"), "usda");

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
