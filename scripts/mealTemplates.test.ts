/**
 * Meal-template correctness harness (schema v13). Standalone and dependency-free,
 * the same shape as scripts/calc.test.ts:
 *
 *   npx tsx scripts/mealTemplates.test.ts
 *
 * What is pinned here:
 *   A. the carb total (several items, carbs_g_fixed, a portion of 0, rounding)
 *   B. the snapshot rule (live value wins, snapshot survives a lost catalogue row,
 *      switching language switches the live name but never the snapshot)
 *   C. the SYNTHETIC-FOOD equivalence a one-tap log depends on: a template logged
 *      as one meal row must dose exactly like a food whose carb_100g is the total
 *   D. rankTemplates across the clock
 *   E. groupMealsBySlot at the day and slot boundaries
 *   F. the storage rules that have no pure function to call (read from the source,
 *      so the exact regression fails here instead of shipping)
 *   G. what the editor screen leans on: the Turkish-safe duplicate-name fold, a
 *      portion edit going through the SAME carb rule, the all-or-nothing link
 *      portions, and past meals turned into items without inventing a name
 *
 * Every timestamp is built from LOCAL date parts, because both the slot and the
 * day key are local-time questions; a fixed "...Z" literal would pass or fail
 * depending on the machine's timezone.
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare function require(id: string): any;

import { estimateInsulin } from "../lib/insulin";
import {
  applyItemPortion,
  formatPortions,
  groupMealsBySlot,
  normalizeTemplateName,
  parsePortions,
  rankTemplates,
  resolveItemCarbs,
  resolveTemplateItem,
  resolvedTotals,
  templateCarbs,
  templateItemsFromMeals,
  templateNameTaken,
  templatePortionG,
} from "../lib/mealTemplates";
import type { ItemFood, TemplateItemWithFood } from "../lib/mealTemplates";
import type { MealTemplate, MealTemplateItem } from "../lib/db/types";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(
    name,
    actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
}
function section(title: string): void {
  console.log(`\n${title}`);
}

/** An ISO instant from LOCAL date parts (month is 1-based here). */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function food(carb100g: number, names: Partial<ItemFood> = {}): ItemFood {
  return {
    carb_100g: carb100g,
    name_tr: names.name_tr ?? "",
    name_en: names.name_en ?? "",
    name_de: names.name_de ?? "",
    name_es: names.name_es ?? "",
    name_fr: names.name_fr ?? "",
  };
}

let itemSeq = 0;
function item(
  patch: Partial<MealTemplateItem> & { food?: ItemFood | null } = {}
): MealTemplateItem & { food: ItemFood | null } {
  itemSeq++;
  return {
    id: patch.id ?? `it${itemSeq}`,
    template_id: patch.template_id ?? "t1",
    food_id: patch.food_id ?? null,
    name_snapshot: patch.name_snapshot ?? "Kalem",
    carb_100g_snapshot: patch.carb_100g_snapshot ?? 0,
    portion_g: patch.portion_g ?? 0,
    carbs_g_fixed: patch.carbs_g_fixed ?? null,
    sort_order: patch.sort_order ?? 0,
    food: patch.food ?? null,
  };
}

function template(patch: Partial<MealTemplate> = {}): MealTemplate {
  return {
    id: patch.id ?? "t",
    profile_id: patch.profile_id ?? "p1",
    name: patch.name ?? "Sablon",
    slot: patch.slot ?? null,
    sort_order: patch.sort_order ?? 0,
    use_count: patch.use_count ?? 0,
    last_used_at: patch.last_used_at ?? null,
    created_at: patch.created_at ?? "2026-01-01T00:00:00.000Z",
  };
}

const PROFILE = {
  carb_ratio_breakfast: 10,
  carb_ratio_lunch: 12,
  carb_ratio_dinner: 12,
  insulin_sensitivity_factor: 40,
  target_postmeal_min: 80,
  target_postmeal_max: 140,
};

