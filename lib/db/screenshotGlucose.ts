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
