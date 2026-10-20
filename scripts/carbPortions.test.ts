/**
 * Household-measure presets (lib/db/seedPortions) and the remembered-preset
 * logic (lib/lastPortionMap). Run: npx tsx scripts/carbPortions.test.ts
 */
import { SEED_FOODS } from "../lib/db/seed";
import { SEED_CARB } from "../lib/db/seedCarb";
import { PORTION_OVERLAY } from "../lib/db/seedPortions";
import { PORTION_STATE, STATE_PORTION_LABEL, portionStateFor } from "../lib/db/seedPortionState";
import { chipA11yLabel, chipLabel } from "../components/meal/mealCards";
import en from "../lib/i18n/locales/en";
import tr from "../lib/i18n/locales/tr";
import de from "../lib/i18n/locales/de";
import fr from "../lib/i18n/locales/fr";
import es from "../lib/i18n/locales/es";
import it from "../lib/i18n/locales/it";
import pt from "../lib/i18n/locales/pt";
import ar from "../lib/i18n/locales/ar";
import ja from "../lib/i18n/locales/ja";
import { SEED_CATALOG_VERSION, selectFoodsToUpdate, seedNameKey } from "../lib/db/seedVersion";
import { PORTION_LABEL_KEYS } from "../lib/db/types";
import {
  buildPortionChips,
  chipFromGrams,
  chipGrams,
  initialPortionGrams,
  type PortionChip,
} from "../lib/mealCompose";
import { SCENE_LANGS, sceneFoods } from "../lib/mealScene";
import {
  LAST_PORTION_CAP,
  parseLastPortions,
  pickRememberedPortion,
  withLastPortion,
} from "../lib/lastPortionMap";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const labels = new Set<string>(PORTION_LABEL_KEYS);
const byEn = new Map(SEED_FOODS.map((f) => [seedNameKey(f.en), f]));

console.log("A. overlay shape");
let overlayCount = 0;
for (const [en, o] of Object.entries(PORTION_OVERLAY)) {
  overlayCount++;
  const f = byEn.get(seedNameKey(en));
  ok(`${en}: exists in the catalog`, !!f);
  ok(`${en}: 1-3 portions`, o.portions.length >= 1 && o.portions.length <= 3, String(o.portions.length));
  ok(`${en}: source set`, o.src === "usda" || o.src === "std");
  const seen = new Set<string>();
  for (const [label, g] of o.portions) {
    ok(`${en}: label ${label} valid`, labels.has(label));
    ok(`${en}: ${label} grams > 0 and finite`, Number.isFinite(g) && g > 0 && g <= 1000, String(g));
    ok(`${en}: ${label} unique`, !seen.has(label));
    seen.add(label);
  }
}
ok("overlay has at least 280 foods", overlayCount >= 280, String(overlayCount));

console.log("B. merged catalog");
let withPortions = 0;
let overlaid = 0;
for (const f of SEED_FOODS) {
  if (!f.portions || f.portions.length === 0) continue;
  withPortions++;
  ok(`${f.en}: 1-3 portions`, f.portions.length >= 1 && f.portions.length <= 3, String(f.portions.length));
  for (const [l, g] of f.portions) {
    ok(`${f.en}: ${l} valid label`, labels.has(l));
    ok(`${f.en}: ${l} grams > 0`, g > 0);
  }
  if (f.portionSrc) {
    overlaid++;
    ok(`${f.en}: overlay source recorded`, f.portionSrc === "usda" || f.portionSrc === "std");
  }
}
console.log(`  (${withPortions} foods with presets, ${overlaid} from the overlay)`);
ok("overlay raised the preset count past 314", withPortions > 314 + 250, String(withPortions));
ok("tsp and small are in use", SEED_FOODS.some((f) => f.portions?.some(([l]) => l === "tsp")) &&
  SEED_FOODS.some((f) => f.portions?.some(([l]) => l === "small")));
ok("catalog version bumped", SEED_CATALOG_VERSION === 8, String(SEED_CATALOG_VERSION));
ok("seedCarb rows all carry a source", SEED_CARB.every((f) => !!f.src));

