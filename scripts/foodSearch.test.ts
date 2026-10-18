/**
 * Food search ranking and matching (lib/foodSearch): accents, Turkish i/I,
 * German digraphs, synonyms, prefix tiers, staples and the logged-first rule,
 * run against the real seed catalogue. The SQL side in lib/db/foods.ts needs
 * expo-sqlite, so candidates are taken here by the same folded matcher the
 * scan fallback uses.
 *
 * Run: npx tsx scripts/foodSearch.test.ts
 */
import { SEED_FOODS } from "../lib/db/seed";
import { foodName } from "../lib/db/types";
import type { Food, Lang } from "../lib/db/types";
import {
  SYNONYM_GROUPS,
  fold,
  foodMatchesAny,
  queryVariants,
  rankFoods,
  synonymAlternates,
  usageScore,
  type FoodUsage,
} from "../lib/foodSearch";
import { LOCAL_STAPLE_COUNTS, isLocalStaple, localStapleNamesEn } from "../lib/foodMeta";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const FOODS: Food[] = SEED_FOODS.map(
  (s, i) =>
    ({
      id: `f${i}`,
      name_tr: s.tr, name_en: s.en, name_de: s.de, name_es: s.es, name_fr: s.fr,
      name_it: s.it ?? null, name_pt: s.pt ?? null, name_ar: s.ar ?? null, name_ja: s.ja ?? null,
      aliases_json: "[]",
      brand_name: null,
      is_custom: 0,
    }) as unknown as Food
);

const NOW = Date.parse("2026-06-01T12:00:00Z");

function search(
  query: string,
  lang: Lang,
  usage: Map<string, FoodUsage> = new Map(),
  extra: Food[] = []
): string[] {
  const variants = queryVariants(query, lang);
  const synonyms = synonymAlternates(query, lang).map(fold);
  const phrases = [...variants, ...synonyms];
  const rows = [...FOODS, ...extra].filter((f) => foodMatchesAny(f, phrases));
  return rankFoods(rows, { lang, variants, synonyms, usage, now: NOW }).map((f) => foodName(f, lang));
}

function has(label: string, res: string[], name: string): void {
  ok(label, res.includes(name), `${name} not in [${res.slice(0, 6).join(", ")}]`);
}

// Accents and spelling variants
has("sut -> Süt", search("sut", "tr"), "Süt");
has("cay -> Çay", search("cay", "tr").map((n) => n.replace(" (şekersiz)", "")), "Çay");
ok("kase folds to kaşe", fold("kaşe") === "kase" && fold("KAŞE") === "kase");
has("kase -> Açai kasesi", search("kase", "tr"), "Açai kasesi");
ok("kasarli matches Kaşarlı tost", search("kasarli", "tr").some((n) => n.startsWith("Kaşarlı")));
has("kaese -> Käse...", search("kaese", "de").map((n) => n.slice(0, 5)), "Käses");
has("weissbrot -> Weißbrot", search("weissbrot", "de"), "Weißbrot");
has("Weißbrot -> Weißbrot", search("Weißbrot", "de"), "Weißbrot");
has("brotchen -> Brötchen", search("brotchen", "de"), "Brötchen");
has("broetchen -> Brötchen", search("broetchen", "de"), "Brötchen");
has("jamon -> Jamón", search("jamon", "es"), "Jamón serrano");
has("anade ñ: pina", search("pina", "es").map(fold), "pina");
has("cafe -> café fr", search("creme", "fr").map(fold), "creme brulee");
has("ß fold", [fold("Straße")], "strasse");
ok("fold oe/ae", fold("Œuf") === "oeuf" && fold("Æ") === "ae");

// Turkish I/i
has("ISKENDER upper", search("ISKENDER", "tr"), "İskender");
has("İSKENDER dotted upper", search("İSKENDER", "tr"), "İskender");
has("iskender lower", search("iskender", "tr"), "İskender");
ok("tr I/ı/İ fold equal", fold("ISPANAK") === fold("ıspanak") && fold("İZMİR") === fold("izmir"));
has("YOGURT -> Yoğurt", search("YOGURT", "tr"), "Yoğurt");
has("YOĞURT -> Yoğurt", search("YOĞURT", "tr"), "Yoğurt");

// Prefix tiers
{
  const r = search("pasta", "en");
  ok("exact Pasta first (en)", r[0] === "Pasta", r.slice(0, 3).join(","));
  const t = search("sp", "en");
  const firstPrefix = t.findIndex((n) => n.toLowerCase().startsWith("sp"));
  const firstInner = t.findIndex((n) => !n.toLowerCase().startsWith("sp") && n.toLowerCase().includes("sp"));
  ok("prefix before inner", firstPrefix === 0 && (firstInner === -1 || firstInner > firstPrefix));
  const w = search("rice", "en");
  const wordIdx = w.findIndex((n) => /\brice\b/i.test(n) && !/^rice/i.test(n));
  const innerIdx = w.findIndex((n) => !/\brice\b/i.test(n) && /rice/i.test(n));
  ok("word-prefix before substring", wordIdx === -1 || innerIdx === -1 || wordIdx < innerIdx);
}

