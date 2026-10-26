import type { PeriodTag } from "./types";

/** Deterministic pseudo-random in [0,1) so the seed is stable across runs. */
export function rng(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A plausible reading (mg/dL) for a given day/slot, weighted toward target. */
export function reading(day: number, slot: number): number {
  const r = rng(day * 7 + slot);
  // ~78% target (80-140), ~5% low, ~17% high.
  if (r < 0.05) return Math.round(58 + rng(day + slot) * 20); // low
  if (r < 0.22) return Math.round(150 + rng(day * 3 + slot) * 70); // high
  return Math.round(88 + rng(day * 5 + slot) * 48); // target band
}

const PERIODS: PeriodTag[] = ["fasting", "pre_meal", "post_meal_2h", "bedtime", "manual"];

export interface SeedGlucose {
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  logged_at: string;
}

export const CGM_SHOT_POINTS = 144;
export const CGM_SHOT_STEP_MS = 5 * 60 * 1000;
/** The source_app marking the demo sensor rows, so they can be found and removed. */
export const CGM_SHOT_SOURCE_APP = "demo.cgm";

export interface SeedCgmPoint {
  mgdl: number;
  atMs: number;
}

export interface SeedCgmManual extends SeedCgmPoint {
  period_tag: PeriodTag;
}

/** One meal's glucose excursion: a quick rise to `peak` at `center`, a slower
 *  fall. Indexes are 5 minute steps. */
function mealBump(i: number, center: number, peak: number): number {
  const width = i < center ? 8 : 16;
  return peak * Math.exp(-(((i - center) / width) ** 2));
}

/**
 * The store frame's sensor story: the last 12 hours at 5 minutes, 144 points,
 * ending at the newest 5 minute mark at or before `nowMs`. The shape is a
 * function of the point's position in the window, never of the clock, so the
 * curve is full and the same whatever time the simulator shows: a quiet
 * baseline around 108 with one breakfast-style and one dinner-style rise
 * (peaks ~166 and ~172) that settle back, so most points sit in the target
 * band and the excursions look like an ordinary day.
 */
export function buildCgmSchedule(nowMs: number): SeedCgmPoint[] {
  const newest = Math.floor(nowMs / CGM_SHOT_STEP_MS) * CGM_SHOT_STEP_MS;
  const out: SeedCgmPoint[] = [];
  for (let i = 0; i < CGM_SHOT_POINTS; i++) {
    const baseline = 108 + 3 * Math.sin(i / 9);
    const noise = (rng(i * 3 + 11) - 0.5) * 4;
    const value = baseline + mealBump(i, 42, 58) + mealBump(i, 112, 64) + noise;
    out.push({
      mgdl: Math.round(Math.min(190, Math.max(70, value))),
      atMs: newest - (CGM_SHOT_POINTS - 1 - i) * CGM_SHOT_STEP_MS,
    });
  }
  return out;
}

/** Three hand-entered readings that sit on the curve (a finger-stick next to
 *  the sensor), two minutes after a sensor point so they do not hide behind it. */
export function buildCgmManualPoints(schedule: readonly SeedCgmPoint[]): SeedCgmManual[] {
  const picks: { index: number; delta: number; period_tag: PeriodTag }[] = [
    { index: 36, delta: 4, period_tag: "pre_meal" },
    { index: 88, delta: -3, period_tag: "manual" },
    { index: 118, delta: 5, period_tag: "post_meal_2h" },
  ];
  return picks.map((p) => ({
    mgdl: schedule[p.index].mgdl + p.delta,
    atMs: schedule[p.index].atMs + 2 * 60 * 1000,
    period_tag: p.period_tag,
  }));
}

function atFrom(base: Date, daysAgo: number, hour: number, minute = 0): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * 30 days of glucose (skipping day 12 so the streak reads 12), anchored to the
 * calendar day of `base`. Readings span the whole clock so the AGP median has
 * no empty edge: fasting 07, post-breakfast 09, lunch 13, afternoon 17,
 * post-dinner 20, bedtime ~23:40, plus a ~00:30 reading every other day.
 * Today carries exactly four fixed in-target readings (100, 115, 105, hero 112
 * at 18:22, mean 108); they all fall on today's calendar day, so any weekly
 * window that ends at the end of today contains them whatever weekday it is.
 */
export function buildGlucoseSchedule(base: Date): SeedGlucose[] {
  const out: SeedGlucose[] = [];
  const hoursBySlot = [7, 9, 13, 17, 20, 23];
  const periodBySlot: PeriodTag[] = [
    PERIODS[0], PERIODS[2], PERIODS[1], PERIODS[4], PERIODS[2], PERIODS[3],
  ];
  const TODAY_TARGET_MGDL = [100, 115, 105];
  for (let day = 0; day < 30; day++) {
    if (day === 12) continue;
    const slots = day === 0 ? 4 : hoursBySlot.length;
    for (let slot = 0; slot < slots; slot++) {
      const isTodayHero = day === 0 && slot === 3;
      const hour = isTodayHero ? 18 : hoursBySlot[slot];
      const minute = isTodayHero
        ? 22
        : slot === 5
          ? 40 + Math.round(rng(day + slot) * 8)
          : Math.round(rng(day + slot) * 40);
      const glucoseLevel = isTodayHero
        ? 112
        : day === 0
          ? TODAY_TARGET_MGDL[slot]
          : reading(day, slot);
      out.push({
        glucose_level_mgdl: glucoseLevel,
        period_tag: isTodayHero ? "post_meal_2h" : periodBySlot[slot],
        logged_at: atFrom(base, day, hour, minute),
      });
    }
    if (day !== 0 && day % 2 === 0) {
      out.push({
        glucose_level_mgdl: reading(day, 6),
        period_tag: PERIODS[0],
        logged_at: atFrom(base, day, 0, 25 + Math.round(rng(day) * 10)),
      });
    }
  }
  return out;
}
