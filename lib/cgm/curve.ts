/**
 * Geometry and data shaping for the sensor curve. Pure: no React, no database,
 * so scripts/cgmCurve.test.ts runs it under plain Node. The curve is descriptive
 * only: one line, the user's own target band as a shaded area, no threshold
 * line, no colour change on a value, no forecast.
 */
import { MGDL_PER_MMOL, formatGlucose } from "../glucose";
import type { GlucoseUnit } from "../db/types";

export const CURVE_HOURS = [3, 6, 12] as const;
export type CurveHours = (typeof CURVE_HOURS)[number];
export const DEFAULT_CURVE_HOURS: CurveHours = 6;

export function parseCurveHours(raw: unknown): CurveHours {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return CURVE_HOURS.find((h) => h === n) ?? DEFAULT_CURVE_HOURS;
}

export const HOUR_MS = 60 * 60 * 1000;
/** Home curve: one point per 5 minutes, so 12 hours is at most 144 points. */
export const CURVE_BUCKET_MS = 5 * 60 * 1000;
/** Day sheet: 24 hours at 10 minutes, the same 144 points. */
export const DAY_BUCKET_MS = 10 * 60 * 1000;
/** The line breaks where two points are further apart than this. */
export const CURVE_GAP_MS = 15 * 60 * 1000;
/** Free accounts see the last 24 hours; anything older is Pro. */
export const FREE_CGM_WINDOW_MS = 24 * HOUR_MS;

/** True when a window or day ending at `endMs` is older than the free 24 hours. */
export function cgmWindowNeedsPro(endMs: number, nowMs: number): boolean {
  return endMs < nowMs - FREE_CGM_WINDOW_MS;
}

export interface CurveRow {
  atMs: number;
  /** mg/dL. */
  mgdl: number;
  isCgm: boolean;
}

export interface CurvePoint {
  t: number;
  mgdl: number;
}

export interface CurveModel {
  startMs: number;
  endMs: number;
  bucketMs: number;
  /** One median per bucket, oldest first. */
  cgm: CurvePoint[];
  /** The same points split wherever the gap rule breaks the line. */
  segments: CurvePoint[][];
  /** Hand-entered readings, never bucketed, drawn as their own marks. */
  manual: CurvePoint[];
  minMgdl: number | null;
  maxMgdl: number | null;
  /** Newest sensor point. */
  last: CurvePoint | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function rowFromLog(r: {
  logged_at: string;
  glucose_level_mgdl: number;
  is_cgm?: number | boolean | null;
}): CurveRow | null {
  const atMs = Date.parse(r.logged_at);
  const mgdl = Number(r.glucose_level_mgdl);
  if (!Number.isFinite(atMs) || !Number.isFinite(mgdl)) return null;
  return { atMs, mgdl, isCgm: r.is_cgm === 1 || r.is_cgm === true };
}

/**
 * Sensor readings are bucketed on the epoch grid (so a bucket never moves when
 * the window slides) and each bucket keeps the median of its readings; a
 * bucket is drawn at its middle, clamped into the window. The newest
 * `floor(window / bucket)` buckets are kept, which caps 12 hours at 144.
 */
export function buildCurveModel(input: {
  rows: readonly CurveRow[];
  startMs: number;
  endMs: number;
  bucketMs?: number;
  gapMs?: number;
}): CurveModel {
  const bucketMs = input.bucketMs ?? CURVE_BUCKET_MS;
  const gapMs = input.gapMs ?? CURVE_GAP_MS;
  const { startMs, endMs } = input;
  const maxPoints = Math.max(1, Math.floor((endMs - startMs) / bucketMs));

  const buckets = new Map<number, number[]>();
  const manual: CurvePoint[] = [];
  for (const r of input.rows) {
    if (!Number.isFinite(r.atMs) || r.atMs < startMs || r.atMs > endMs) continue;
    if (!r.isCgm) {
      manual.push({ t: r.atMs, mgdl: r.mgdl });
      continue;
    }
    const key = Math.floor(r.atMs / bucketMs);
    const list = buckets.get(key);
    if (list) list.push(r.mgdl);
    else buckets.set(key, [r.mgdl]);
  }

  let cgm: CurvePoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, values]) => ({
      t: Math.min(endMs, Math.max(startMs, key * bucketMs + bucketMs / 2)),
      mgdl: median(values),
    }));
  if (cgm.length > maxPoints) cgm = cgm.slice(cgm.length - maxPoints);
  manual.sort((a, b) => a.t - b.t);

  const segments: CurvePoint[][] = [];
  for (const p of cgm) {
    const current = segments[segments.length - 1];
    if (current && p.t - current[current.length - 1].t <= gapMs) current.push(p);
    else segments.push([p]);
  }

  const all = [...cgm, ...manual];
  return {
    startMs,
    endMs,
    bucketMs,
    cgm,
    segments,
    manual,
    minMgdl: all.length ? Math.min(...all.map((p) => p.mgdl)) : null,
    maxMgdl: all.length ? Math.max(...all.map((p) => p.mgdl)) : null,
    last: cgm.length ? cgm[cgm.length - 1] : null,
  };
}