// ── A. the carb total ─────────────────────────────────────────────────────────
section("A. template carb total");
{
  // A breakfast of three catalogue items: 50 g bread @ 48.5, 200 g milk @ 4.8,
  // 30 g cheese @ 1.2.
  const items: TemplateItemWithFood[] = [
    item({ food_id: "f1", portion_g: 50, food: food(48.5) }),
    item({ food_id: "f2", portion_g: 200, food: food(4.8) }),
    item({ food_id: "f3", portion_g: 30, food: food(1.2) }),
  ];
  eq("bread item", resolveItemCarbs(items[0], items[0].food), 24.3);
  eq("milk item", resolveItemCarbs(items[1], items[1].food), 9.6);
  eq("cheese item", resolveItemCarbs(items[2], items[2].food), 0.4);
  // The total is what the listed rows add up to, exactly.
  eq("total carbs", templateCarbs(items), 34.3);
  eq("total portion", templatePortionG(items), 280);

  // carbs_g_fixed wins over everything, including a live food that would derive
  // a different number (the "template out of a typed-name meal" path).
  const fixed = item({
    food_id: "f1",
    portion_g: 100,
    carb_100g_snapshot: 20,
    carbs_g_fixed: 7.5,
    food: food(48.5),
  });
  eq("carbs_g_fixed beats the live value", resolveItemCarbs(fixed, fixed.food), 7.5);
  // An explicit ZERO is a real answer (tea, water) and must not fall through to
  // the derivation, or a zero-carb item would be impossible to store.
  const zeroFixed = item({ portion_g: 100, carb_100g_snapshot: 20, carbs_g_fixed: 0 });
  eq("carbs_g_fixed of 0 is respected", resolveItemCarbs(zeroFixed, zeroFixed.food), 0);

  // A portion of 0 derives 0 and never a division by zero / NaN.
  const noPortion = item({ food_id: "f1", portion_g: 0, food: food(48.5) });
  eq("a portion of 0 derives 0 carbs", resolveItemCarbs(noPortion, noPortion.food), 0);
  const onlyZero: TemplateItemWithFood[] = [noPortion];
  eq("a template of empty portions totals 0", templateCarbs(onlyZero), 0);
  eq("an empty template totals 0", templateCarbs([]), 0);
  eq("an empty template has no portion", templatePortionG([]), 0);

  // Rounding: one decimal, per item and on the total.
  const third = item({ food_id: "f1", portion_g: 33, food: food(33.33) });
  eq("an item rounds to one decimal", resolveItemCarbs(third, third.food), 11);
  const thirds: TemplateItemWithFood[] = [
    item({ food_id: "f1", portion_g: 100, food: food(33.33) }),
    item({ food_id: "f2", portion_g: 100, food: food(33.33) }),
    item({ food_id: "f3", portion_g: 100, food: food(33.33) }),
  ];
  eq("the total is the sum of the rounded items", templateCarbs(thirds), 99.9);
  eq(
    "so the total equals what the rows show",
    templateCarbs(thirds),
    Math.round(
      thirds.reduce((sum, i) => sum + resolveItemCarbs(i, i.food), 0) * 10
    ) / 10
  );

  // A stored non-number cannot poison the dose the user is about to take.
  const broken = item({
    food_id: "f1",
    portion_g: Number.NaN,
    food: food(Number.POSITIVE_INFINITY),
  });
  eq("a non-finite stored value reads as 0", resolveItemCarbs(broken, broken.food), 0);
  const negative = item({ portion_g: -100, carb_100g_snapshot: 20 });
  eq("a negative portion cannot subtract carbs", resolveItemCarbs(negative, null), 0);
}