console.log("C. top-up reaches an untouched row, not an edited one");
{
  const f = SEED_FOODS.find((x) => x.en === "White bread")!;
  const row = (is_custom: number, source: string | null) => ({
    id: "x", name_en: f.en, name_tr: f.tr, name_de: f.de, name_es: f.es, name_fr: f.fr,
    name_it: f.it ?? null, name_pt: f.pt ?? null, name_ar: f.ar ?? null, name_ja: f.ja ?? null,
    carb_100g: f.carb, glycemic_index: f.gi, portion_size_g: f.portion ?? 100, is_custom, source,
  });
  const up = selectFoodsToUpdate(SEED_FOODS, [row(0, null)]);
  ok("untouched row gets the slice preset", up.length === 1 && up[0].portions?.[0]?.[0] === "slice");
  ok("edited/custom/off rows are skipped", selectFoodsToUpdate(SEED_FOODS, [row(1, null), row(0, "off")]).length === 0);

  const flap = SEED_FOODS.find((x) => x.en === "Flapjack (oat bar)")!;
  const old = (is_custom: number, source: string | null, name_en = "Flapjack") => ({
    id: "r", name_en, name_tr: "Flapjack", name_de: flap.de, name_es: flap.es, name_fr: flap.fr,
    name_it: null, name_pt: null, name_ar: null, name_ja: null,
    carb_100g: 58, glycemic_index: 0, portion_size_g: 100, is_custom, source,
  });
  const ru = selectFoodsToUpdate(SEED_FOODS, [old(0, null)]);
  ok("renamed untouched row gets name_en and the new carb", ru.length === 1 && ru[0].name_en === "Flapjack (oat bar)" && ru[0].carb_100g === flap.carb);
  ok("renamed row edited by the user is left alone", selectFoodsToUpdate(SEED_FOODS, [old(1, null), old(0, "off")]).length === 0);
  ok("rename skipped when the new name already exists", selectFoodsToUpdate(SEED_FOODS, [old(0, null), old(0, null, "Flapjack (oat bar)")]).every((u) => u.name_en === undefined));
  const cq = selectFoodsToUpdate(SEED_FOODS, [old(0, null, "Chouquette (plain cream puff)")]);
  ok("chouquette rename resolves", cq.length === 1 && cq[0].name_en === "Chouquette (cream puff)");
}

console.log("D. last portion memory");
{
  const presets = [{ label_key: "slice" as const }, { label_key: "piece" as const }];
  ok("none remembered -> nothing", pickRememberedPortion(presets, undefined) === undefined);
  ok("remembered label found", pickRememberedPortion(presets, "piece")?.label_key === "piece");
  ok("remembered label gone from presets -> nothing", pickRememberedPortion(presets, "cup") === undefined);
  ok("parse junk", Object.keys(parseLastPortions("not json")).length === 0 && Object.keys(parseLastPortions("[1]")).length === 0);
  ok("parse drops invalid labels", JSON.stringify(parseLastPortions('{"a":"slice","b":"nope"}')) === '{"a":"slice"}');
  let m = withLastPortion({}, "a", "slice");
  m = withLastPortion(m, "b", "cup");
  m = withLastPortion(m, "a", "piece");
  ok("overwrite keeps one entry per food", m.a === "piece" && m.b === "cup" && Object.keys(m).length === 2);
  ok("empty food id ignored", Object.keys(withLastPortion({}, "", "slice")).length === 0);
  let big = {};
  for (let i = 0; i < LAST_PORTION_CAP + 20; i++) big = withLastPortion(big, `f${i}`, "slice");
  const ids = Object.keys(big);
  ok("cap holds, oldest dropped", ids.length === LAST_PORTION_CAP && !ids.includes("f0") && ids.includes(`f${LAST_PORTION_CAP + 19}`));
}

