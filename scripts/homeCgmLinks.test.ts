/**
 * Dashboard links to the CGM libs: the first-step label and action by mode
 * (CGM-H), the paused measurement reminder out of the "next reminder" line
 * (CGM-D) and the logging streak counting sensor days (CGM-C). A manual
 * profile keeps its old home: same label, same action, same streak.
 * Run: npx -y tsx scripts/homeCgmLinks.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cgmActivitySinceIso, firstStepPlan, STREAK_CGM_DAYS } from "../lib/homeFirstStep";
import { withCgmPause } from "../lib/cgm/reminderMode";
import { consecutiveLogDays } from "../lib/insights";
import { buildUpcoming } from "../lib/upcomingReminders";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const root = join(import.meta.dirname, "..");
const index = readFileSync(join(root, "app/(tabs)/index.tsx"), "utf8");

console.log("A. first step by mode");
const manual = firstStepPlan("manual", false);
ok("manual keeps the glucose label", manual.labelKey === "dashboard.stepGlucose");
ok("manual opens the quick add", manual.action === "quickAdd");
ok("manual has no sync tick", manual.done === undefined);
ok("manual stays out of the setup row as before", manual.inSetupRow === false);
const cgm = firstStepPlan("cgm", false);
ok("cgm leads with the sync label", cgm.labelKey === "dashboard.stepSync");
ok("cgm opens the Health flow", cgm.action === "health");
ok("cgm shows in the setup row", cgm.inSetupRow === true);
ok("cgm sync not done", cgm.done === false);
ok("cgm sync done ticks", firstStepPlan("cgm", true).done === true);
const ns = firstStepPlan("nightscout", true);
ok("nightscout leads with the sync label", ns.labelKey === "dashboard.stepSync");
ok("nightscout goes to the data sources screen", ns.action === "dataSources");
ok("nightscout done follows the flag", ns.done === true && firstStepPlan("nightscout", false).done === false);
ok("a manual profile never reads the sync flag", firstStepPlan("manual", true).done === undefined);

console.log("B. paused measurement reminder");
const row = (id: string, type: "glucose" | "med", time: string) => ({
  id,
  type,
  label: null,
  time,
  enabled: 1,
  alarm_enabled: 0,
});
const rows = [row("g1", "glucose", "12:00"), row("m1", "med", "13:00")];
const base = {
  now: new Date(2026, 5, 10, 8, 0, 0).getTime(),
  windowMs: 24 * 60 * 60 * 1000,
  masterEnabled: true,
  notificationPermission: true,
  showsBasal: false,
  showsMeds: true,
  alarmKitAvailable: false,
  alarmAuthorized: false,
  postMealEndsAt: null,
};
const manualList = buildUpcoming({ ...base, rows: withCgmPause(rows, "manual", new Set()) });
ok("manual still lists the measurement reminder", manualList.some((i) => i.id === "g1"));
const cgmList = buildUpcoming({ ...base, rows: withCgmPause(rows, "cgm", new Set()) });
ok("sensor mode drops the paused measurement reminder", !cgmList.some((i) => i.id === "g1"));
ok("sensor mode keeps the medication reminder", cgmList.some((i) => i.id === "m1"));
const optedIn = buildUpcoming({ ...base, rows: withCgmPause(rows, "cgm", new Set(["g1"])) });
ok("an opted-in measurement reminder stays", optedIn.some((i) => i.id === "g1"));
ok(
  "the dashboard wraps the rows before the next-reminder line",
  /nextUpcoming\(\{\s*rows:\s*withCgmPause\(rows, mode, optIn\)/.test(index)
);
ok("the dashboard reads the mode and the opt-in set there", /getCgmMode\(profileIdNow\)/.test(index) && /getGlucoseOptIn\(profileIdNow\)/.test(index));
ok("the raw rows still feed the basal and alarm lookups", /setNextReminderRows\(rows\)/.test(index));

console.log("C. streak counts sensor days");
const day = (offset: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return d.toISOString();
};
ok("manual streak unchanged without sensor days", consecutiveLogDays([day(0)], []) === 1);
ok("sensor days extend the run", consecutiveLogDays([day(0)], [day(1), day(2), day(3)]) === 4);
ok("sensor days alone make a streak", consecutiveLogDays([], [day(0), day(1)]) === 2);
const since = Date.parse(cgmActivitySinceIso(Date.UTC(2026, 5, 10, 12)));
ok("the sensor window is 60 days", STREAK_CGM_DAYS === 60 && Date.UTC(2026, 5, 10, 12) - since === 60 * 86_400_000);
ok("all three streak reads pass the sensor days", (index.match(/consecutiveLogDays\([^)]*cgmDates\)/g) ?? []).length === 3);
ok("the sensor days come from listCgmActivity over the window", /listCgmActivity\(\w+, cgmActivitySinceIso\(Date\.now\(\)\)\)/.test(index));
ok("they are read only on a sensor mode", /if \(!profileId \|\| !cgmActive\) \{\s*setCgmDates\(\[\]\)/.test(index));

console.log("D. wiring of the first step");
ok("the label comes from the plan", /label: t\(firstPlan\.labelKey\)/.test(index));
ok("the sync flag is read for a sensor mode", /readFirstSyncDone\(profileId\)/.test(index));
ok("a Health sync refreshes the flag", /void refreshFirstSync\(activeProfile\.id\)\.then\(setSyncDone\)/.test(index));
ok("the guide shows the sync step only in sensor modes", /s\.key !== "log" \|\| firstPlan\.inSetupRow/.test(index));
ok("manual action is still the quick add", /case "quickAdd":\s*setQuickAddOpen\(true\)/.test(index));
ok("nightscout opens the data sources screen", /router\.push\("\/settings\/data-sources" as never\)/.test(index));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