// ── B. the snapshot rule ──────────────────────────────────────────────────────
section("B. snapshot vs. live catalogue value");
{
  // The user typed 20 g/100 g when adding the item and has since CORRECTED their
  // food to 40. That is a fix of a wrong number, so the live value has to win -
  // going on with 20 would keep producing half the dose.
  const corrected = item({
    food_id: "f1",
    portion_g: 100,
    carb_100g_snapshot: 20,
    name_snapshot: "Kendi ekmegim",
    food: food(40, { name_tr: "Ekmek", name_en: "Bread", name_de: "Brot" }),
  });
  eq("the live value wins", resolveItemCarbs(corrected, corrected.food), 40);

  // The catalogue row is gone (custom food deleted → food_id nulled by the FK, or
  // simply unresolvable): the snapshot is the insurance, not a zero.
  const orphan = item({
    food_id: "f1",
    portion_g: 100,
    carb_100g_snapshot: 20,
    name_snapshot: "Kendi ekmegim",
    food: null,
  });
  eq("a lost catalogue row falls back to the snapshot", resolveItemCarbs(orphan, null), 20);
  const nulled = item({
    food_id: null,
    portion_g: 100,
    carb_100g_snapshot: 20,
    name_snapshot: "Kendi ekmegim",
    food: null,
  });
  eq("a nulled food_id still counts its snapshot", resolveItemCarbs(nulled, null), 20);

  // Names: the live row follows the app language, the snapshot never moves.
  const liveTr = resolveTemplateItem(corrected, "tr");
  const liveEn = resolveTemplateItem(corrected, "en");
  const liveDe = resolveTemplateItem(corrected, "de");
  eq("live name in tr", liveTr.name, "Ekmek");
  eq("live name in en", liveEn.name, "Bread");
  eq("live name in de", liveDe.name, "Brot");
  eq("a live item is not flagged", liveTr.missingFood, false);

  const goneTr = resolveTemplateItem(orphan, "tr");
  const goneEn = resolveTemplateItem(orphan, "en");
  eq("the snapshot name is shown when the food is gone", goneTr.name, "Kendi ekmegim");
  eq("the snapshot name is not re-translated", goneEn.name, goneTr.name);
  // The row says why it is showing stored values (templates.missingFood).
  eq("a lost catalogue row is flagged", goneTr.missingFood, true);
  // A typed-name item never had a catalogue row, so there is no gap to report.
  eq("a typed-name item is not flagged as missing", resolveTemplateItem(nulled, "tr").missingFood, false);
  eq("a typed-name item shows its own name", resolveTemplateItem(nulled, "en").name, "Kendi ekmegim");
  eq("the resolved item carries its carbs", goneTr.carbs_g, 20);
  eq("the resolved item carries its portion", goneTr.portion_g, 100);
}

// ── C. synthetic-food equivalence (the one-tap log's dose) ────────────────────
section("C. one meal row doses like one synthetic food");
{
  const items: TemplateItemWithFood[] = [
    item({ food_id: "f1", portion_g: 50, food: food(48.5) }),
    item({ food_id: "f2", portion_g: 200, food: food(4.8) }),
    item({ food_id: "f3", portion_g: 30, food: food(1.2) }),
  ];
  const total = templateCarbs(items);
  eq("the template total", total, 34.3);

  // A template is logged as ONE meal row carrying the total. The calculator then
  // treats that row as a food whose carb_100g IS the total, at a 100 g portion -
  // this identity is what makes the two paths give the same dose.
  const est = estimateInsulin({ carb_100g: total }, 100, PROFILE, { slot: "lunch" });
  eq("the synthetic food reproduces the total exactly", est.carbs, total);
  eq("mealDose is the total over the slot's ratio", est.mealDose, Math.round((total / 12) * 100) / 100);
  eq("with no reading there is no correction", est.correctionDose, 0);
  eq("the slot given is the slot used", est.slot, "lunch");

  // Same carbs, different hour = different ratio. The slot comes from the CLOCK,
  // never from the template's own slot label.
  const breakfast = estimateInsulin({ carb_100g: total }, 100, PROFILE, {
    now: new Date(2026, 6, 1, 7, 30),
  });
  eq("07:30 uses the breakfast ratio", breakfast.slot, "breakfast");
  eq("breakfast dose", breakfast.mealDose, Math.round((total / 10) * 100) / 100);
  const evening = estimateInsulin({ carb_100g: total }, 100, PROFILE, {
    now: new Date(2026, 6, 1, 20, 30),
  });
  eq("20:30 uses the dinner ratio", evening.slot, "dinner");

  // An empty template writes a 0 g row: no dose, and nothing invented.
  const empty = estimateInsulin({ carb_100g: templateCarbs([]) }, 100, PROFILE, {
    slot: "lunch",
  });
  eq("an empty template doses nothing", empty.mealDose, 0);
  eq("and its total dose is 0", empty.totalDose, 0);
}

