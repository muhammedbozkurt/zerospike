/**
 * Time-in-range bands, the GMI hint reason and the window day count (G253 D-1,
 * D-2, D-19). Pure lib/insights.ts, no native edge.
 *
 * Run: npx tsx scripts/tirBands.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { computeInsights, gmiWithheldReason } from "../lib/insights";
import { inTargetBand, VERY_HIGH_MGDL } from "../lib/glucose";
import { windowDaysText, coverageLine } from "../lib/cgm/basisText";
import { GMI_MIN_WINDOW_DAYS } from "../lib/cgm/metrics";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
Date.now = () => NOW;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

type Row = Record<string, unknown>;
const manual = (i: number, t: number, v: number): Row => ({
  id: `m${i}`,
  logged_at: new Date(t).toISOString(),
  glucose_level_mgdl: v,
  is_cgm: 0,
  source: "manual",
  tags: [],
  period_tag: "fasting",
});
function sensor(days: number): Row[] {
  const out: Row[] = [];
  for (let t = NOW - days * DAY; t <= NOW; t += 5 * 60_000) {
    out.push({
      id: `c${t}`,
      logged_at: new Date(t).toISOString(),
      t,
      glucose_level_mgdl: 140,
      is_cgm: 1,
      source: "health",
      tags: [],
      period_tag: null,
    });
  }
  return out;
}

// ---- D-1: one disjoint classification, whatever the personal ceiling -------
const values = [100, 120, 150, 200, 255, 260, 265, 270, 90, 110];
const rows = values.map((v, i) => manual(i, NOW - (i + 1) * 3 * 3_600_000, v)) as never[];
const at = (high: number) => computeInsights(rows, [], [], 7, { low: 70, high });
const sum = (i: ReturnType<typeof at>) =>
  (i.lowPct ?? 0) + (i.inRangePct ?? 0) + (i.highPct ?? 0) + (i.veryHighPct ?? 0);

for (const high of [180, 250, 260, 280, 300]) {
  const i = at(high);
  ok(`high ${high}: the four shares add up to 100`, Math.abs(sum(i) - 100) < 1e-9, String(sum(i)));
}
ok("ceiling 260 and 300 give the same in-range share", at(260).inRangePct === at(300).inRangePct, `${at(260).inRangePct} vs ${at(300).inRangePct}`);
ok("readings from 250 up are never in range", at(300).inRangePct === 60 && at(300).veryHighPct === 40, `${at(300).inRangePct}/${at(300).veryHighPct}`);
ok("a ceiling under 250 is unchanged", at(180).inRangePct === 50 && at(180).highPct === 10 && at(180).veryHighPct === 40, `${at(180).inRangePct}/${at(180).highPct}`);
ok("inTargetBand: 249 in, 250 out under a 300 ceiling", inTargetBand(VERY_HIGH_MGDL - 1, { low: 70, high: 300 }) && !inTargetBand(VERY_HIGH_MGDL, { low: 70, high: 300 }));
{
  // Exactly 250 is the boundary: it is very high, never in target, whatever the ceiling.
  const edge = (v: number) =>
    computeInsights([manual(0, NOW - 3_600_000, v)] as never[], [], [], 7, { low: 70, high: 300 });
  ok("a lone 250 is very high, not in range", edge(250).inRangePct === 0 && edge(250).veryHighPct === 100, `${edge(250).inRangePct}/${edge(250).veryHighPct}`);
  ok("a lone 249 is in range", edge(249).inRangePct === 100 && edge(249).veryHighPct === 0, `${edge(249).inRangePct}/${edge(249).veryHighPct}`);
}
ok("hasReadings: shares are null without readings", computeInsights([], [], [], 7, { low: 70, high: 300 }).inRangePct === null);

// ---- D-2: the GMI hint names the real condition and the selected window -----
const s16 = sensor(16) as never[];
const i16 = computeInsights(s16, [], [], 30);
ok("16 days of sensor in a 30 day window: hint is coverage", i16.gmi === null && gmiWithheldReason(i16, 30) === "coverage");
const i7 = computeInsights(sensor(90) as never[], [], [], 7);
ok("7 day window never carries GMI, hint is the window", i7.gmi === null && gmiWithheldReason(i7, 7) === "window");
const fs: number[] = [];
for (let d = 0; d < 60; d++) for (let k = 0; k < 4; k++) fs.push(NOW - d * DAY - k * 3 * 3_600_000);
const f7 = computeInsights(fs.map((t, i) => manual(i, t, 130)) as never[], [], [], 7);
ok("fingersticks in a 7 day window: hint is the window", f7.gmi === null && gmiWithheldReason(f7, 7) === "window");
ok("window rule uses the shared constant", gmiWithheldReason(i7, GMI_MIN_WINDOW_DAYS) !== "window" && gmiWithheldReason(i7, GMI_MIN_WINDOW_DAYS - 1) === "window");
ok("a 14 day pick is long enough", gmiWithheldReason(i16, 14) !== "window");

// ---- D-19: day count never exceeds the window, singular day text -------------
const ts = [NOW - 7 * DAY + 3_600_000];
for (let d = 0; d < 7; d++) ts.push(NOW - d * DAY - 3_600_000);
const d7 = computeInsights(ts.map((t, i) => manual(i, t, 120)) as never[], [], [], 7);
ok("7 day window never reports 8 days", d7.days <= 7, String(d7.days));
const t1 = (k: string, o?: Record<string, unknown>) => `${k}|${o ? Object.values(o).join(",") : ""}`;
ok("one day uses the singular key", windowDaysText(t1, 1) === "insights.windowOneDay|");
ok("several days use the count key", windowDaysText(t1, 7) === "insights.windowDays|7");
ok("one day coverage line avoids '1 days'", !coverageLine(t1, 1, 80).startsWith("cgmInsights.coverageLine"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
