/**
 * Household-measure presets (lib/db/seedPortions) and the remembered-preset
 * logic (lib/lastPortionMap). Run: npx tsx scripts/carbPortions.test.ts
 */
import { SEED_FOODS } from "../lib/db/seed";
import { SEED_CARB } from "../lib/db/seedCarb";
import { PORTION_OVERLAY } from "../lib/db/seedPortions";
import { SEED_CATALOG_VERSION, selectFoodsToUpdate, seedNameKey } from "../lib/db/seedVersion";
import { PORTION_LABEL_KEYS } from "../lib/db/types";
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
ok("catalog version bumped", SEED_CATALOG_VERSION === 7, String(SEED_CATALOG_VERSION));
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
