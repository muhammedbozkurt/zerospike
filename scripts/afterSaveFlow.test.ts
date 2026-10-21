/** Run: npx tsx scripts/afterSaveFlow.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  afterSaveTarget,
  cameFromToday,
  findInjectionLocation,
  SAVED_HIGHLIGHT_MS,
} from "../lib/injectionAfterSave";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const cases: Array<[string, () => void]> = [
  ["dashboard quick-add (compose) and from=today count as coming from Today", () => {
    assert.equal(cameFromToday({ compose: "1" }), true);
    assert.equal(cameFromToday({ from: "today" }), true);
    assert.equal(cameFromToday({ compose: "" }), false);
    assert.equal(cameFromToday({}), false);
  }],
  ["target: Today when started there, history otherwise", () => {
    assert.equal(afterSaveTarget(true), "today");
    assert.equal(afterSaveTarget(false), "history");
  }],
  ["highlight lasts 1.5 s", () => assert.equal(SAVED_HIGHLIGHT_MS, 1500)],
  ["findInjectionLocation", () => {
    const sections = [{ data: [{ id: "a" }, { id: "b" }] }, { data: [{ id: "c" }] }];
    assert.deepEqual(findInjectionLocation(sections, "c"), { sectionIndex: 1, itemIndex: 0 });
    assert.deepEqual(findInjectionLocation(sections, "b"), { sectionIndex: 0, itemIndex: 1 });
    assert.equal(findInjectionLocation(sections, "zz"), null);
  }],
  ["injection.tsx: save -> toast with Undo, history segment + highlight, Today return", () => {
    const src = read("app/(tabs)/injection.tsx");
    assert.ok(/const saved = await logInjection\(/.test(src));
    assert.ok(src.includes('label: t("common.undo")'));
    assert.ok(src.includes("undoSaved(saved.id)"));
    assert.ok(src.includes("afterSaveTarget(fromTodayRef.current)"));
    assert.ok(src.includes('router.navigate("/(tabs)")'));
    assert.ok(src.includes("setHighlightId(saved.id)"));
    assert.ok(src.includes('setSegment("history")'));
    assert.ok(src.includes("await deleteInjection(id)"));
  }],
  ["glucose submit: saved toast carries Undo that deletes the reading and its health sample", () => {
    const src = read("app/(tabs)/index.tsx");
    assert.ok(src.includes("undoNewGlucose(addedSugar.id)"));
    assert.ok(src.includes('toast(t("calculator.savedRecord"), "success", savedUndo)'));
    const svc = read("lib/services/glucoseUndo.ts");
    assert.ok(svc.includes("deleteGlucoseRowFromHealth(id, await deleteSugarLog(id))"));
  }],
  ["meal compose save: closes, highlights the new meal in Today's band, Undo toast", () => {
    const src = read("app/(tabs)/food.tsx");
    assert.ok(src.includes("setHighlightMealId(meal.id)"));
    assert.ok(src.includes("meal.id === highlightMealId"));
    assert.ok(/toast\(t\("calculator\.savedRecord"\), "success", \{\s*label: t\("common\.undo"\)/.test(src));
    assert.ok(src.includes("await deleteMealRecord(meal.id)"));
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
if (failed) process.exit(1);
console.log("all passed");
