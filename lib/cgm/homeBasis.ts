/**
 * Which readings the sensor home card's average and ring are computed from.
 * Same rule and same threshold as Insights (selectGlucoseBasis): with enough
 * sensor coverage of today so far the sensor readings are the day, otherwise
 * the hand-entered ones are. Pure and dependency-free so it runs under plain
 * Node (scripts/cgmHomeBasis.test.ts).
 */
import type { CgmRangeStats } from "../db/cgmCurveSql";
import { selectGlucoseBasis } from "./metrics";

export type HomeCardSource = "cgm" | "manual";

export interface HomeCardToday {
  source: HomeCardSource;
  stats: CgmRangeStats;
  /** No reading at all today, sensor or hand-entered. */
  noReading: boolean;
}

export function pickHomeCardToday(input: {
  /** Timestamps (ms) of today's sensor rows. */
  sensorTimesMs: readonly number[];
  dayStartMs: number;
  nowMs: number;
  sensor: CgmRangeStats;
  /** Hand-entered rows without the sensor twins (journal rule). */
  manual: CgmRangeStats;
}): HomeCardToday {
  const points = input.sensorTimesMs.map((t) => ({
    logged_at: "",
    glucose_level_mgdl: 0,
    is_cgm: 1,
    t,
  }));
  const basis = selectGlucoseBasis(points, { start: input.dayStartMs, end: input.nowMs });
  // Thin sensor coverage with nothing typed: the few sensor rows are still the
  // only readings of the day, so they stay the card's figures.
  const useManual = basis.kind !== "cgm" && input.manual.count > 0;
  const stats = useManual ? input.manual : input.sensor;
  return { source: useManual ? "manual" : "cgm", stats, noReading: stats.count === 0 };
}
