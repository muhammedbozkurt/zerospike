/**
 * lib/insulinCatalog.ts correctness harness. No jest, same standalone style as
 * scripts/postMealTimer.test.ts.
 *
 * The property under test: every id a profile could already have stored is
 * still in the catalog (ids are DB data, never renamed or removed); the
 * "mix" category is its own picker slot (P9 - basal/bolus/mix pickers are now
 * each a homogeneous, single-category list; productsForSlot was removed since
 * every caller now calls productsByCategory(slot) directly, the same
 * function, with slot === category); and isMixSelection correctly re-derives
 * "this profile is on a premix" with no dedicated DB column.
 *
 * Run: npx tsx scripts/insulinCatalog.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  INSULIN_PRODUCTS,
  OTHER_PRODUCT_ID,
  DEFAULT_BASAL_PROFILE,
  DEFAULT_BOLUS_PROFILE,
  basalProfileFor,
  bolusProfileFor,
  insulinProductById,
  productsByCategory,
  isMixSelection,
} from "../lib/insulinCatalog";

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
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike insulinCatalog test");

section("A. every id is unique - DB data, never a collision");
{
  const ids = INSULIN_PRODUCTS.map((p) => p.id);
  eq("no duplicate ids", new Set(ids).size, ids.length, );
}

section("B. every pre-v22 id is still present, unrenamed and unremoved");
{
  const PRE_V22_IDS = [
    "faster_aspart",
    "aspart",
    "lispro",
    "lispro_aabc",
    "glulisine",
    "regular_human",
    "nph",
    "detemir",
    "glargine_u100",
    "glargine_u300",
    "degludec",
  ];
  eq("exactly 11 pre-existing ids checked", PRE_V22_IDS.length, 11);
  for (const id of PRE_V22_IDS) {
    ok(`${id} is still in the catalog`, insulinProductById(id) !== null);
  }
}

section("C. the brand names the user asked for are all in the catalog");
{
  const WANTED_LABELS = [
    "Lantus",
    "Toujeo",
    "Tresiba",
    "Levemir",
    "Basaglar",
    "Abasaglar",
    "Semglee",
    "Insulatard / Humulin N",
    "NovoRapid",
    "Fiasp",
    "Humalog",
    "Lyumjev",
    "Apidra",
    "Actrapid",
    "Humulin R",
    "NovoMix",
    "Ryzodeg",
    "Humalog Mix",
    "Mixtard",
  ];
  const labels = INSULIN_PRODUCTS.map((p) => p.label);
  eq("exactly 19 products", INSULIN_PRODUCTS.length, 19);
  for (const label of WANTED_LABELS) {
    ok(`"${label}" is in the catalog`, labels.includes(label));
  }
}

section("D. Novolog was deliberately not added as a separate id");
{
  ok("no aspart_novolog id", insulinProductById("aspart_novolog") === null);
}

section("E. OTHER_PRODUCT_ID is a real sentinel, not a catalog entry");
{
  eq("the sentinel is 'other'", OTHER_PRODUCT_ID, "other");
  eq("'other' is not in the catalog", insulinProductById(OTHER_PRODUCT_ID), null);
  eq("basalProfileFor('other') falls back to the generic profile",
    basalProfileFor(OTHER_PRODUCT_ID), DEFAULT_BASAL_PROFILE);
  eq("bolusProfileFor('other') falls back to the generic profile",
    bolusProfileFor(OTHER_PRODUCT_ID), DEFAULT_BOLUS_PROFILE);
}

section("F. an unknown or null id still falls back, unchanged behaviour");
{
  eq("basalProfileFor(null)", basalProfileFor(null), DEFAULT_BASAL_PROFILE);
  eq("basalProfileFor(undefined)", basalProfileFor(undefined), DEFAULT_BASAL_PROFILE);
  eq("basalProfileFor('nonsense')", basalProfileFor("nonsense"), DEFAULT_BASAL_PROFILE);
  eq("bolusProfileFor(null)", bolusProfileFor(null), DEFAULT_BOLUS_PROFILE);
  eq("bolusProfileFor('nonsense')", bolusProfileFor("nonsense"), DEFAULT_BOLUS_PROFILE);
  // A basal-only id must not leak into the bolus profile, and vice versa.
  eq("bolusProfileFor(a pure basal id) falls back", bolusProfileFor("glargine_u100"), DEFAULT_BOLUS_PROFILE);
  eq("basalProfileFor(a pure bolus id) falls back", basalProfileFor("aspart"), DEFAULT_BASAL_PROFILE);
}

section("G. productsByCategory('mix') and category-only lists");
{
  const mix = productsByCategory("mix");
  eq("4 mix products", mix.length, 4);
  ok("every mix product really is category mix", mix.every((p) => p.category === "mix"));
  eq("basal-only list excludes mix", productsByCategory("basal").some((p) => p.category === "mix"), false);
  eq("bolus-only list excludes mix", productsByCategory("bolus").some((p) => p.category === "mix"), false);
}

section("H. each slot's picker list is single-category (P9): basal and bolus never carry a mix product, mirroring productsByCategory directly");
{
  const basalSlot = productsByCategory("basal");
  const bolusSlot = productsByCategory("bolus");
  const mixSlot = productsByCategory("mix");

  ok("basal slot has no mix entry", basalSlot.every((p) => p.category === "basal"));
  ok("bolus slot has no mix entry", bolusSlot.every((p) => p.category === "bolus"));
  ok("mix slot is only mix entries", mixSlot.every((p) => p.category === "mix"));
  eq("basal slot excludes every mix id",
    basalSlot.some((p) => mixSlot.some((m) => m.id === p.id)), false);
  eq("bolus slot excludes every mix id",
    bolusSlot.some((p) => mixSlot.some((m) => m.id === p.id)), false);
}

section("H2. isMixSelection: derives premix from two matching ids, no DB column");
{
  eq("same mix id in both slots is a premix",
    isMixSelection("mix_aspart", "mix_aspart"), true);
  eq("a mix id paired with a plain bolus id is not a premix",
    isMixSelection("mix_aspart", "aspart"), false);
  eq("the same NON-mix id in both slots is still not a premix",
    isMixSelection("glargine_u100", "glargine_u100"), false);
  eq("both null is not a premix", isMixSelection(null, null), false);
  eq("both undefined is not a premix", isMixSelection(undefined, undefined), false);
  eq("one side null is not a premix", isMixSelection("mix_aspart", null), false);
  eq("two different mix ids is not a premix (never happens via the UI, but not a crash either)",
    isMixSelection("mix_aspart", "mix_lispro"), false);
  eq("OTHER_PRODUCT_ID in both slots is not a premix (not a catalog category)",
    isMixSelection(OTHER_PRODUCT_ID, OTHER_PRODUCT_ID), false);
}

section("I. a mix product's own PK values drive both slots' profile");
{
  const mixAspart = insulinProductById("mix_aspart");
  ok("mix_aspart exists", mixAspart !== null);
  if (mixAspart) {
    eq("basalProfileFor(mix_aspart) returns the mix product itself",
      basalProfileFor("mix_aspart"), mixAspart);
    eq("bolusProfileFor(mix_aspart) returns the same mix product",
      bolusProfileFor("mix_aspart"), mixAspart);
    eq("mix_aspart peak", mixAspart.peakHours, 1.5);
    eq("mix_aspart duration", mixAspart.durationHours, 16);
  }

  const ryzodeg = insulinProductById("mix_degludec_aspart");
  ok("mix_degludec_aspart (Ryzodeg) exists", ryzodeg !== null);
  if (ryzodeg) {
    eq("Ryzodeg peak", ryzodeg.peakHours, 1.5);
    eq("Ryzodeg duration", ryzodeg.durationHours, 24);
  }

  const humalogMix = insulinProductById("mix_lispro");
  ok("mix_lispro (Humalog Mix) exists", humalogMix !== null);
  if (humalogMix) {
    eq("Humalog Mix peak", humalogMix.peakHours, 1.5);
    eq("Humalog Mix duration", humalogMix.durationHours, 16);
  }

  const mixtard = insulinProductById("mix_human");
  ok("mix_human (Mixtard) exists", mixtard !== null);
  if (mixtard) {
    eq("Mixtard peak", mixtard.peakHours, 3);
    eq("Mixtard duration", mixtard.durationHours, 16);
  }
}

section("J. the new humulin_r id, distinct from regular_human");
{
  const humulinR = insulinProductById("humulin_r");
  ok("humulin_r exists", humulinR !== null);
  if (humulinR) {
    eq("label", humulinR.label, "Humulin R");
    eq("category", humulinR.category, "bolus");
    eq("peak", humulinR.peakHours, 2.5);
    eq("duration", humulinR.durationHours, 6.5);
  }
  const actrapid = insulinProductById("regular_human");
  ok("regular_human (Actrapid) still exists separately", actrapid !== null);
  if (actrapid) eq("Actrapid label no longer bundles Humulin R", actrapid.label, "Actrapid");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