console.log("E. portion chips");
{
  const m = (label_key: (typeof PORTION_LABEL_KEYS)[number], grams: number) => ({ label_key, grams });
  const ids = (chips: PortionChip[]) => chips.map((c) => c.id).join(",");

  const one = buildPortionChips([m("slice", 30)], "slice");
  ok("one measure: x1, x2, grams", ids(one) === "slice:1,slice:2,grams", ids(one));
  const three = buildPortionChips([m("slice", 30), m("piece", 60), m("cup", 200)], "slice");
  ok("three measures: primary x1/x2, others x1, grams", ids(three) === "slice:1,slice:2,piece:1,cup:1,grams", ids(three));
  ok("at most 5 chips", three.length === 5);
  const many = buildPortionChips(
    [m("slice", 30), m("piece", 60), m("cup", 200), m("glass", 240), m("bowl", 300)],
    "cup"
  );
  ok("measures past 3 are dropped, chips stay <= 5", many.length <= 5 && !many.some((c) => c.label_key === "glass"), ids(many));
  const remembered = buildPortionChips([m("slice", 30), m("piece", 60)], "piece");
  ok("remembered measure becomes primary", ids(remembered) === "piece:1,piece:2,slice:1,grams", ids(remembered));
  const fallback = buildPortionChips([m("slice", 30), m("piece", 60)], "cup");
  ok("unknown primary key falls back to the first measure", fallback[0].id === "slice:1");
  const synthetic = buildPortionChips([], null, 150);
  ok("no measure: synthetic portion from typical", ids(synthetic) === "portion:1,portion:2,grams" && synthetic[0].unit_g === 150, ids(synthetic));
  ok("no measure and no typical: 100 g portion", buildPortionChips([], undefined, 0)[0].unit_g === 100);
  const dup = buildPortionChips([m("slice", 30), m("slice", 99), m("piece", 0)], "slice");
  ok("duplicate label and zero grams are dropped", ids(dup) === "slice:1,slice:2,grams", ids(dup));
  ok("grams chip is last and the only grams chip", three[three.length - 1].kind === "grams" && three.filter((c) => c.kind === "grams").length === 1);

  ok("chipGrams x1", chipGrams(one[0]) === 30);
  ok("chipGrams x2", chipGrams(one[1]) === 60);
  ok("chipGrams grams chip keeps the typed value", chipGrams(one[2], 47.3) === 47.3 && chipGrams(one[2]) === 0);
  ok("chipGrams works on the one-decimal measure", chipGrams(buildPortionChips([m("slice", 33.33)], null)[1]) === 66.6);

  ok("chipFromGrams exact x1", chipFromGrams(three, 30)?.id === "slice:1");
  ok("chipFromGrams exact x2", chipFromGrams(three, 60)?.id === "slice:2");
  ok("chipFromGrams ties go to the earlier chip", chipFromGrams(three, 60)?.id !== "piece:1");
  ok("chipFromGrams other measure", chipFromGrams(three, 200)?.id === "cup:1");
  ok("chipFromGrams no match -> grams mode", chipFromGrams(three, 77)?.kind === "grams");
  ok("chipFromGrams 0 g -> grams mode", chipFromGrams(three, 0)?.kind === "grams");
  ok("chipFromGrams NaN -> grams mode", chipFromGrams(three, NaN)?.kind === "grams");
  ok("chipFromGrams without a grams chip -> null", chipFromGrams([three[0]], 77) === null);

  const pre = [m("slice", 30), m("piece", 60)];
  ok("initial: remembered wins", initialPortionGrams(pre, "piece", 120) === 60);
  ok("initial: remembered label gone -> first measure", initialPortionGrams(pre, "cup", 120) === 30);
  ok("initial: nothing remembered -> first measure", initialPortionGrams(pre, undefined, 120) === 30);
  ok("initial: no measure -> typical", initialPortionGrams([], undefined, 120) === 120);
  ok("initial: no measure, no typical -> 100", initialPortionGrams([], undefined, 0) === 100);
  ok("initial: zero-gram measure skipped", initialPortionGrams([m("slice", 0), m("piece", 60)], undefined, 120) === 60);
  ok("initial: remembered with no measure falls to typical", initialPortionGrams([], "slice", 80) === 80);
  ok("initial: capped", initialPortionGrams([], undefined, 99999) === 9999);

  // Whole catalogue: every food yields a sane chip row, and a chip's grams map back to it.
  let chipFoods = 0;
  for (const f of SEED_FOODS) {
    const measures = (f.portions ?? []).map(([label_key, grams]) => ({ label_key, grams }));
    const chips = buildPortionChips(measures, undefined, f.portion ?? 0);
    chipFoods++;
    if (chips.length > 5 || chips[chips.length - 1].kind !== "grams" || chips.some((c) => c.kind === "measure" && !(chipGrams(c) > 0))) {
      ok(`${f.en}: chip row sane`, false, ids(chips));
    }
    const back = chipFromGrams(chips, chipGrams(chips[0]));
    if (back?.id !== chips[0].id) ok(`${f.en}: first chip maps back`, false, `${back?.id}`);
  }
  ok("every catalogue food builds a chip row", chipFoods === SEED_FOODS.length);
}