export interface CurveBox {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

export interface CurveGeometry {
  plot: { l: number; r: number; t: number; b: number };
  /** One SVG path per segment with at least two points. */
  paths: string[];
  /** Sensor points alone in their segment (no line to carry them). */
  dots: { x: number; y: number }[];
  manual: { x: number; y: number }[];
  band: { y: number; h: number } | null;
  yTicks: { y: number; mgdl: number; label: string }[];
  xTicks: { x: number; ms: number }[];
  last: { x: number; y: number } | null;
}

const Y_STEPS_MGDL = [10, 20, 25, 50, 100];
const Y_STEPS_MMOL = [0.5, 1, 2, 5];

/** Tick values (mg/dL) on round numbers of the DISPLAY unit, at most `max`. */
export function niceYTicks(
  loMgdl: number,
  hiMgdl: number,
  unit: GlucoseUnit,
  max = 5
): number[] {
  const factor = unit === "mmol" ? 1 / MGDL_PER_MMOL : 1;
  const lo = loMgdl * factor;
  const hi = hiMgdl * factor;
  const steps = unit === "mmol" ? Y_STEPS_MMOL : Y_STEPS_MGDL;
  for (const step of steps) {
    const first = Math.ceil(lo / step - 1e-9);
    const last = Math.floor(hi / step + 1e-9);
    if (last - first + 1 <= max) {
      const out: number[] = [];
      for (let i = first; i <= last; i++) out.push((i * step) / factor);
      return out;
    }
  }
  return [];
}

/** Local-hour tick times inside [startMs, endMs], every `stepHours` hours of
 *  the local clock. Walks local calendar fields, so a DST change shifts the
 *  tick set instead of drifting it by an hour. */
export function hourTicks(startMs: number, endMs: number, stepHours: number): number[] {
  const out: number[] = [];
  const d = new Date(startMs);
  let y = d.getFullYear();
  let mo = d.getMonth();
  let day = d.getDate();
  let h = d.getHours();
  let prev = -Infinity;
  for (let guard = 0; guard < 200; guard++) {
    const at = new Date(y, mo, day, h, 0, 0, 0);
    const ms = at.getTime();
    if (ms >= endMs) break;
    if (ms > prev && ms >= startMs && at.getHours() % stepHours === 0) out.push(ms);
    prev = Math.max(prev, ms);
    h += 1;
    const next = new Date(y, mo, day, h, 0, 0, 0);
    y = next.getFullYear();
    mo = next.getMonth();
    day = next.getDate();
    h = next.getHours();
  }
  return out;
}

function hourStepFor(spanMs: number): number {
  const hours = spanMs / HOUR_MS;
  for (const step of [1, 2, 3, 4, 6]) {
    if (hours / step <= 5) return step;
  }
  return 6;
}

export function layoutCurve(
  model: CurveModel,
  box: CurveBox,
  band: { low: number; high: number } | null,
  unit: GlucoseUnit
): CurveGeometry {
  const plot = {
    l: box.padL,
    r: box.width - box.padR,
    t: box.padT,
    b: box.height - box.padB,
  };
  const values = [model.minMgdl, model.maxMgdl, band?.low, band?.high].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  const rawLo = values.length ? Math.min(...values) : 70;
  const rawHi = values.length ? Math.max(...values) : 180;
  const pad = Math.max(10, (rawHi - rawLo) * 0.1);
  const lo = Math.max(0, rawLo - pad);
  const hi = rawHi + pad;

  const span = Math.max(1, model.endMs - model.startMs);
  const x = (ms: number) => plot.l + ((ms - model.startMs) / span) * (plot.r - plot.l);
  const y = (mgdl: number) => plot.b - ((mgdl - lo) / (hi - lo)) * (plot.b - plot.t);
  const at = (p: CurvePoint) => ({ x: x(p.t), y: y(p.mgdl) });

  const paths: string[] = [];
  const dots: { x: number; y: number }[] = [];
  for (const seg of model.segments) {
    if (seg.length === 1) {
      dots.push(at(seg[0]));
      continue;
    }
    paths.push(
      seg
        .map((p, i) => {
          const q = at(p);
          return `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
        })
        .join(" ")
    );
  }

  const bandGeometry = band
    ? (() => {
        const top = y(Math.min(hi, band.high));
        const bottom = y(Math.max(lo, band.low));
        return bottom > top ? { y: top, h: bottom - top } : null;
      })()
    : null;

  return {
    plot,
    paths,
    dots,
    manual: model.manual.map(at),
    band: bandGeometry,
    yTicks: niceYTicks(lo, hi, unit).map((mgdl) => ({
      y: y(mgdl),
      mgdl,
      label: formatGlucose(mgdl, unit),
    })),
    xTicks: hourTicks(model.startMs, model.endMs, hourStepFor(span)).map((ms) => ({
      x: x(ms),
      ms,
    })),
    last: model.last ? at(model.last) : null,
  };
}

/** [start, end) of a local calendar day, DST safe: the next midnight is built
 *  from calendar fields, so the day is 23 or 25 hours long on a change day. */
export function localDayRange(dayKey: string): { loMs: number; hiMs: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return {
    loMs: new Date(y, mo, d, 0, 0, 0, 0).getTime(),
    hiMs: new Date(y, mo, d + 1, 0, 0, 0, 0).getTime(),
  };
}

export function dayKeyOfMs(ms: number): string {
  const d = new Date(ms);
  const mo = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${day}`;
}

/** The last `count` local days ending with the one containing `nowMs`, newest first. */
export function recentDayRanges(
  nowMs: number,
  count: number
): { dayKey: string; loMs: number; hiMs: number }[] {
  const now = new Date(nowMs);
  const out: { dayKey: string; loMs: number; hiMs: number }[] = [];
  for (let i = 0; i < count; i++) {
    const lo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 0, 0, 0, 0);
    const hi = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1, 0, 0, 0, 0);
    out.push({ dayKey: dayKeyOfMs(lo.getTime()), loMs: lo.getTime(), hiMs: hi.getTime() });
  }
  return out;
}

export interface AgeLabels {
  hourShort: string;
  minuteShort: string;
  agoTemplate: string;
}

/** "4 min ago" / "1 h 5 min ago", composed from the app's own widget labels so
 *  it reads the same on every surface and in every language. */
export function cgmAgeLabel(atMs: number, nowMs: number, labels: AgeLabels): string {
  const totalMinutes = Math.max(0, Math.floor((nowMs - atMs) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const duration =
    hours > 0
      ? `${hours} ${labels.hourShort} ${minutes} ${labels.minuteShort}`
      : `${minutes} ${labels.minuteShort}`;
  return labels.agoTemplate.replace("{{t}}", duration);
}
