/**
 * G20 + G21: one-tap re-log lock and failure toast, and side steps after the
 * meal write that must not take the logged meal down with them:
 *
 *   npx tsx scripts/foodSaveSteps.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void; cwd: () => string };
import Module from "node:module";
import { readFileSync } from "node:fs";

import { runExclusive, runSideStep } from "../lib/saveSteps";

const M = Module as unknown as {
  _load: (request: string, parent?: { filename?: string }, ...rest: unknown[]) => unknown;
};
const realLoad = M._load;
const dbCalls: string[] = [];
let touchShouldFail = false;
const fakeDb = {
  async getFirstAsync() {
    return { profile_id: "p1", name: "Oatmeal" };
  },
  async getAllAsync() {
    return [];
  },
  async runAsync(sql: string) {
    dbCalls.push(sql);
    if (touchShouldFail && sql.includes("UPDATE meal_templates")) throw new Error("locked");
  },
};
M._load = function (request: string, parent?: { filename?: string }, ...rest: unknown[]) {
  const from = parent?.filename ?? "";
  if (from.endsWith("/lib/db/mealTemplates.ts")) {
    if (request === "../uuid") return { uuid: () => "u-1" };
    if (request === "./index") return { getDb: async () => fakeDb };
    if (request === "./logs")
      return { addMealLog: async (i: { custom_food_name: string }) => ({ id: "meal-1", ...i }) };
  }
  return realLoad.call(this, request, parent, ...rest);
};

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
const read = (rel: string) => readFileSync(process.cwd() + "/" + rel, "utf8");

async function main() {
  // runExclusive
  const lock = { current: false };
  let runs = 0;
  let gate!: () => void;
  const first = runExclusive(
    lock,
    () =>
      new Promise<void>((resolve) => {
        runs++;
        gate = resolve;
      }),
    () => {}
  );
  const second = await runExclusive(lock, async () => void runs++, () => {});
  ok("second tap while the first runs is skipped", second === false && runs === 1);
  gate();
  ok("first run completes", (await first) === true);
  ok("lock released after success", lock.current === false);
  const errors: unknown[] = [];
  const failedRun = await runExclusive(
    lock,
    async () => {
      throw new Error("boom");
    },
    (e) => errors.push(e)
  );
  ok("a throw is reported once and resolves false", failedRun === false && errors.length === 1);
  ok("lock released after a throw", lock.current === false);
  ok("a later tap can run", (await runExclusive(lock, async () => void runs++, () => {})) && runs === 2);
  const throwingReporter = await runExclusive(
    lock,
    async () => {
      throw new Error("x");
    },
    () => {
      throw new Error("reporter");
    }
  );
  ok("a throwing reporter still releases the lock", throwingReporter === false && lock.current === false);

  // runSideStep
  const failedSteps: string[] = [];
  const stepOk = await runSideStep("a", () => 1, () => {});
  const stepBad = await runSideStep(
    "touch",
    async () => {
      throw new Error("nope");
    },
    (_e, step) => failedSteps.push(step)
  );
  ok("side step success", stepOk === true);
  ok("side step failure is reported by name and swallowed", stepBad === false && failedSteps[0] === "touch");

  // logTemplate: a failing usage counter must not fail the logged meal
  const { logTemplate } = await import("../lib/db/mealTemplates");
  touchShouldFail = true;
  const seen: unknown[] = [];
  let threw = false;
  let meal: { id: string } | null = null;
  try {
    meal = (await logTemplate("p1", "t1", { onSideEffectError: (e: unknown) => seen.push(e) })) as never;
  } catch {
    threw = true;
  }
  ok("logTemplate resolves with the meal when touchTemplate fails", !threw && meal?.id === "meal-1");
  ok("the counter failure is handed to the caller", seen.length === 1);
  touchShouldFail = false;

  // Screens: wiring pinned from source (they cannot be imported under node).
  const food = read("app/(tabs)/food.tsx");
  const reLog = food.slice(food.indexOf("async function reLog"), food.indexOf("// Display order: the current slot first"));
  ok("reLog takes a ref lock", food.includes("reLogLock = useRef(false)") && reLog.includes("runExclusive("));
  ok("reLog reports failure with the saveFailed toast", reLog.includes('t("common.saveFailed")'));
  ok("reLog reminder step is isolated", reLog.includes("runSideStep("));
  {
    const after = reLog.slice(reLog.indexOf("await addMealLog("));
    for (const step of ["logEvent", "noteFirstLog", "hapticSuccess", "noteJournalActivity", "bumpData", "savedToast"]) {
      ok(`reLog step ${step} is isolated`, new RegExp(`runSideStep\\(\\s*"${step}"`).test(after));
    }
    const beforeToast = after.slice(0, after.search(/runSideStep\(\s*"savedToast"/));
    ok("reLog has no bare post-write call", !/^\s*(void )?(logEvent|noteFirstLog|hapticSuccess|noteJournalActivity|bumpData)\(/m.test(beforeToast));
  }
  const confirm = food.slice(food.indexOf("async function confirmLogTemplate"), food.indexOf("async function moveTemplate"));
  ok("confirmLogTemplate has a catch with the saveFailed toast", confirm.includes("catch") && confirm.includes('t("common.saveFailed")'));
  ok("confirmLogTemplate isolates the reminder", confirm.includes("runSideStep("));
  ok("confirmLogTemplate passes the side-effect reporter", confirm.includes("onSideEffectError"));
  const compose = food.slice(food.indexOf("async function saveCompose()"), food.indexOf("async function saveComposeTemplate"));
  ok("saveCompose isolates the reminder", compose.includes("runSideStep("));
  ok("saveCompose catch shows the saveFailed toast", compose.includes('t("common.saveFailed")'));
  const composeTpl = food.slice(food.indexOf("async function saveComposeTemplate"), food.indexOf("const [estimateSource"));
  ok("saveComposeTemplate catch shows the saveFailed toast", composeTpl.includes('t("common.saveFailed")'));
  const tpl = read("app/meal-template.tsx");
  const logNow = tpl.slice(tpl.indexOf("async function logNow"));
  ok("meal-template logNow isolates touchTemplate", /runSideStep\(\s*"touchTemplate"/.test(logNow));
  ok("meal-template logNow isolates replaceTemplateItems", /runSideStep\(\s*"replaceTemplateItems"/.test(logNow));
  ok("meal-template logNow isolates the reminder", /runSideStep\(\s*"postMealReminder"/.test(logNow));
  ok("meal-template logNow shows the saveFailed toast", logNow.includes('t("common.saveFailed")'));

  console.log(`foodSaveSteps: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
