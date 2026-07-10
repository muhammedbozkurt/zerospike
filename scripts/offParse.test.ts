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
  nutriments: { carbohydrates_100g: 57.5, carbohydrates_unit: "g" },
  serving_quantity: 15,
};
eq("a complete product parses", parseOffProduct("3017624010701", nutella), {
  barcode: "3017624010701",
  name: "Nutella",
  brand: "Ferrero",
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
  { barcode: "40084022", name: "Test", brand: null, carb100g: 12.5, portionG: 30 }
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

console.log("\nattribution");
eq("the off source is credited", foodSourceLabel("off"), OFF_ATTRIBUTION);
eq("an unknown source shows verbatim", foodSourceLabel("usda"), "usda");

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
