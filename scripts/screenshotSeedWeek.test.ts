/**
 * Store-screenshot seed: the glucose schedule must fill "this week" and "last
 * week" for the insights weekly comparison whatever weekday/hour the capture
 * runs, and today's dashboard numbers must not move.
 *
 * Run: npx tsx scripts/screenshotSeedWeek.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__DEV__ = true;
process.env.EXPO_PUBLIC_SCREENSHOT_MODE = "1";

import { buildGlucoseSchedule } from "../lib/db/screenshotGlucose";
import { weeklyComparison, type WeekAnchor } from "../lib/insightsPro";
import { weeklyCompareNow } from "../lib/screenshotMode";
import type { SugarLog } from "../lib/db/types";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

const scenarios: [string, Date][] = [
  ["Monday 00:05", new Date(2026, 9, 19, 0, 5)],
  ["Monday 09:41", new Date(2026, 9, 19, 9, 41)],
  ["Monday 23:55", new Date(2026, 9, 19, 23, 55)],
  ["Sunday 12:00", new Date(2026, 9, 18, 12, 0)],
  ["Saturday 08:00", new Date(2026, 9, 17, 8, 0)],
  ["Wednesday 15:30", new Date(2026, 9, 21, 15, 30)],
];
const anchors: WeekAnchor[] = ["monday", "sunday", "saturday"];

for (const [label, now] of scenarios) {
  const rows = buildGlucoseSchedule(now).map(
    (g, i) => ({ id: `r${i}`, profile_id: "p", ...g }) as unknown as SugarLog
  );
  const nowMs = now.getTime();

  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const today = rows.filter((r) => new Date(r.logged_at).getTime() >= dayStart);
  const todayVals = today.map((r) => r.glucose_level_mgdl).sort((a, b) => a - b);
  ok(`${label}: today has 4 readings`, today.length === 4, todayVals);
  ok(
    `${label}: today avg 108`,
    Math.round(todayVals.reduce((a, b) => a + b, 0) / todayVals.length) === 108
  );
  const last = [...today].sort((a, b) => a.logged_at.localeCompare(b.logged_at)).pop()!;
  const lastAt = new Date(last.logged_at);
  ok(
    `${label}: last reading 112 at 18:22`,
    last.glucose_level_mgdl === 112 && lastAt.getHours() === 18 && lastAt.getMinutes() === 22
  );

  for (const anchor of anchors) {
    const cmp = weeklyComparison(rows, weeklyCompareNow(nowMs), anchor);
    ok(`${label}/${anchor}: this week filled`, cmp.currentReadingCount >= 4, cmp.currentReadingCount);
    ok(`${label}/${anchor}: last week filled`, cmp.previousReadingCount >= 10, cmp.previousReadingCount);
    ok(`${label}/${anchor}: avg, tir, cv all present`,
      cmp.avg.current != null && cmp.avg.delta != null && cmp.tir.delta != null && cmp.cv.delta != null);
  }
}

const monday = new Date(2026, 9, 19, 0, 5).getTime();
const bare = weeklyComparison(
  buildGlucoseSchedule(new Date(monday)).map((g, i) => ({ id: `r${i}`, profile_id: "p", ...g }) as unknown as SugarLog),
  monday,
  "monday"
);
ok("regression: raw clock on Monday 00:05 leaves this week empty", bare.currentReadingCount === 0);

process.env.EXPO_PUBLIC_SCREENSHOT_MODE = "0";
ok("outside screenshot mode now is unchanged", weeklyCompareNow(monday) === monday);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
