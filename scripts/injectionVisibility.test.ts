/**
 * G14: a saved injection must show up in History, and a record outside the map
 * period must say so. Run: npx sucrase-node scripts/injectionVisibility.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const read = (f: string): string => readFileSync(join(__dirname, "..", f), "utf8");
const form = read("app/(tabs)/injection.tsx");

ok("form plans the history window after save", form.includes("historyPlanForSaved("));
ok("form reads the count of newer rows", form.includes("countInjectionsAfter("));
ok("form explains out-of-map records", form.includes("outsideMapWindow(") && form.includes("injection.savedOutsideMap"));
ok("db helper exists", read("lib/db/injections.ts").includes("export async function countInjectionsAfter("));

const map = read("components/InjectionBodyMap.tsx");
ok("map opens on the face of the last record", map.includes("lastSite") && map.includes("pickInitialSurface<Surface>("));
ok("form hands the last record's region to the map", form.includes("lastSite={lastRecord?.site"));

let helper: any = null;
try {
  helper = require("../lib/injectionVisibility");
} catch {
  ok("lib/injectionVisibility.ts exists", false);
}

if (helper) {
  const { historyPlanForSaved, outsideMapWindow, pickInitialSurface } = helper;
  ok("surface: first defined candidate wins", pickInitialSurface([undefined, null, "back", "front"], "front") === "back");
  ok("surface: falls back to front", pickInitialSurface([undefined, null], "front") === "front");
  const now = Date.parse("2026-10-27T12:00:00Z");
  const day = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const base = { now, days: 14, max: 50, page: 50, currentLimit: 50 };

  let p = historyPlanForSaved({ ...base, loggedAtIso: iso(now - 60_000), newerCount: 0 });
  ok("a fresh record needs no expansion", p.expand === false && p.limit === 50);

  p = historyPlanForSaved({ ...base, loggedAtIso: iso(now - 20 * day), newerCount: 3 });
  ok("a 20-day-old record expands the slice", p.expand === true && p.limit === 50);

  p = historyPlanForSaved({ ...base, loggedAtIso: iso(now - 2 * day), newerCount: 70 });
  ok("a record beyond the first page expands and grows the limit", p.expand === true && p.limit >= 71);

  p = historyPlanForSaved({ ...base, loggedAtIso: iso(now - 2 * day), newerCount: 49 });
  ok("the 50th row still fits the first page", p.expand === false && p.limit === 50);

  p = historyPlanForSaved({ ...base, currentLimit: 150, loggedAtIso: iso(now - 40 * day), newerCount: 90 });
  ok("limit never shrinks", p.limit === 150);

  ok("inside 30 days, no cycle: on the map", outsideMapWindow(iso(now - 10 * day), now, 30, null) === false);
  ok("older than 30 days: off the map", outsideMapWindow(iso(now - 31 * day), now, 30, null) === true);
  ok("before the cycle start: off the map", outsideMapWindow(iso(now - 5 * day), now, 30, iso(now - 2 * day)) === true);
  ok("after the cycle start: on the map", outsideMapWindow(iso(now - 1 * day), now, 30, iso(now - 2 * day)) === false);
  ok(
    "old cycle start does not widen the 30-day window",
    outsideMapWindow(iso(now - 35 * day), now, 30, iso(now - 90 * day)) === true
  );
}

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