// Synonyms (TR and DE)
const trSyn: [string, string][] = [
  ["spagetti", "Makarna"], ["somun", "Beyaz ekmek"], ["gevrek", "Simit"],
  ["pirinç pilavı", "Pilav"], ["siyah çay", "Çay (şekersiz)"], ["Türk pizzası", "Lahmacun"],
];
for (const [q, want] of trSyn) has(`tr syn ${q}`, search(q, "tr"), want);
has("tr syn makarna -> Spagetti", search("makarna", "tr"), "Spagetti");
has("tr syn pilav -> Pirinç pilavı", search("pilav", "tr"), "Pirinç pilavı (tereyağlı)");
const deSyn: [string, string][] = [
  ["Semmel", "Brötchen"], ["Schrippe", "Brötchen"], ["Erdapfel", "Kartoffel"],
  ["Topfen", "Quark"], ["Pasta", "Nudeln"], ["Fritten", "Pommes frites"],
  ["Nudeln", "Nudeln"], ["Pommes", "Pommes frites"],
];
for (const [q, want] of deSyn) has(`de syn ${q}`, search(q, "de"), want);
ok("synonym not on wrong lang", synonymAlternates("semmel", "tr").length === 0);
ok("synonym needs 3 chars", synonymAlternates("ma", "tr").length === 0);
{
  const r = search("Semmel", "de");
  ok("direct Semmelknödel before synonym-only Brötchen", r.indexOf("Semmelknödel") < r.indexOf("Brötchen"));
}
const synCount = (l: Lang) => SYNONYM_GROUPS[l]?.length ?? 0;
ok("synonym rows tr 6 / de 5", synCount("tr") === 6 && synCount("de") === 5);

// Every synonym term is backed by the catalogue
for (const lang of ["tr", "de"] as const) {
  for (const group of SYNONYM_GROUPS[lang]!) {
    const hit = group.some((t) => search(t, lang).some((n) => fold(n).includes(fold(t))));
    ok(`catalogue backs ${lang}:${group.join("/")}`, hit);
  }
}

// Logged foods first, within a match group
{
  const base = search("pasta", "en", new Map());
  const target = base.find((n) => n !== "Pasta" && /^pasta/i.test(n)) ?? "";
  const id = FOODS.find((f) => f.name_en === target)!.id;
  const usage = new Map<string, FoodUsage>([[id, { count: 3, last: "2026-05-30T08:00:00Z" }]]);
  const r = search("pas", "en", usage);
  ok("used prefix food leads its group", r[0] === target, `${r[0]} vs ${target}`);
  const exact = search("pasta", "en", usage);
  ok("exact match still beats used prefix", exact[0] === "Pasta");
  const recent = usageScore({ count: 1, last: "2026-05-30T00:00:00Z" }, NOW);
  const old = usageScore({ count: 1, last: "2025-01-01T00:00:00Z" }, NOW);
  ok("recent scores above old", recent > old && old > 0 && usageScore(undefined, NOW) === 0);
  const more = usageScore({ count: 9, last: null }, NOW);
  ok("more logged scores higher", more > usageScore({ count: 2, last: null }, NOW));
}

// Staples
for (const lang of ["de", "fr", "es", "en"] as const) {
  const names = localStapleNamesEn(lang);
  const missing = names.filter((n) => !FOODS.some((f) => f.name_en === n));
  ok(`${lang} staples exist in catalogue`, missing.length === 0, missing.join(", "));
  ok(`${lang} staples 15-20`, names.length >= 15 && names.length <= 20, String(names.length));
}
ok("tr staple preserved", isLocalStaple({ name_tr: "Simit", name_en: "Simit" }, "tr"));
ok("it has no staples", !isLocalStaple({ name_tr: "Simit", name_en: "Simit" }, "it"));
{
  const pickAny = (lang: Lang, q: string, staple: string) => {
    const r = search(q, lang);
    return r.indexOf(staple);
  };
  const de = search("brot", "de");
  ok("de staple Roggenbrot above non-staple brot", de.indexOf("Roggenbrot") !== -1 && de.indexOf("Roggenbrot") < de.indexOf("Dänisches Roggenbrot"));
  ok("fr staple first for pain", search("pain", "fr").indexOf("Pain blanc") < search("pain", "fr").indexOf("Pain graham"));
  void pickAny;
}

console.log(`foodSearch.test: ${passed} passed, ${failed} failed`);
console.log(`staples ${JSON.stringify(LOCAL_STAPLE_COUNTS)}`);
if (failed > 0) process.exit(1);
