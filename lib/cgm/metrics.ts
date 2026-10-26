/**
 * Which readings a window's figures are computed from, and the CGM numbers that
 * sit on top (coverage, GMI, periods below the target). Dependency-free so it
 * runs under plain Node (scripts/cgmMetrics.test.ts) and in the PDF builder.
 *
 * The rule: with a sensor feeding the window, its readings ARE the window. Taking
 * the sensor stream plus the fingersticks would count the same minutes twice and
 * give a handful of manual readings the weight of a few hours of sensor data.
 * Coverage decides, not row counts: a 1-minute stream is still one reading per
 * five-minute slot, so it can never "cover" more than the window holds.
 */

export interface GlucosePoint {
  logged_at: string;
  glucose_level_mgdl: number;
  source?: string | null;
  is_cgm?: number | boolean | null;
  /** logged_at as epoch ms when the loader already parsed it (see timeOf). */
  t?: number;
}

export interface MetricsWindow {
  start: number;
  end: number;
  /** Upper bound for membership when it differs from the coverage window's end
   *  (the "last N days" shortcut never dropped a reading stamped in the future). */
  until?: number;
}

/** A sensor reading is expected every five minutes. */
export const CGM_SLOT_MS = 5 * 60 * 1000;
/** From this coverage on, the sensor readings replace the whole set. */
export const CGM_BASIS_MIN_COVERAGE = 0.5;
/** GMI is shown only over a window this long, covered at least this much. */
export const GMI_MIN_COVERAGE = 0.7;
export const GMI_MIN_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;
/** A 14-day pick that ends at 23:59 on its last day is a hair under 14 days. */
const GMI_MIN_WINDOW_MS = (GMI_MIN_WINDOW_DAYS - 0.5) * DAY_MS;

export function isCgmPoint(p: GlucosePoint): boolean {
  return p.is_cgm === 1 || p.is_cgm === true;
}

export function timeOf(p: { logged_at: string; t?: number }): number {
  return p.t !== undefined ? p.t : Date.parse(p.logged_at);
}

export type CgmSourceKind = "health" | "nightscout";

export interface GlucoseBasis<T extends GlucosePoint> {
  /** 'cgm': the sensor readings only. 'all': every reading in the window. */
  kind: "cgm" | "all";
  /** Share (0..1) of the window's five-minute slots holding a sensor reading. */
  coverage: number;
  /** What the figures are computed from. */
  readings: T[];
  /** Every reading in the window, sensor or not. */
  all: T[];
  cgmCount: number;
  /** Readings in the window that are not sensor readings. */
  otherCount: number;
  /** Where the sensor readings came from, for the source line. */
  sources: CgmSourceKind[];
}

function sourceKind(source: string | null | undefined): CgmSourceKind {
  return source === "nightscout" ? "nightscout" : "health";
}

export function selectGlucoseBasis<T extends GlucosePoint>(
  points: readonly T[],
  win: MetricsWindow
): GlucoseBasis<T> {
  const until = win.until ?? win.end;
  const all: T[] = [];
  const cgm: T[] = [];
  const slots = new Set<number>();
  let health = false;
  let nightscout = false;
  for (const p of points) {
    const t = timeOf(p);
    if (!Number.isFinite(t) || t < win.start || t > until) continue;
    all.push(p);
    if (!isCgmPoint(p)) continue;
    cgm.push(p);
    if (t <= win.end) slots.add(Math.floor(t / CGM_SLOT_MS));
    if (sourceKind(p.source) === "nightscout") nightscout = true;
    else health = true;
  }
  const total = Math.ceil((win.end - win.start) / CGM_SLOT_MS);
  const coverage = total > 0 ? Math.min(1, slots.size / total) : 0;
  const useCgm = cgm.length > 0 && coverage >= CGM_BASIS_MIN_COVERAGE;
  const sources: CgmSourceKind[] = [];
  if (health) sources.push("health");
  if (nightscout) sources.push("nightscout");
  return {
    kind: useCgm ? "cgm" : "all",
    coverage,
    readings: useCgm ? cgm : all,
    all,
    cgmCount: cgm.length,
    otherCount: all.length - cgm.length,
    sources,
  };
}

/** The readings a window's figures use (see selectGlucoseBasis). */
export function basisReadings<T extends GlucosePoint>(
  points: readonly T[],
  win: MetricsWindow
): T[] {
  return selectGlucoseBasis(points, win).readings;
}

/** Glucose Management Indicator (%), the standard formula over the mean mg/dL. */
export function gmiFromMean(meanMgdl: number): number {
  return 3.31 + 0.02392 * meanMgdl;
}

/** GMI from sensor data needs a long enough window that the sensor covered. */
export function cgmGmiEligible(
  basis: { kind: "cgm" | "all"; coverage: number },
  win: MetricsWindow
): boolean {
  return (
    basis.kind === "cgm" &&
    basis.coverage >= GMI_MIN_COVERAGE &&
    win.end - win.start >= GMI_MIN_WINDOW_MS
  );
}

/** A stretch of consecutive sensor readings under the profile's low edge. */
export interface BelowPeriod {
  startMs: number;
  endMs: number;
  minutes: number;
  lowest: number;
}

export const BELOW_MAX_GAP_MS = 15 * 60 * 1000;
export const BELOW_MIN_DURATION_MS = 15 * 60 * 1000;

/**
 * Where the readings stayed below `lowMgdl` for a stretch: consecutive readings
 * no more than 15 minutes apart, the stretch lasting at least 15 minutes from its
 * first to its last reading. One row per stretch, however dense the stream, so
 * the table's length depends on the data's shape, never on how many rows it has.
 * Newest first.
 */
export function belowTargetPeriods(
  points: readonly GlucosePoint[],
  lowMgdl: number
): BelowPeriod[] {
  const rows: { t: number; v: number }[] = [];
  for (const p of points) {
    const t = timeOf(p);
    if (Number.isFinite(t)) rows.push({ t, v: p.glucose_level_mgdl });
  }
  rows.sort((a, b) => a.t - b.t);
  const out: BelowPeriod[] = [];
  let startMs = 0;
  let lastMs = 0;
  let lowest = 0;
  let open = false;
  const close = () => {
    if (open && lastMs - startMs >= BELOW_MIN_DURATION_MS) {
      out.push({
        startMs,
        endMs: lastMs,
        minutes: Math.round((lastMs - startMs) / 60_000),
        lowest,
      });
    }
    open = false;
  };
  for (const r of rows) {
    if (r.v >= lowMgdl) {
      close();
      continue;
    }
    if (open && r.t - lastMs <= BELOW_MAX_GAP_MS) {
      lastMs = r.t;
      if (r.v < lowest) lowest = r.v;
    } else {
      close();
      open = true;
      startMs = r.t;
      lastMs = r.t;
      lowest = r.v;
    }
  }
  close();
  return out.reverse();
}

/** Median of a non-empty list (the mean of the two middle values when even). */
export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
