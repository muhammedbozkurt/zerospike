/**
 * The food catalog's own test: lib/db/seed.ts is data, not code, so nothing else
 * would ever notice a name that collides, a carbohydrate value that cannot be
 * true, or a diacritic that got mangled on the way in.
 *
 * It matters more than a data file usually would for two reasons. The carb value
 * is what a dose estimate is computed from, so a wrong one is wrong on a screen
 * the user acts on. And the English name is the KEY the top-up matches on
 * (syncSeedCatalog in lib/db/index.ts), so a duplicate there would either hide a
 * food from every existing install or show it twice.
 *
 * Run: npx tsx scripts/seed.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SEED_FOODS, type SeedFood } from "../lib/db/seed";
import { CATEGORIES } from "../lib/db/categories";
import { SEED_CATALOG_VERSION } from "../lib/db/seedVersion";

/* Source-pinned rather than imported: lib/db/foods.ts pulls in expo-sqlite and
 * react-native, which this Node harness cannot load. */
const FOOD_PAGE_SIZE = Number(
  /FOOD_PAGE_SIZE = (\d+)/.exec(
    readFileSync(join(__dirname, "../lib/db/foods.ts"), "utf8")
  )?.[1] ?? NaN
);

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
  }
}

/** Reports at most `limit` offenders, so one systemic slip is not 500 lines. */
function none(label: string, offenders: string[], limit = 8): void {
  if (offenders.length === 0) {
    passed++;
    return;
  }
  failed++;
  console.error(`  ✗ ${label}: ${offenders.length} offender(s)`);
  for (const o of offenders.slice(0, limit)) console.error(`      ${o}`);
  if (offenders.length > limit) console.error(`      ... and ${offenders.length - limit} more`);
}

const LANGS = ["tr", "en", "de", "es", "fr"] as const;
type Lang = (typeof LANGS)[number];

/** How a record identifies itself in a failure line. */
function label(f: SeedFood): string {
  return `${f.cat}/${f.en}`;
}

console.log("A. size and shape");

/** The floor the catalog is not allowed to fall back under. */
const MINIMUM_FOODS = 1100;
ok(
  `the catalog holds at least ${MINIMUM_FOODS} foods`,
  SEED_FOODS.length >= MINIMUM_FOODS,
  `${SEED_FOODS.length} foods`
);
console.log(`  (${SEED_FOODS.length} foods)`);

// A catalog that grew has to say so, or syncSeedCatalog never runs and the new
// foods reach nobody who already has the app.
ok("the catalog version is past its first release", SEED_CATALOG_VERSION >= 2);

console.log("\nB. every record is filled in, in all five languages");

for (const lang of LANGS) {
  none(
    `${lang} is present and non-blank everywhere`,
    SEED_FOODS.filter((f) => typeof f[lang] !== "string" || !f[lang].trim()).map(label)
  );
}
none(
  "no name carries stray or doubled whitespace",
  SEED_FOODS.flatMap((f) =>
    LANGS.filter((l) => f[l] !== f[l].trim() || /\s{2,}/.test(f[l])).map(
      (l) => `${label(f)} ${l}="${f[l]}"`
    )
  )
);

console.log("\nC. the numbers a dose is estimated from");

none(
  "carb per 100 g is a finite number in 0..100",
  SEED_FOODS.filter(
    (f) => typeof f.carb !== "number" || !Number.isFinite(f.carb) || f.carb < 0 || f.carb > 100
  ).map((f) => `${label(f)} carb=${String(f.carb)}`)
);
none(
  "glycemic index is a finite number in 0..110",
  SEED_FOODS.filter(
    (f) => typeof f.gi !== "number" || !Number.isFinite(f.gi) || f.gi < 0 || f.gi > 110
  ).map((f) => `${label(f)} gi=${String(f.gi)}`)
);
// A glycemic index on a food with no carbohydrate describes nothing, and its
// glycemic load would round to zero anyway.
none(
  "no glycemic index sits on a carb-free food",
  SEED_FOODS.filter((f) => f.carb === 0 && f.gi > 0).map(
    (f) => `${label(f)} carb=0 gi=${f.gi}`
  )
);
none(
  "the portion is a plausible single serving (10..1000 g)",
  SEED_FOODS.filter(
    (f) =>
      f.portion !== undefined &&
      (!Number.isFinite(f.portion) || f.portion < 10 || f.portion > 1000)
  ).map((f) => `${label(f)} portion=${String(f.portion)}`)
);
// Insertion computes round(gi * carb / 100); this is that value staying sane.
none(
  "the derived glycemic load stays within 0..100",
  SEED_FOODS.filter((f) => {
    const gl = Math.round((f.gi * f.carb) / 100);
    return gl < 0 || gl > 100;
  }).map(label)
);

