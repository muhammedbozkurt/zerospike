/**
 * Locale-aware portion chips (lib/portionUnits, lib/db/seedFlOz and the
 * oz entry chip). Run: npx tsx scripts/portionUnits.test.ts
 */
import { SEED_FOODS } from "../lib/db/seed";
import { FL_OZ_GRAMS, flOzGramsFor } from "../lib/db/seedFlOz";
import { PORTION_OVERLAY } from "../lib/db/seedPortions";
import { selectFoodsToUpdate, seedNameKey } from "../lib/db/seedVersion";
import { chipLabel, chipText, chipA11yLabel, cardPortionState, entryUnitAfterChip, gramOpenAfterChip, visibleChips } from "../components/meal/mealCards";
import { buildPortionChips, chipFromGrams, chipGrams } from "../lib/mealCompose";
import { sceneFoods } from "../lib/mealScene";
import {
  CUP_ML,
  FL_OZ_ML,
  OZ_G,
  displayOunces,
  flOzFromGrams,
  formatPortionChip,
  gramsFromOz,
  mlFromGrams,
  ozFromGrams,
  parseOzInput,
  portionUnitSystem,
} from "../lib/portionUnits";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${label}${detail ? `: ${detail}` : ""}`);
  }
}
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

const byEn = new Map(SEED_FOODS.map((f) => [seedNameKey(f.en), f]));
const portionOf = (en: string, label: string): number => {
  const f = byEn.get(seedNameKey(en));
  const hit = f?.portions?.find(([l]) => l === label);
  if (!hit) throw new Error(`${en} has no ${label} measure`);
  return hit[1];
};
const chip = (label_key: Parameters<typeof formatPortionChip>[0]["label_key"], unit_g: number, multiplier = 1) => ({
  label_key,
  unit_g,
  multiplier,
});

console.log("A. constants and conversions");
ok("1 oz is 28.3495 g", OZ_G === 28.3495);
ok("1 fl oz is 29.5735 ml", FL_OZ_ML === 29.5735);
ok("1 cup is 236.588 ml = 8 fl oz", near(CUP_ML / FL_OZ_ML, 8, 0.0001));
ok("1 oz -> 28.3 g (one decimal)", gramsFromOz(1) === 28.3);
ok("2 oz -> 56.7 g", gramsFromOz(2) === 56.7);
ok("0.5 oz -> 14.2 g", gramsFromOz(0.5) === 14.2);
ok("oz typed with a comma", parseOzInput("1,5") === 42.5, String(parseOzInput("1,5")));
ok("oz typed with a dot", parseOzInput("1.5") === 42.5);
ok("oz junk -> 0", parseOzInput("abc") === 0 && parseOzInput("") === 0 && parseOzInput("-2") === 0);
ok("oz input is capped like the gram field", parseOzInput("99999") === 9999);
ok("28 g is 1 oz for the field", ozFromGrams(28) === 1);
ok("100 g is 3.5 oz for the field", ozFromGrams(100) === 3.5);
ok("fl oz of 244 g milk (30.5 g/fl oz) is 8", near(flOzFromGrams(244, 30.5), 8, 0.001));
ok("1 fl oz of milk is 29.57 ml -> 30 ml", mlFromGrams(30.5, 30.5) === 30);
ok("8 fl oz of milk is 237 ml", mlFromGrams(244, 30.5) === 237, String(mlFromGrams(244, 30.5)));
ok("fl oz with no density is 0", flOzFromGrams(244, 0) === 0);

console.log("B. display rounding");
ok("1.058 oz prints 1", displayOunces(1.058) === 1);
ok("0.99 oz prints 1", displayOunces(0.99) === 1);
ok("2.3 oz keeps one decimal", displayOunces(2.3) === 2.3);
ok("2.34 oz prints 2.3", displayOunces(2.34) === 2.3);
ok("0.4 oz stays 0.4 (no snapping to 0)", displayOunces(0.4) === 0.4);
ok("11.1 oz stays 11.1", displayOunces(11.11) === 11.1);
ok("NaN -> 0", displayOunces(NaN) === 0);

console.log("C. unit system from region and language");
ok("en + US = us", portionUnitSystem("US", "en") === "us");
ok("en + no region = us", portionUnitSystem(null, "en") === "us" && portionUnitSystem(undefined, "en-US") === "us");
ok("en + lowercase us = us", portionUnitSystem("us", "en") === "us");
ok("en + Puerto Rico = us", portionUnitSystem("PR", "en") === "us");
ok("en + GB = uk", portionUnitSystem("GB", "en") === "uk");
ok("en + other region = uk", portionUnitSystem("AU", "en") === "uk" && portionUnitSystem("IE", "en") === "uk");
ok("de + US = metric", portionUnitSystem("US", "de") === "metric");
ok("tr + GB = metric", portionUnitSystem("GB", "tr") === "metric");
ok("ja / ar = metric", portionUnitSystem("JP", "ja") === "metric" && portionUnitSystem("SA", "ar") === "metric");
ok("no language = metric", portionUnitSystem("US", null) === "metric");

console.log("D. chip wording");
{
  const toast = formatPortionChip(chip("slice", portionOf("Toast bread", "slice")), "us", null);
  ok("Toast bread: 1 slice (1 oz)", toast?.text === "1 slice (1 oz)", toast?.text);
  ok("Toast bread caption is the grams", toast?.caption === "30 g", toast?.caption);
  const toast2 = formatPortionChip(chip("slice", 30, 2), "us", null);
  ok("2 slices (2 oz) agrees with 1 slice (1 oz)", toast2?.text === "2 slices (2 oz)" && toast2.caption === "60 g", toast2?.text);
  const white = formatPortionChip(chip("slice", 28), "us", null);
  ok("USDA 28 g slice is 1 oz", white?.text === "1 slice (1 oz)");
  const heavy = formatPortionChip(chip("slice", 32), "us", null);
  ok("32 g slice is 1.1 oz", heavy?.text === "1 slice (1.1 oz)", heavy?.text);
  const egg = formatPortionChip(chip("large", 50), "us", null);
  ok("large egg 50 g is 1.8 oz", egg?.text === "1 large (1.8 oz)", egg?.text);
  const tiny = formatPortionChip(chip("piece", 4), "us", null);
  ok("a 4 g piece gets no ounce figure", tiny?.text === "1 piece" && tiny.caption === "4 g", tiny?.text);

  const milkG = portionOf("Milk", "glass");
  const milkD = flOzGramsFor("Milk");
  const milkUs = formatPortionChip(chip("glass", milkG), "us", milkD);
  ok("Milk glass (US): 1 glass (8 fl oz) over 244 g", milkUs?.text === "1 glass (8 fl oz)" && milkUs.caption === "244 g", `${milkUs?.text} / ${milkUs?.caption}`);
  const milkUs2 = formatPortionChip(chip("glass", milkG, 2), "us", milkD);
  ok("2 glasses (16 fl oz)", milkUs2?.text === "2 glasses (16 fl oz)", milkUs2?.text);
  const milkUk = formatPortionChip(chip("glass", milkG), "uk", milkD);
  ok("Milk glass (UK): 1 glass (237 ml) over 244 g", milkUk?.text === "1 glass (237 ml)" && milkUk.caption === "244 g", `${milkUk?.text} / ${milkUk?.caption}`);
  const milkUk2 = formatPortionChip(chip("glass", milkG, 2), "uk", milkD);
  ok("2 glasses (473 ml)", milkUk2?.text === "2 glasses (473 ml)", milkUk2?.text);

  const rice = formatPortionChip(chip("cup", portionOf("White rice", "cup")), "us", null);
  const oats = formatPortionChip(chip("cup", portionOf("Oatmeal", "cup")), "us", null);
  ok("rice cup is 1 cup over 158 g", rice?.text === "1 cup" && rice.caption === "158 g", `${rice?.text} / ${rice?.caption}`);
  ok("cup grams are food specific (rice 158 g, oatmeal 234 g, milk-like cup 244 g)", rice?.caption !== oats?.caption && oats?.caption === "234 g");
  const yogurtCup = formatPortionChip(chip("cup", portionOf("Yogurt", "cup")), "us", flOzGramsFor("Yogurt"));
  ok("a solid cup never gets fl oz", yogurtCup?.text === "1 cup" && yogurtCup.caption === "245 g", yogurtCup?.text);
  const tbsp = formatPortionChip(chip("tbsp", portionOf("Honey", "tbsp")), "us", null);
  ok("tbsp: 1 tbsp over 21 g", tbsp?.text === "1 tbsp" && tbsp.caption === "21 g");
  const tbspUk = formatPortionChip(chip("tbsp", 21, 2), "uk", null);
  ok("UK tbsp x2 keeps the word", tbspUk?.text === "2 tbsp" && tbspUk.caption === "42 g");

  const sliceUk = formatPortionChip(chip("slice", 28), "uk", null);
  ok("UK solid: no oz, no ml, grams under", sliceUk?.text === "1 slice" && sliceUk.caption === "28 g", sliceUk?.text);
  const cupUkRice = formatPortionChip(chip("cup", 158), "uk", null);
  ok("UK solid cup has no ml", cupUkRice?.text === "1 cup");
  const cupUkTea = formatPortionChip(chip("cup", portionOf("Filter coffee", "cup")), "uk", flOzGramsFor("Filter coffee"));
  ok("UK coffee cup: ml", cupUkTea?.text === "1 cup (237 ml)", cupUkTea?.text);
  const colaUs = formatPortionChip(chip("portion", portionOf("Cola", "portion")), "us", flOzGramsFor("Cola"));
  ok("Cola 330 g portion is 10.7 fl oz", colaUs?.text === "1 portion (10.7 fl oz)", colaUs?.text);
  ok("metric system has no local wording", formatPortionChip(chip("slice", 28), "metric", null) === null);
}

console.log("E. chips in the meal card");
{
  const t = (key: string) => ({ "portion.slice": "Scheibe", "mealCompose.gramChip": "Gramm…", "mealCompose.ozChip": "oz…", "common.grams": "g" })[key] ?? key;
  const fmt = (n: number) => String(n);
  const measures = [{ label_key: "slice" as const, grams: 30 }];
  const plain = buildPortionChips(measures, "slice", 0);
  ok("no oz chip by default", plain.map((c) => c.id).join(",") === "slice:1,slice:2,grams");
  const us = buildPortionChips(measures, "slice", 0, true);
  ok("US row: oz chip sits right before grams", us.map((c) => c.id).join(",") === "slice:1,slice:2,oz,grams", us.map((c) => c.id).join(","));
  ok("oz chip is its own kind with no label", us[2].kind === "oz" && us[2].label_key === null);
  ok("oz chip keeps the typed grams", chipGrams(us[2], 47.3) === 47.3 && chipGrams(us[2]) === 0);
  ok("oz and grams chips open the entry field", gramOpenAfterChip(us[2]) && gramOpenAfterChip(us[3]) && !gramOpenAfterChip(us[0]));
  ok("entry unit follows the chip", entryUnitAfterChip(us[2]) === "oz" && entryUnitAfterChip(us[3]) === "g");
  ok("chipFromGrams still falls back to the grams chip", chipFromGrams(us, 77)?.id === "grams");
  ok("chipFromGrams exact x2 still wins", chipFromGrams(us, 60)?.id === "slice:2");
  ok("visibleChips keeps oz before grams", visibleChips(us).map((c) => c.id).join(",") === "slice:1,slice:2,oz,grams");
  const many = buildPortionChips(
    [{ label_key: "slice", grams: 30 }, { label_key: "piece", grams: 60 }, { label_key: "cup", grams: 200 }],
    "slice",
    0,
    true
  );
  ok("a US row holds 3 measures + x2 + oz + grams", many.length === 6 && visibleChips(many).length === 6, String(many.length));
  ok("open oz entry selects the oz chip", cardPortionState(us, 60, true, "oz").selectedChipId === "oz");
  ok("open gram entry selects the grams chip", cardPortionState(us, 60, true, "g").selectedChipId === "grams");
  ok("closed entry selects by grams", cardPortionState(us, 30, false, "oz").selectedChipId === "slice:1");
  ok("oz chip text is oz…", chipText(us[2], t, fmt) === "oz…");
  ok("metric chips keep the translated wording", chipText(us[0], t, fmt) === "1 × Scheibe" && chipLabel(us[0], t, fmt).caption === null);
  ok("metric system object is the same as none", chipText(us[0], t, fmt, { system: "metric" }) === "1 × Scheibe");
  const l = chipLabel(us[0], t, fmt, { system: "us" });
  ok("us chip label", l.text === "1 slice (1 oz)" && l.caption === "30 g", `${l.text} / ${l.caption}`);
  ok("us chip a11y label carries the grams", chipA11yLabel(us[0], t, fmt, { system: "us" }) === "1 slice (1 oz), 30 g");
  ok("oz chip a11y label is its text", chipA11yLabel(us[2], t, fmt, { system: "us" }) === "oz…");
}

console.log("F. catalog data");
{
  let unknown = 0;
  for (const [en, [g, fdc]] of Object.entries(FL_OZ_GRAMS)) {
    if (!byEn.has(seedNameKey(en))) {
      unknown++;
      ok(`${en}: in the catalog`, false);
    }
    ok(`${en}: grams per fl oz is plausible`, g >= 25 && g <= 40, String(g));
    ok(`${en}: carries a USDA FDC id`, /^(SR|FN)\d{6,7}$/.test(fdc), fdc);
  }
  ok("every fl oz entry names a catalog food", unknown === 0);
  ok("flOzGramsFor is exact-name", flOzGramsFor("Milk") === 30.5 && flOzGramsFor("milk") === null && flOzGramsFor("Rice") === null);
  ok("flOzGramsFor survives prototype names and empties", flOzGramsFor("toString") === null && flOzGramsFor("") === null && flOzGramsFor(null) === null);

  // The glass / cup measures of a drink and its fl oz figure must agree to
  // within a few percent, or the bracketed "8 fl oz" would be a wrong claim.
  for (const [en, [g]] of Object.entries(FL_OZ_GRAMS)) {
    const f = byEn.get(seedNameKey(en));
    for (const [label, grams] of f?.portions ?? []) {
      if (label !== "glass" && label !== "cup") continue;
      const flOz = grams / g;
      if (flOz < 0.5 || flOz > 20) ok(`${en}: ${label} ${grams} g is ${flOz.toFixed(1)} fl oz`, false);
    }
  }

  const newCups: Array<[string, number]> = [
    ["Macaroni (cooked)", 120], ["Fusilli (cooked)", 107], ["Farfalle (cooked)", 107], ["Egg noodles (cooked)", 160],
    ["Sticky rice (cooked)", 174], ["Teff (cooked)", 252], ["Spelt berries (cooked)", 194], ["Pearl barley (cooked)", 157],
    ["Oat bran (dry)", 94], ["Rice flour", 158], ["Buckwheat flour", 120],
  ];
  for (const [en, grams] of newCups) {
    const o = PORTION_OVERLAY[en];
    ok(`${en}: usda cup ${grams} in the overlay`, !!o && o.src === "usda" && o.portions[0][0] === "cup" && o.portions[0][1] === grams);
    ok(`${en}: reaches the merged catalog`, portionOf(en, "cup") === grams);
  }
  ok("Sheep milk glass is usda 245", PORTION_OVERLAY["Sheep milk"]?.src === "usda" && portionOf("Sheep milk", "glass") === 245);
  ok("existing numbers untouched", PORTION_OVERLAY["White rice"].portions[0][1] === 158 && PORTION_OVERLAY["Milk"].portions[0][1] === 244 && PORTION_OVERLAY["Toast bread"].portions[0][1] === 30);

  const f = byEn.get(seedNameKey("Fusilli (cooked)"))!;
  const row = (is_custom: number, source: string | null) => ({
    id: "x", name_en: f.en, name_tr: f.tr, name_de: f.de, name_es: f.es, name_fr: f.fr,
    name_it: f.it ?? null, name_pt: f.pt ?? null, name_ar: f.ar ?? null, name_ja: f.ja ?? null,
    carb_100g: f.carb, glycemic_index: f.gi, portion_size_g: f.portion ?? 100, is_custom, source,
  });
  const up = selectFoodsToUpdate(SEED_FOODS, [row(0, null)]);
  ok("an untouched Fusilli row is topped up with the cup", up.length === 1 && up[0].portions?.[0]?.[0] === "cup" && up[0].portions?.[0]?.[1] === 107);
  ok("an edited Fusilli row is left alone", selectFoodsToUpdate(SEED_FOODS, [row(1, null)]).length === 0);
}

console.log("G. the en-US screenshot scene");
{
  const scene = sceneFoods("en");
  const toast = scene[0];
  ok("scene starts with Toast bread", toast.en === "Toast bread");
  const measures = (byEn.get(seedNameKey(toast.en))?.portions ?? []).map(([label_key, grams]) => ({ label_key, grams }));
  const chips = buildPortionChips(measures, undefined, 0, true);
  const labels = chips.filter((c) => c.kind === "measure").map((c) => chipLabel(c, (k) => k, String, { system: "us", gPerFlOz: null }));
  ok("scene shows the 1 slice (1 oz) chip", labels[0].text === "1 slice (1 oz)", labels[0].text);
  ok("scene's 60 g selects the 2 slices chip", chipFromGrams(chips, toast.grams)?.id === "slice:2" && labels[1].text === "2 slices (2 oz)");
  const milk = scene[2];
  const mm = (byEn.get(seedNameKey(milk.en))?.portions ?? []).map(([label_key, grams]) => ({ label_key, grams }));
  const mc = buildPortionChips(mm, undefined, 0, true).map((c) => chipLabel(c, (k) => k, String, { system: "us", gPerFlOz: flOzGramsFor(milk.en) }));
  ok("scene milk reads 1 glass (8 fl oz)", mc[0].text === "1 glass (8 fl oz)" && mc[0].caption === "244 g", mc[0].text);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
