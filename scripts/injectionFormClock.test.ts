/**
 * G13: the injection form's time must not go stale (background return,
 * abandoned hand-picked time, tablet map pick, untouched time at save).
 * Run: npx sucrase-node scripts/injectionFormClock.test.ts
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
const form: string = readFileSync(join(__dirname, "..", "app/(tabs)/injection.tsx"), "utf8");

ok("form listens to AppState", form.includes("AppState.addEventListener"));
ok("form uses the foreground clock rule", form.includes("foregroundTimeAction("));
ok("save stamps an untouched time at save time", form.includes("saveTimestamp("));
ok("form no longer resets a picked time on return", !form.includes("injection.timeReset"));
ok("form asks before saving a stale pick", form.includes("injection.staleTimeAsk") && form.includes("injection.staleTimeKeep") && form.includes("injection.staleTimeNow"));
ok("picking a time clears the stale flag", form.includes("timeStale.current = false"));
const pickAt = form.indexOf("function onMapSelect");
const pick = pickAt >= 0 ? form.slice(pickAt, pickAt + 500) : "";
ok("map pick refreshes an untouched time (two-column tablet)", pick.includes("timeTouched.current"));

let helper: any = null;
try {
  helper = require("../lib/injectionFormClock");
} catch {
  ok("lib/injectionFormClock.ts exists", false);
}

if (helper) {
  const { foregroundTimeAction, saveTimestamp, ABANDONED_TIME_MS } = helper;
  ok("untouched time refreshes on any return", foregroundTimeAction({ timeTouched: false, hiddenMs: 1000 }) === "refresh");
  ok("fresh hand-picked time is kept after a short trip", foregroundTimeAction({ timeTouched: true, hiddenMs: 60_000 }) === "keep");
  ok(
    "hand-picked time is flagged stale (not dropped) after a long absence",
    foregroundTimeAction({ timeTouched: true, hiddenMs: ABANDONED_TIME_MS }) === "stale"
  );
  ok(
    "a stale pick saved with the 'now' choice writes now",
    saveTimestamp({ timeTouched: true, loggedAt: new Date("2026-10-27T08:00:00Z"), now: new Date("2026-10-27T20:00:00Z"), choice: "now" }).getTime() ===
      new Date("2026-10-27T20:00:00Z").getTime()
  );
  ok(
    "a stale pick saved with the 'picked' choice keeps the pick",
    saveTimestamp({ timeTouched: true, loggedAt: new Date("2026-10-27T08:00:00Z"), now: new Date("2026-10-27T20:00:00Z"), choice: "picked" }).getTime() ===
      new Date("2026-10-27T08:00:00Z").getTime()
  );
  ok("abandon window is positive", ABANDONED_TIME_MS > 0);

  const morning = new Date("2026-10-27T08:00:00Z");
  const evening = new Date("2026-10-27T20:00:00Z");
  ok(
    "untouched time is replaced by now at save",
    saveTimestamp({ timeTouched: false, loggedAt: morning, now: evening }).getTime() === evening.getTime()
  );
  ok(
    "hand-picked time is kept at save",
    saveTimestamp({ timeTouched: true, loggedAt: morning, now: evening }).getTime() === morning.getTime()
  );
}

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