console.log("F. scene foods carry measures");
{
  const pending: string[] = [];
  for (const lang of SCENE_LANGS) {
    for (const sf of sceneFoods(lang)) {
      const f = byEn.get(seedNameKey(sf.en));
      if (!f) {
        ok(`${lang}: ${sf.en} in the catalogue`, false);
        continue;
      }
      if (!f.portions || f.portions.length === 0) pending.push(`${lang}:${sf.en}`);
    }
  }
  console.log(`  (without a measure until seedPortions gains them: ${pending.length ? pending.join(", ") : "none"})`);
}

console.log("G. cooked / dry state on the cup");
{
  const LOCALES = { en, tr, de, fr, es, it, pt, ar, ja } as const;
  const stated = Object.entries(PORTION_STATE);

  // (a) every food with a state: catalogue food, cup-only, USDA-sourced, ref text agrees
  for (const [name, entry] of stated) {
    const food = byEn.get(seedNameKey(name));
    ok(`${name}: state food exists in the catalogue`, !!food);
    const o = PORTION_OVERLAY[name];
    ok(`${name}: has an overlay entry`, !!o);
    ok(`${name}: only a cup is stated`, !!o && o.portions.every(([l]) => l === STATE_PORTION_LABEL), o ? o.portions.map(([l]) => l).join(",") : "");
    ok(`${name}: overlay source is usda`, o?.src === "usda");
    ok(`${name}: state is cooked or dry`, entry.state === "cooked" || entry.state === "dry");
    ok(`${name}: ref carries an FDC id`, /^(SR|FN)\d+ \S/.test(entry.ref), entry.ref);
    // (c) the state must not contradict the USDA record it was read from
    const text = entry.ref.toLowerCase();
    if (entry.state === "cooked") {
      ok(`${name}: cooked ref says cooked, boiled or mush`, /cooked|boiled|mush/.test(text), entry.ref);
    } else {
      ok(`${name}: dry ref says raw, dry or uncooked and not cooked`, /\b(raw|dry|uncooked)\b/.test(text) && !/cooked|boiled/.test(text), entry.ref);
    }
    // the chip itself carries the state, for the US and the metric wording
    const measures = (o?.portions ?? []).map(([label_key, grams]) => ({ label_key, grams }));
    const chips = buildPortionChips(measures, undefined, 0, false, entry.state);
    const first = chips[0];
    const word = entry.state === "cooked" ? "cooked" : "dry";
    ok(`${name}: US chip text says ${word}`, chipLabel(first, (k) => k, String, { system: "us" }).text === `1 cup, ${word}`, chipLabel(first, (k) => k, String, { system: "us" }).text);
    ok(`${name}: chip a11y label says ${word}`, chipA11yLabel(first, (k) => k, String, { system: "us" }).startsWith(`1 cup, ${word}`));
    const key = entry.state === "cooked" ? "portion.cupCooked" : "portion.cupDry";
    ok(`${name}: metric chip uses ${key}`, chipLabel(first, (k) => k, String).text === `1 × ${key}`, chipLabel(first, (k) => k, String).text);
  }
  ok("at least 40 foods carry a state", stated.length >= 40, String(stated.length));

  // (b) every grain / pasta / legume cup is either stated or a deliberate exception
  const EXCEPTIONS: Readonly<Record<string, string>> = {
    "Rice pilaf": "prepared dish, no raw counterpart",
    "Bulgur pilaf": "prepared dish, no raw counterpart",
    Porridge: "prepared dish, recipe not named by USDA",
    Muesli: "ready-to-eat cereal",
    Granola: "ready-to-eat cereal",
    Cornflakes: "ready-to-eat cereal",
    "Sweet corn": "USDA measure is canned, drained kernels",
    "Boiled potato": "name already says boiled; not a grain, pasta or legume",
    "Rice flour": "flour has no cooked state",
    "Wheat flour": "flour has no cooked state",
    "Whole wheat flour": "flour has no cooked state",
    "Buckwheat flour": "flour has no cooked state",
    "Chickpea flour": "flour has no cooked state",
    Edamame: "USDA measure is frozen, prepared",
    Hummus: "prepared dish",
    "Refried beans": "USDA measure is canned",
    "Baked beans in tomato sauce": "USDA measure is canned",
  };
  const unresolved: string[] = [];
  for (const f of SEED_FOODS) {
    if (f.cat !== "staples" && f.cat !== "legumes") continue;
    if (!f.portions?.some(([l]) => l === STATE_PORTION_LABEL)) continue;
    const decided = f.en in PORTION_STATE || f.en in EXCEPTIONS;
    if (!decided) unresolved.push(f.en);
    ok(`${f.en}: cup is stated or a deliberate exception`, decided);
    ok(`${f.en}: not both stated and excepted`, !(f.en in PORTION_STATE && f.en in EXCEPTIONS));
    if (/\b(cooked|boiled)\b/i.test(f.en) || /\b(dry|raw|uncooked)\b/i.test(f.en)) {
      ok(`${f.en}: a state in the name is carried by the chip`, f.en in PORTION_STATE || f.en in EXCEPTIONS);
    }
  }
  ok("no undecided cup food", unresolved.length === 0, unresolved.join(", "));
  for (const name of Object.keys(EXCEPTIONS)) ok(`${name}: exception is a catalogue food`, byEn.has(seedNameKey(name)));

  // state only lands on cup chips; other foods and custom rows get none
  const mixed = buildPortionChips([{ label_key: "cup", grams: 158 }, { label_key: "slice", grams: 30 }], "cup", 0, false, "cooked");
  ok("cup chips carry the state, the slice chip does not", mixed.filter((c) => c.kind === "measure").every((c) => (c.label_key === "cup") === (c.state === "cooked")));
  ok("no state, no state on the chips", buildPortionChips([{ label_key: "cup", grams: 158 }], "cup").every((c) => c.state === undefined));
  ok("the chip id does not change with the state", mixed[0].id === "cup:1" && mixed[1].id === "cup:2");
  ok("portionStateFor: untouched catalogue row", portionStateFor({ name_en: "White rice", is_custom: 0, source: null }) === "cooked");
  ok("portionStateFor: lookup ignores case and spaces", portionStateFor({ name_en: " white RICE ", is_custom: 0, source: null }) === "cooked");
  ok("portionStateFor: edited or custom row", portionStateFor({ name_en: "White rice", is_custom: 1, source: null }) === null);
  ok("portionStateFor: Open Food Facts row", portionStateFor({ name_en: "White rice", is_custom: 0, source: "off" }) === null);
  ok("portionStateFor: food without a state / null food", portionStateFor({ name_en: "Apple", is_custom: 0, source: null }) === null && portionStateFor(null) === null);
  ok("a UK chip is worded like the US one", chipLabel(mixed[0], (k) => k, String, { system: "uk" }).text === "1 cup, cooked");
  ok("two cups read in the plural", chipLabel(mixed[1], (k) => k, String, { system: "us" }).text === "2 cups, cooked");

  // (d) nine languages, filled, no em dash, no forbidden wording, one address form
  const FORBIDDEN = /uyar[ıi]r|alarm|tan[ıi]\b|tedavi|diagnos|treatment|recommended dose|Diagnose|Behandlung|diagnostic|traitement|tratamiento|diagnóstico|trattamento|tratamento|診断|治療|تشخيص|علاج/i;
  for (const [lang, tree] of Object.entries(LOCALES)) {
    for (const key of ["cupCooked", "cupDry"] as const) {
      const text = tree.portion[key];
      ok(`${lang}: portion.${key} is filled`, typeof text === "string" && text.trim().length > 0);
      ok(`${lang}: portion.${key} has no em dash`, !new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`).test(text));
      ok(`${lang}: portion.${key} has no forbidden wording`, !FORBIDDEN.test(text), text);
      ok(`${lang}: portion.${key} starts with the plain cup label`, text.startsWith(tree.portion.cup), text);
      ok(`${lang}: portion.${key} is longer than the plain cup label`, text.length > tree.portion.cup.length);
      ok(`${lang}: portion.${key} is short enough for a chip`, text.length <= 24, String(text.length));
    }
    ok(`${lang}: cooked and dry differ`, tree.portion.cupCooked !== tree.portion.cupDry);
    ok(`${lang}: cup and glass chips differ (a drink carries both)`, tree.portion.cup !== tree.portion.glass, tree.portion.cup);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