// ── D. rankTemplates across the clock ────────────────────────────────────────
section("D. template order");
{
  const breakfast = template({ id: "b", slot: "breakfast", sort_order: 0 });
  const lunch = template({ id: "l", slot: "lunch", sort_order: 0 });
  const dinner = template({ id: "d", slot: "dinner", sort_order: 0 });
  const snack = template({ id: "s", slot: null, sort_order: 0 });
  const all = [dinner, snack, lunch, breakfast];
  const ids = (list: MealTemplate[]) => list.map((t) => t.id).join(",");

  // The matching slot first, then the slot-less ones (they fit any hour), then
  // the rest. 08:00 / 13:00 / 20:00 local.
  eq("08:00 puts breakfast first", ids(rankTemplates(all, new Date(2026, 6, 1, 8, 0))), "b,s,d,l");
  eq("13:00 puts lunch first", ids(rankTemplates(all, new Date(2026, 6, 1, 13, 0))), "l,s,d,b");
  eq("20:00 puts dinner first", ids(rankTemplates(all, new Date(2026, 6, 1, 20, 0))), "d,s,l,b");
  // The slot boundaries are the app's own (mealSlotForHour): 11:00 is lunch and
  // 02:00 is still dinner.
  eq("10:59 is still breakfast", ids(rankTemplates(all, new Date(2026, 6, 1, 10, 59))), "b,s,d,l");
  eq("11:00 is lunch", ids(rankTemplates(all, new Date(2026, 6, 1, 11, 0))), "l,s,d,b");
  eq("02:00 is dinner", ids(rankTemplates(all, new Date(2026, 6, 1, 2, 0))), "d,s,l,b");

  // Inside a group the user's own arrangement comes first.
  const arranged = [
    template({ id: "third", slot: "breakfast", sort_order: 2 }),
    template({ id: "first", slot: "breakfast", sort_order: 0 }),
    template({ id: "second", slot: "breakfast", sort_order: 1 }),
  ];
  eq(
    "sort_order wins inside a group",
    ids(rankTemplates(arranged, new Date(2026, 6, 1, 8, 0))),
    "first,second,third"
  );

  // Then most recently used, with never-used LAST.
  const used = [
    template({ id: "never", slot: "breakfast", last_used_at: null }),
    template({ id: "old", slot: "breakfast", last_used_at: "2026-07-01T08:00:00.000Z" }),
    template({ id: "recent", slot: "breakfast", last_used_at: "2026-07-28T08:00:00.000Z" }),
  ];
  eq(
    "recently used first, never-used last",
    ids(rankTemplates(used, new Date(2026, 6, 1, 8, 0))),
    "recent,old,never"
  );

  // Then the oldest template, and finally the incoming order (stable).
  const created = [
    template({ id: "new", slot: null, created_at: "2026-07-20T00:00:00.000Z" }),
    template({ id: "old", slot: null, created_at: "2026-02-02T00:00:00.000Z" }),
  ];
  eq(
    "created_at breaks the tie oldest first",
    ids(rankTemplates(created, new Date(2026, 6, 1, 8, 0))),
    "old,new"
  );
  const identical = [
    template({ id: "a", slot: null }),
    template({ id: "b", slot: null }),
    template({ id: "c", slot: null }),
  ];
  eq(
    "a full tie keeps the incoming order",
    ids(rankTemplates(identical, new Date(2026, 6, 1, 8, 0))),
    "a,b,c"
  );

  // Ordering never mutates or drops anything.
  const before = ids(all);
  const ranked = rankTemplates(all, new Date(2026, 6, 1, 8, 0));
  eq("the input array is untouched", ids(all), before);
  eq("every template comes back", ranked.length, all.length);
  eq("ordering an empty list is empty", rankTemplates([], new Date()).length, 0);
}

