/**
 * lib/db/undoSql.ts (the pure planning half of lib/db/undo.ts) + lib/feedback.ts's
 * undo timing, correctness harness. No jest, same standalone style as
 * scripts/journalSlice.test.ts.
 *
 * lib/db/undo.ts itself imports expo-sqlite (via ./index) and cannot be loaded
 * by plain Node, so - same arrangement as journalSql.ts/healthImportSql.ts - the
 * table-order decision it runs (planRestoreSteps) lives in a dependency-free
 * sibling module this file imports directly.
 *
 * Run: npx tsx scripts/undoDelete.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  deletedMealsFromSnapshot,
  planRestoreSteps,
  type DeletionSnapshot,
  type Row,
} from "../lib/db/undoSql";
import {
  planAftermathReplay,
  shouldRestoreBatch,
  undoBatchWindowMs,
  UNDO_TOAST_MS,
  UNDO_TOAST_SCREEN_READER_MS,
} from "../lib/feedback";

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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

console.log("zerospike undo/delete test");

const sugarRow = (id: string): Row => ({
  id,
  profile_id: "p1",
  glucose_level_mgdl: 110,
  period_tag: "fasting",
  source: "manual",
  logged_at: "2026-08-20T09:00:00.000Z",
  tags: "[]",
  healthkit_uuid: "hk-1",
});

console.log("\nA. a glucose snapshot's linked meal ids drive a relink step");
{
  const snap: DeletionSnapshot = { sugar: [sugarRow("s1")], linkedMealIds: ["m1"] };
  const steps = planRestoreSteps(snap);
  const relink = steps.find((s) => s.op === "relinkMealsToSugar");
  ok("a relink step exists", relink != null);
  if (relink && relink.op === "relinkMealsToSugar") {
    eq("it targets the sugar log's own id", relink.sugarLogId, "s1");
    eq("and carries the one linked meal", relink.mealIds, ["m1"]);
  }
}

console.log("\nB. no linked meal - the relink step is skipped entirely");
{
  const noneGiven: DeletionSnapshot = { sugar: [sugarRow("s1")] };
  const emptyList: DeletionSnapshot = { sugar: [sugarRow("s1")], linkedMealIds: [] };
  for (const [label, snap] of [
    ["linkedMealIds omitted", noneGiven],
    ["linkedMealIds empty", emptyList],
  ] as const) {
    const steps = planRestoreSteps(snap);
    ok(`${label}: no relink step`, !steps.some((s) => s.op === "relinkMealsToSugar"));
  }
}

console.log("\nC. restore order: sugar_logs is inserted BEFORE meal_logs is relinked");
{
  const snap: DeletionSnapshot = { sugar: [sugarRow("s1")], linkedMealIds: ["m1", "m2"] };
  const steps = planRestoreSteps(snap);
  const sugarIndex = steps.findIndex((s) => s.op === "insert" && s.table === "sugar_logs");
  const relinkIndex = steps.findIndex((s) => s.op === "relinkMealsToSugar");
  ok("both steps are present", sugarIndex >= 0 && relinkIndex >= 0);
  ok("sugar_logs insert comes first", sugarIndex < relinkIndex, `sugar at ${sugarIndex}, relink at ${relinkIndex}`);
}

console.log("\nD. non-glucose kinds carry no linked-row plan");
{
  const mealSnap: DeletionSnapshot = {
    meals: [{ id: "m1", profile_id: "p1" }],
    injections: [{ id: "i1", meal_log_id: "m1", source: "calculator" }],
  };
  const injectionSnap: DeletionSnapshot = { injections: [{ id: "i2" }] };
  const medSnap: DeletionSnapshot = { meds: [{ id: "d1" }] };
  for (const [label, snap] of [
    ["meal", mealSnap],
    ["injection", injectionSnap],
    ["med", medSnap],
  ] as const) {
    const steps = planRestoreSteps(snap);
    ok(`${label}: no relink step`, !steps.some((s) => s.op === "relinkMealsToSugar"));
  }
  // The meal snapshot's OWN linked row (the calculator's bolus) still restores -
  // this is a different link (deleteMealLog's own cascade), not the glucose case.
  const mealSteps = planRestoreSteps(mealSnap);
  ok(
    "a meal's own linked injection still gets an insert step",
    mealSteps.some((s) => s.op === "insert" && s.table === "injection_logs")
  );
}

console.log("\nE. multiple meals linked to the same reading - all come back");
{
  const snap: DeletionSnapshot = {
    sugar: [sugarRow("s1")],
    linkedMealIds: ["m1", "m2", "m3"],
  };
  const relink = planRestoreSteps(snap).find((s) => s.op === "relinkMealsToSugar");
  ok("relink step exists", relink != null);
  if (relink && relink.op === "relinkMealsToSugar") {
    eq("all three meals are carried", relink.mealIds, ["m1", "m2", "m3"]);
  }
}

console.log("\nF. the undo window and the toast it rides on share ONE constant");
{
  eq("the user's requested window", UNDO_TOAST_MS, 5000);
  eq(
    "the batch stays open past the toast by the same margin every time",
    undoBatchWindowMs(UNDO_TOAST_MS) - UNDO_TOAST_MS,
    undoBatchWindowMs(UNDO_TOAST_SCREEN_READER_MS) - UNDO_TOAST_SCREEN_READER_MS
  );
  ok(
    "the batch window is always AT LEAST as long as the toast is visible",
    undoBatchWindowMs(UNDO_TOAST_MS) > UNDO_TOAST_MS &&
      undoBatchWindowMs(UNDO_TOAST_SCREEN_READER_MS) > UNDO_TOAST_SCREEN_READER_MS
  );
  ok("the screen-reader window is the longer of the two", UNDO_TOAST_SCREEN_READER_MS > UNDO_TOAST_MS);
}

console.log("\nG. tapping Undo with nothing pending is a no-op, not a success");
{
  eq("an empty batch does not restore", shouldRestoreBatch(0), false);
  eq("a non-empty batch does", shouldRestoreBatch(1), true);
  eq("neither does a negative count (defensive)", shouldRestoreBatch(-1), false);
}

console.log("\nH. P17: which MEALS a snapshot says were deleted (lib/afterDelete.ts's input)");
{
  const ISO = "2027-01-15T12:30:00.000Z";
  const MS = Date.parse(ISO);

  eq("a meal delete reports the meal", deletedMealsFromSnapshot({
    meals: [{ id: "m1", profile_id: "p1", logged_at: ISO }],
  }), [{ id: "m1", profileId: "p1", loggedAtMs: MS, templateId: null }]);

  // The template a meal was logged from comes along: its usage counters were
  // bumped for this meal and now have one fewer to count.
  eq("a meal logged from a template carries the template", deletedMealsFromSnapshot({
    meals: [{ id: "m1", profile_id: "p1", logged_at: ISO, meal_template_id: "t1" }],
  }), [{ id: "m1", profileId: "p1", loggedAtMs: MS, templateId: "t1" }]);

  // The bolus a meal delete also removes is not a meal and must not be read as
  // one: only meal_logs rows can have armed a countdown.
  eq("the calculator bolus alongside it is ignored", deletedMealsFromSnapshot({
    meals: [{ id: "m1", profile_id: "p1", logged_at: ISO }],
    injections: [{ id: "i1", profile_id: "p1", meal_log_id: "m1", logged_at: ISO }],
  }).length, 1);

  // A GLUCOSE delete carries linkedMealIds - meals that merely lost their link
  // to the reading. Those rows are still in the table, so nothing was deleted.
  eq("a glucose delete reports no deleted meals", deletedMealsFromSnapshot({
    sugar: [{ id: "s1", profile_id: "p1", logged_at: ISO }],
    linkedMealIds: ["m1", "m2"],
  }), []);

  eq("an injection delete reports none", deletedMealsFromSnapshot({
    injections: [{ id: "i1", profile_id: "p1", logged_at: ISO }],
  }), []);
  eq("a medication delete reports none", deletedMealsFromSnapshot({
    meds: [{ id: "d1", profile_id: "p1", logged_at: ISO }],
  }), []);
  eq("an empty snapshot reports none", deletedMealsFromSnapshot({}), []);

  // A moment that will not parse is dropped rather than passed on as NaN: it
  // could not be compared to a countdown's anchor, and a NaN would either end
  // the wrong countdown or none at all, silently.
  eq("an unreadable logged_at is dropped", deletedMealsFromSnapshot({
    meals: [{ id: "m1", profile_id: "p1", logged_at: "not a date" }],
  }), []);
  eq("a missing logged_at is dropped", deletedMealsFromSnapshot({
    meals: [{ id: "m1", profile_id: "p1", logged_at: null }],
  }), []);
  eq("a row with no profile keeps a null owner", deletedMealsFromSnapshot({
    meals: [{ id: "m1", profile_id: null, logged_at: ISO }],
  }), [{ id: "m1", profileId: null, loggedAtMs: MS, templateId: null }]);

  eq("two meals in one snapshot both count", deletedMealsFromSnapshot({
    meals: [
      { id: "m1", profile_id: "p1", logged_at: ISO },
      { id: "m2", profile_id: "p1", logged_at: "2027-01-15T12:34:00.000Z" },
    ],
  }).length, 2);
}

console.log("\nI. P17: which settled side effects an undo replays, and in what order");
{
  const ids = (...v: string[]) => new Set(v);

  // Nothing pending, or nothing of this batch restored: no replay at all.
  eq("nothing pending", planAftermathReplay([], ids("m1")).length, 0);
  eq(
    "an entry whose meal was NOT restored is skipped",
    planAftermathReplay([{ mealIds: ["m1"], tag: "A" }], ids("m9")).length,
    0
  );
  eq(
    "an entry whose meal WAS restored is replayed",
    planAftermathReplay([{ mealIds: ["m1"], tag: "A" }], ids("m1")).map((e) => e.tag),
    ["A"]
  );

  // THE regression this exists for. A single slot lost the earlier window:
  // delete A ends countdown X, the user arms Y inside the same undo window,
  // delete B ends Y. Both must survive to the undo, and BOTH must be replayed.
  const batch = [
    { mealIds: ["mA"], tag: "A" },
    { mealIds: ["mB"], tag: "B" },
  ];
  eq(
    "two deletes that each ended a countdown are BOTH replayed",
    planAftermathReplay(batch, ids("mA", "mB")).length,
    2
  );
  // NEWEST FIRST: the countdown the user had running most recently is the one
  // put back, and the older one cannot be armed over it.
  eq(
    "the newer entry is replayed first",
    planAftermathReplay(batch, ids("mA", "mB")).map((e) => e.tag),
    ["B", "A"]
  );
  // Absolute values (template counters) want the OLDEST applied last, which
  // the same order gives: the oldest entry holds the pre-batch pair.
  eq(
    "the oldest entry lands last",
    planAftermathReplay(batch, ids("mA", "mB")).map((e) => e.tag).pop(),
    "A"
  );

  // A partial undo replays only what it actually restored.
  eq(
    "only the restored half is replayed",
    planAftermathReplay(batch, ids("mB")).map((e) => e.tag),
    ["B"]
  );

  // A delete that removed several meals matches on ANY of them.
  eq(
    "a multi-meal entry matches on any one of its meals",
    planAftermattchHelper(),
    1
  );
  function planAftermattchHelper(): number {
    return planAftermathReplay([{ mealIds: ["m1", "m2"], tag: "A" }], ids("m2")).length;
  }

  // Each entry appears exactly once: nothing is replayed twice from one undo.
  const dup = planAftermathReplay(
    [{ mealIds: ["m1"], tag: "A" }, { mealIds: ["m1"], tag: "B" }],
    ids("m1")
  );
  eq("two entries naming the same meal are each replayed once", dup.length, 2);
  eq("and still newest first", dup.map((e) => e.tag), ["B", "A"]);
}

console.log("\nZ. undoing a calculator bolus delete returns the meal's dose");
{
  const bolusRow = (over: Row = {}): Row => ({
    id: "i1",
    meal_log_id: "m1",
    source: "calculator",
    insulin_type: "bolus",
    dose_units: 5,
    ...over,
  });
  eq(
    "calculator bolus snapshot restores the meal dose after the insert",
    planRestoreSteps({ injections: [bolusRow()] }).map((s) => s.op),
    ["insert", "restoreMealDoses"]
  );
  const dose = planRestoreSteps({ injections: [bolusRow()] }).find((s) => s.op === "restoreMealDoses");
  eq("the step names the meal and dose", dose && dose.op === "restoreMealDoses" ? dose.items : null, [{ mealId: "m1", dose: 5 }]);
  eq(
    "a manual injection has no meal dose step",
    planRestoreSteps({ injections: [bolusRow({ source: "manual" })] }).map((s) => s.op),
    ["insert"]
  );
  eq(
    "a basal row has no meal dose step",
    planRestoreSteps({ injections: [bolusRow({ insulin_type: "basal" })] }).map((s) => s.op),
    ["insert"]
  );
  eq(
    "a meal snapshot restores the meal row verbatim, no dose step",
    planRestoreSteps({ meals: [{ id: "m1", insulin_dose_units: 5 }], injections: [bolusRow()] }).map((s) => s.op),
    ["insert", "insert"]
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