console.log("\nD. categories");

const known = new Set<string>(CATEGORIES);
none(
  "every record is filed under one of the twelve shelves",
  SEED_FOODS.filter((f) => !known.has(f.cat)).map((f) => `${label(f)} cat=${String(f.cat)}`)
);
// "other" is the column default for things nobody classified. A seeded food was
// classified by definition, so it never belongs there.
none(
  'no seeded food is filed as "other"',
  SEED_FOODS.filter((f) => String(f.cat) === "other").map(label)
);
// An empty shelf is a shelf the user opens onto nothing.
const counts = new Map<string, number>();
for (const f of SEED_FOODS) counts.set(f.cat, (counts.get(f.cat) ?? 0) + 1);
none(
  "no shelf is thinly stocked (under 20 foods)",
  CATEGORIES.filter((c) => (counts.get(c) ?? 0) < 20).map(
    (c) => `${c} has ${counts.get(c) ?? 0}`
  )
);
console.log(
  `  (${CATEGORIES.map((c) => `${c} ${counts.get(c) ?? 0}`).join(", ")})`
);

console.log("\nE. names are unique within every language");

// Per LANGUAGE COLUMN, not across them: a proper-noun dish deliberately repeats
// the same name in all five fields, which is not a collision. Two rows sharing a
// name inside one column is, because that is the column the user reads and the
// one the top-up matches on.
//
// Checked under BOTH casing rules, because the two disagree in opposite
// directions on the Turkish dotted and dotless i: invariant lowercasing folds
// "I" onto "i" where Turkish folds it onto "ı", so a pair the one rule calls
// distinct the other can call identical. A name is only unique if it is unique
// under both, and the top-up keys on the invariant one (seedNameKey).
const CASING: [string, (s: string) => string][] = [
  ["invariant", (s) => s.trim().toLowerCase()],
  ["Turkish", (s) => s.trim().toLocaleLowerCase("tr")],
];
for (const lang of LANGS) {
  for (const [rule, fold] of CASING) {
    const seen = new Map<string, SeedFood>();
    const clashes: string[] = [];
    for (const f of SEED_FOODS) {
      const key = fold(f[lang]);
      const prev = seen.get(key);
      if (prev) clashes.push(`${lang} "${f[lang]}" (${label(f)} vs ${label(prev)})`);
      else seen.set(key, f);
    }
    none(`${lang} names are unique under ${rule} casing`, clashes);
  }
}

// The English column has one more duty than the others: it is the identity the
// top-up compares against a live database, so a blank one would match every
// other blank one.
none(
  "no English name is blank (it is the top-up's key)",
  SEED_FOODS.filter((f) => !f.en.trim()).map((f) => `${f.cat}/${f.tr}`)
);

console.log("\nF. characters");

// Em and en dashes are banned across the whole product, in every language.
const DASHES = /[‒–—―]/;
none(
  "no em or en dash anywhere",
  SEED_FOODS.flatMap((f) =>
    LANGS.filter((l) => DASHES.test(f[l])).map((l) => `${label(f)} ${l}="${f[l]}"`)
  )
);
// A replacement char or a lone combining mark means a name lost its diacritics
// somewhere between a source and this file.
const MOJIBAKE = /[�]|^\p{Mn}|Ã[-¿]|â€/u;
none(
  "no mojibake or replacement characters",
  SEED_FOODS.flatMap((f) =>
    LANGS.filter((l) => MOJIBAKE.test(f[l])).map((l) => `${label(f)} ${l}="${f[l]}"`)
  )
);
// Straight quotes would be fine, but curly ones are the tell of text pasted from
// a word processor, and they break search: a user types the straight one.
none(
  "no smart quotes",
  SEED_FOODS.flatMap((f) =>
    LANGS.filter((l) => /[‘’“”]/.test(f[l])).map(
      (l) => `${label(f)} ${l}="${f[l]}"`
    )
  )
);
// Every name is stored NFC, so the same word always produces the same key in the
// uniqueness check above and the same term in the FTS index.
none(
  "every name is unicode-normalized (NFC)",
  SEED_FOODS.flatMap((f) =>
    LANGS.filter((l) => f[l] !== f[l].normalize("NFC")).map(
      (l) => `${label(f)} ${l}="${f[l]}"`
    )
  )
);
// A name is a food, not a sentence, and never carries a number of grams: the
// carb figure is a field, and repeating it in the name would let the two drift.
none(
  "no name states its own nutrition",
  SEED_FOODS.flatMap((f) =>
    LANGS.filter((l) => /\d+\s*(g|kcal|kj)\b/i.test(f[l])).map(
      (l) => `${label(f)} ${l}="${f[l]}"`
    )
  )
);