// ── E. groupMealsBySlot: day and slot boundaries ─────────────────────────────
section("E. grouping past meals into day + slot");
{
  const meals = [
    { id: "m1", logged_at: at(2026, 7, 1, 8, 0) }, // Jul 1 breakfast
    { id: "m2", logged_at: at(2026, 7, 1, 8, 30) }, // Jul 1 breakfast
    { id: "m3", logged_at: at(2026, 7, 1, 13, 0) }, // Jul 1 lunch
    { id: "m4", logged_at: at(2026, 7, 2, 8, 0) }, // Jul 2 breakfast
  ];
  const groups = groupMealsBySlot(meals);
  eq("four meals make three buckets", groups.length, 3);
  // Newest group first.
  eq("the newest group comes first", groups[0].meals.map((m) => m.id).join(","), "m4");
  eq("its day key", groups[0].dateKey, "2026-07-02");
  eq("its slot", groups[0].slot, "breakfast");
  eq("its key shape", groups[0].key, "2026-07-02|breakfast");
  eq("the same day + slot is one bucket", groups[2].meals.map((m) => m.id).join(","), "m1,m2");
  eq("within a bucket the order is chronological", groups[2].meals[0].id, "m1");
  eq("the bucket carries its newest timestamp", groups[2].lastAt, meals[1].logged_at);
  eq("a different slot on the same day is its own bucket", groups[1].meals[0].id, "m3");
  eq("and knows its slot", groups[1].slot, "lunch");

  // Slot boundary on one day: 10:59 breakfast vs 11:00 lunch.
  const boundary = groupMealsBySlot([
    { id: "early", logged_at: at(2026, 7, 1, 10, 59) },
    { id: "late", logged_at: at(2026, 7, 1, 11, 0) },
  ]);
  eq("10:59 and 11:00 do not share a bucket", boundary.length, 2);
  eq("11:00 is the lunch bucket", boundary[0].slot, "lunch");
  eq("10:59 is the breakfast bucket", boundary[1].slot, "breakfast");

  // Day boundary: the dinner slot runs past midnight, but 23:00 and 01:00 are two
  // different days on the user's calendar. Merging them would file last night's
  // dinner under today.
  const midnight = groupMealsBySlot([
    { id: "before", logged_at: at(2026, 7, 1, 23, 0) },
    { id: "after", logged_at: at(2026, 7, 2, 1, 0) },
  ]);
  eq("either side of midnight is two buckets", midnight.length, 2);
  eq("both are dinner", `${midnight[0].slot},${midnight[1].slot}`, "dinner,dinner");
  eq("the later one is dated the next day", midnight[0].dateKey, "2026-07-02");
  eq("the earlier one keeps its own day", midnight[1].dateKey, "2026-07-01");

  // 17:00 opens dinner; 16:59 is still lunch.
  const evening = groupMealsBySlot([
    { id: "lunch", logged_at: at(2026, 7, 1, 16, 59) },
    { id: "dinner", logged_at: at(2026, 7, 1, 17, 0) },
  ]);
  eq("16:59 vs 17:00 are two buckets", evening.length, 2);
  eq("17:00 is dinner", evening[0].slot, "dinner");
  eq("16:59 is lunch", evening[1].slot, "lunch");
  // 06:00 opens breakfast; 05:59 still belongs to the night's dinner slot.
  const dawn = groupMealsBySlot([
    { id: "night", logged_at: at(2026, 7, 1, 5, 59) },
    { id: "morning", logged_at: at(2026, 7, 1, 6, 0) },
  ]);
  eq("05:59 vs 06:00 are two buckets", dawn.length, 2);
  eq("06:00 is breakfast", dawn[0].slot, "breakfast");
  eq("05:59 is still dinner", dawn[1].slot, "dinner");

  // A timestamp that cannot be read has no day and no slot; inventing one would
  // misdate a record.
  eq("an unreadable timestamp is skipped", groupMealsBySlot([{ logged_at: "not a date" }]).length, 0);
  eq("grouping nothing gives nothing", groupMealsBySlot([]).length, 0);
}

// ── F. the storage rules, pinned from the source ─────────────────────────────
section("F. storage rules (read from the source)");
{
  const fs = require("fs") as {
    readFileSync: (p: string, enc: string) => string;
    existsSync: (p: string) => boolean;
  };
  const nodePath = require("path") as {
    join: (...parts: string[]) => string;
    dirname: (p: string) => string;
  };
  const ROOT = (() => {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      if (
        fs.existsSync(nodePath.join(dir, "package.json")) &&
        fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"))
      ) {
        return dir;
      }
      dir = nodePath.dirname(dir);
    }
    throw new Error("could not locate the repo root from " + __dirname);
  })();
  const src = (rel: string): string =>
    fs.readFileSync(nodePath.join(ROOT, rel), "utf8");

  const logs = src("lib/db/logs.ts");
  const recent = logs.slice(logs.indexOf("export async function getRecentMeals"));
  // A template row must not also appear as a "recent meal" chip: that path re-logs
  // frozen totals under the template's name, reads none of its current items,
  // offers no undo and arms no reminder.
  ok(
    "getRecentMeals excludes template rows",
    /AND meal_template_id IS NULL/.test(recent)
  );
  ok(
    "and filters them in the inner, index-served query",
    recent.indexOf("meal_template_id IS NULL") < recent.indexOf("LEFT JOIN foods")
  );
  ok(
    "addMealLog stores the source template",
    /meal_template_id\)/.test(logs) && /input\.meal_template_id \?\? null/.test(logs)
  );

  const templates = src("lib/db/mealTemplates.ts");
  const del = templates.slice(templates.indexOf("export async function deleteTemplate"));
  const delBody = del.slice(0, del.indexOf("\n}"));
  // Deleting a recipe is "I stopped eating this", never "that never happened".
  ok("deleteTemplate touches meal_templates only", /DELETE FROM meal_templates/.test(delBody));
  ok("deleteTemplate never deletes a logged meal", !/meal_logs/.test(delBody));

  const logTpl = templates.slice(templates.indexOf("export async function logTemplate"));
  ok(
    "logTemplate refuses a template from another profile",
    /belongs to another profile/.test(logTpl)
  );
  ok(
    "and checks it BEFORE writing anything",
    logTpl.indexOf("belongs to another profile") < logTpl.indexOf("addMealLog(")
  );
  ok(
    "logTemplate writes exactly one meal row",
    (logTpl.match(/addMealLog\(/g) ?? []).length === 1
  );
  ok(
    "the row is named after the template and carries the totals",
    /custom_food_name: owner\.name/.test(logTpl) &&
      /portion_g: templatePortionG\(items\)/.test(logTpl) &&
      /calculated_carbs_g: templateCarbs\(items\)/.test(logTpl)
  );
  ok(
    "replaceTemplateItems is one transaction",
    /replaceTemplateItems[\s\S]*?withTransactionAsync/.test(templates)
  );
  ok(
    "reorderTemplates is scoped to the profile",
    /SET sort_order = \? WHERE id = \? AND profile_id = \?/.test(templates)
  );
  ok(
    "touchTemplate only ever moves last_used_at forward",
    /last_used_at IS NULL OR last_used_at < \?/.test(templates)
  );

  const dbIndex = src("lib/db/index.ts");
  const clear = dbIndex.slice(dbIndex.indexOf("export async function clearAllLogs"));
  const clearBody = clear.slice(0, clear.indexOf("\n}"));
  // A template is a recipe, not a record: clearing the history leaves it alone.
  ok("clearAllLogs leaves the templates alone", !/meal_template/.test(clearBody));
  ok(
    "a fresh install creates the template tables",
    /V13_CREATE/.test(dbIndex) && /meal_template_id TEXT/.test(dbIndex)
  );

  const pure = src("lib/mealTemplates.ts");
  // The pure module has to stay runnable under node (this file imports it), so it
  // may not reach for react, expo-sqlite or the database layer that opens it.
  const pureImports = (pure.match(/^import .*$/gm) ?? []).join("\n");
  ok("the pure module imports no react", !/react/.test(pureImports));
  ok("the pure module imports no expo-sqlite", !/expo-sqlite/.test(pureImports));
  ok("the pure module does not open the database", !/db\/index/.test(pureImports));
  // The carb ratio never comes from the template's slot label.
  ok("the slot is ordering only, never a ratio", !/carbRatio|carb_ratio/.test(pure));
}