console.log("\nG. the language each column is written in");

// Not a spell check: a Turkish-only letter appearing in the German column is how
// a copy/paste slip between columns shows up. Shared letters (ö, ü, é, ç) are
// excluded because every one of these languages uses them.
//
// The exemption that makes this usable: a Turkish dish keeps its Turkish
// spelling in every language ("Çiğ-Köfte-Wrap" is what a German menu writes), so
// a foreign letter is only suspicious when the name shares NO word with the
// Turkish one. That is the difference between a borrowed proper noun and a
// Turkish string that landed in the wrong column.
const FOREIGN: Record<Lang, RegExp | null> = {
  tr: null,
  en: null,
  de: /[ğışİ]/,
  es: /[ğışİß]/,
  fr: /[ğışİß]/,
};
function words(s: string): Set<string> {
  return new Set(
    s
      .toLocaleLowerCase("tr")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1)
  );
}
for (const lang of LANGS) {
  const pattern = FOREIGN[lang];
  if (!pattern) continue;
  none(
    `the ${lang} column carries no stray Turkish or German letters`,
    SEED_FOODS.filter((f) => {
      if (!pattern.test(f[lang])) return false;
      const turkish = words(f.tr);
      return ![...words(f[lang])].some((w) => turkish.has(w));
    }).map((f) => `${label(f)} ${lang}="${f[lang]}"`)
  );
}

// Turkish uses these constantly; a catalog this size without them would mean the
// diacritics were stripped wholesale.
const turkishDiacritics = SEED_FOODS.filter((f) => /[çğıöşüİ]/.test(f.tr)).length;
ok(
  "Turkish diacritics survived the file",
  turkishDiacritics > SEED_FOODS.length / 5,
  `${turkishDiacritics} of ${SEED_FOODS.length} Turkish names carry one`
);
const germanDiacritics = SEED_FOODS.filter((f) => /[äöüß]/.test(f.de)).length;
ok("German umlauts survived the file", germanDiacritics > 60, `${germanDiacritics} names`);
const frenchDiacritics = SEED_FOODS.filter((f) => /[éèêàçîôû]/.test(f.fr)).length;
ok("French accents survived the file", frenchDiacritics > 60, `${frenchDiacritics} names`);
const spanishDiacritics = SEED_FOODS.filter((f) => /[áéíóúñ]/.test(f.es)).length;
ok("Spanish accents survived the file", spanishDiacritics > 60, `${spanishDiacritics} names`);

console.log("\nH. the aliases the search index is built from");

// lib/db/index.ts derives aliases_json from the five names, deduped and
// lowercased. Every food has to contribute at least one searchable term.
none(
  "every food yields at least one alias",
  SEED_FOODS.filter((f) => {
    const set = new Set(
      LANGS.map((l) => f[l].trim().toLowerCase()).filter((s) => s.length > 0)
    );
    return set.size === 0;
  }).map(label)
);

// The category drill-down pulls ONE page of FOOD_PAGE_SIZE rows and shows the
// grid tile's full COUNT next to it. If any category ever outgrows the page,
// the tail of the alphabet silently becomes reachable only through search.
{
  const counts = new Map<string, number>();
  for (const f of SEED_FOODS) counts.set(f.cat, (counts.get(f.cat) ?? 0) + 1);
  none(
    `every category fits one page (FOOD_PAGE_SIZE=${FOOD_PAGE_SIZE})`,
    [...counts.entries()]
      .filter(([, n]) => n >= FOOD_PAGE_SIZE)
      .map(([cat, n]) => `${cat}: ${n}`)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