// ── G. the editor's helpers ───────────────────────────────────────────────────
section("G. editor helpers (name fold, portion edit, link portions)");
{
  // The duplicate-name fold. SQLite's NOCASE only folds A-Z, so the dotted/dotless
  // I is exactly where a Turkish duplicate hides; every member of that family folds
  // to a plain "i" here.
  eq("a dotted capital I folds", normalizeTemplateName("İskender"), "iskender");
  eq("a plain capital I folds the same way", normalizeTemplateName("Iskender"), "iskender");
  eq("a dotless i folds the same way", normalizeTemplateName("ıskender"), "iskender");
  eq("case is folded", normalizeTemplateName("KAHVALTI"), "kahvalti");
  eq("other Turkish letters survive", normalizeTemplateName("Çörek Güveç"), "çörek güveç");
  eq("inner whitespace collapses", normalizeTemplateName("  sabah   menüsü  "), "sabah menüsü");
  eq("an empty name normalizes to nothing", normalizeTemplateName("   "), "");

  const existing = [
    { id: "t1", name: "İskender" },
    { id: "t2", name: "Kahvaltı" },
  ];
  ok("the Turkish pair is caught", templateNameTaken("iskender", existing));
  ok("an unrelated name is free", !templateNameTaken("Mercimek", existing));
  ok(
    "a template does not collide with itself",
    !templateNameTaken("İskender", existing, "t1")
  );
  ok(
    "but it does collide with a sibling",
    templateNameTaken("İskender", existing, "t2")
  );
  // An empty name is a missing name, not a duplicate one: the CTA blocks it, and
  // flagging it as taken would put the wrong sentence under the field.
  ok("an empty name is never taken", !templateNameTaken("  ", existing));

  // Editing a portion goes through the SAME rule (resolveItemCarbs), so an editor
  // cannot drift into a second one.
  const bread = resolveTemplateItem(
    item({ food_id: "f1", portion_g: 50, food: food(48.5) }),
    "tr"
  );
  eq("the resolved item carries its per-100 value", bread.carb_100g, 48.5);
  eq("and its carbs", bread.carbs_g, 24.3);
  const doubled = applyItemPortion(bread, 100);
  eq("a doubled portion doubles the carbs", doubled.carbs_g, 48.5);
  eq("and records the new portion", doubled.portion_g, 100);
  eq("a portion of 0 derives 0", applyItemPortion(bread, 0).carbs_g, 0);
  eq("a negative portion cannot subtract", applyItemPortion(bread, -50).carbs_g, 0);

  // A stored carb total has no per-100 value under it to scale.
  const typed = resolveTemplateItem(
    item({ food_id: null, name_snapshot: "Ev yemegi", carbs_g_fixed: 42, portion_g: 0 }),
    "tr"
  );
  eq("a fixed item keeps its total at any portion", applyItemPortion(typed, 250).carbs_g, 42);

  // The editor's totals and the stored-row totals are the same arithmetic.
  const stored: TemplateItemWithFood[] = [
    item({ food_id: "f1", portion_g: 100, food: food(33.33) }),
    item({ food_id: "f2", portion_g: 100, food: food(33.33) }),
    item({ food_id: "f3", portion_g: 100, food: food(33.33) }),
  ];
  const resolved = stored.map((i) => resolveTemplateItem(i, "tr"));
  eq("resolvedTotals matches templateCarbs", resolvedTotals(resolved).carbs_g, templateCarbs(stored));
  eq(
    "and templatePortionG",
    resolvedTotals(resolved).portion_g,
    templatePortionG(stored)
  );
  eq("empty totals are zero", resolvedTotals([]).carbs_g, 0);

  // The portions a link may carry: all or nothing, because a partially-read set
  // would under- or over-state the carbs a dose is then estimated from.
  eq("a clean list parses", JSON.stringify(parsePortions("50,200,30", 3)), "[50,200,30]");
  eq("a decimal portion is kept to one place", JSON.stringify(parsePortions("50.55", 1)), "[50.6]");
  eq("a short list is rejected", parsePortions("50,200", 3), null);
  eq("a long list is rejected", parsePortions("50,200,30,10", 3), null);
  eq("junk is rejected", parsePortions("50,abc,30", 3), null);
  eq("a negative portion is rejected", parsePortions("50,-1,30", 3), null);
  eq("no csv means no override", parsePortions(undefined, 3), null);
  eq("an empty csv means no override", parsePortions("", 0), null);
  eq(
    "formatPortions round-trips",
    JSON.stringify(parsePortions(formatPortions(resolved), resolved.length)),
    "[100,100,100]"
  );

  // Past meals → items. The app never invents the template's name, and it never
  // loses the carbs of a meal it cannot derive from.
  const fromMeals = templateItemsFromMeals([
    {
      food_id: "f1",
      display_name: "Ekmek",
      category: "bakery",
      portion_g: 50,
      calculated_carbs_g: 24.3,
    },
    {
      food_id: null,
      display_name: "Annemin yemegi",
      category: null,
      portion_g: 0,
      calculated_carbs_g: 42,
    },
    {
      food_id: "f9",
      display_name: "Porsiyonsuz",
      category: "dishes",
      portion_g: 0,
      calculated_carbs_g: 17,
    },
  ]);
  eq("one item per meal", fromMeals.length, 3);
  eq("the catalogue link is kept", fromMeals[0].food_id, "f1");
  eq("the recorded carbs are reproduced exactly", fromMeals[0].carbs_g, 24.3);
  eq("a derivable item stores no fixed total", fromMeals[0].carbs_g_fixed, null);
  eq(
    "and its back-derived per-100 value reproduces them",
    applyItemPortion(fromMeals[0], 50).carbs_g,
    24.3
  );
  eq("the category comes along for the row's plate", fromMeals[0].category, "bakery");
  eq("a typed-name meal stores its total outright", fromMeals[1].carbs_g_fixed, 42);
  eq("and keeps its name", fromMeals[1].name, "Annemin yemegi");
  // A catalogue meal with no portion has nothing to derive from, so the recorded
  // total is stored rather than collapsing to 0.
  eq("a portionless catalogue meal stores its total too", fromMeals[2].carbs_g_fixed, 17);
  eq("so its carbs survive", fromMeals[2].carbs_g, 17);
  eq("the order eaten is the order stored", fromMeals[1].sort_order, 1);
  eq("nothing is prefilled from nothing", templateItemsFromMeals([]).length, 0);
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
