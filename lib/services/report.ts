import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import i18n, { currentLang } from "../i18n";
import { getJournal } from "../db/journal";
import {
  computeInsights,
  rangeFromWindow,
  rangeWindowDays,
  type DateRange,
} from "../insights";
import { AGP_MIN_READINGS, computeAgp, type Agp } from "../agp";
import {
  buildAgpGeometry,
  pointsAttr,
  targetBandFor,
  type ChartBox,
  type TargetBand,
} from "../agpChart";
import {
  formatGlucose,
  glucoseUnitLabel,
  hypoThreshold,
  VERY_HIGH_MGDL,
  LOW_FOLLOWUP_MINUTES,
} from "../glucose";
import { num, pct, formatDate, formatTime, formatDateKey } from "../format";
import { insulinModeOf, insulinModeUsesInsulin } from "../insulinMode";
import { GLUCOSE_COLORS, GLUCOSE_VERY_LOW } from "../theme/tokens";
import type { Injection, MealLog, SugarLog } from "../db/types";
import { logEvent } from "../analytics";
import type { GlucoseUnit, PeriodTag, UserProfile } from "../db/types";
import { EXPORT_MAX_ROWS, type ExportResult } from "./export";
import {
  weeklyComparison,
  weekAnchorForLang,
  hourBandAverages,
  bestDayAndStreaks,
  DAY_IN_TARGET_TIR_PCT,
  mealResponseSummary,
  cvTrend,
  type CvWeekPoint,
} from "../insightsPro";

/**
 * D10g: the same Pro insight sections app/insights.tsx renders (weekly
 * comparison, hour-of-day heat strip, best day + streaks, meal response
 * summary, CV trend) also become PDF sections here, each gated on the
 * report's own date range/data carrying enough basis for it - see the
 * individual build*Html functions below for the exact thresholds. All of
 * them call straight into lib/insightsPro.ts, the same pure calculation
 * layer the screen uses, so the numbers in the document and on the phone
 * never drift apart.
 */

/**
 * Generates a printable A4 PDF report (HTML → PDF via expo-print) of a profile's
 * data over a recent window, and opens the native share sheet.
 *
 * Descriptive only: the report shows the user's own logged data plus standard
 * metrics with their existing disclaimers. No interpretation or advice.
 */

// Print-legible accent on white paper (the Midnight neon cyan washes out on a
// light background). Matches the mockup's light-report accent.
const BRAND = "#0ea5b7";

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Dates/times follow the active locale (Intl), like the rest of the app.
function fmtDateTime(iso: string): { date: string; time: string } {
  return { date: formatDate(iso), time: formatTime(iso) };
}

function fmtDay(d: Date): string {
  return formatDate(d.toISOString());
}

/** A five-band time-in-range breakdown (reading counts), for the stacked bar. */
export interface TirBreakdown {
  veryLow: number;
  low: number;
  target: number;
  high: number;
  veryHigh: number;
  total: number;
}

/** Minimal HTML escaping for any user-entered text injected into the report. */
function esc(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function periodLabel(tag: PeriodTag): string {
  return i18n.t(`period.${tag}`);
}

/** A medication row's printed Note cell: name and note share the one column
 *  (the table's column set does not grow) as "name · note", or bare name when
 *  there is no note - identical to every row logged before notes existed. */
function medNoteCell(name: string | null, note: string | null): string {
  const n = (name ?? "").trim();
  const nt = (note ?? "").trim();
  if (!nt) return n;
  return n ? `${n} · ${nt}` : nt;
}

/** The A4 report's AGP plot area, in the SVG's own coordinate space. */
const AGP_BOX: ChartBox = {
  width: 540,
  height: 210,
  padL: 34,
  padR: 8,
  padT: 8,
  padB: 22,
};

/**
 * Renders the AGP (Ambulatory Glucose Profile) as an inline SVG: a green target
 * band, the median curve, and the 25-75 % inter-quartile band by hour of day.
 * The shaded band is the PROFILE'S own target range, so the printed chart and
 * the app agree on what "in range" means. Returns "" when there isn't enough
 * data to be meaningful.
 *
 * The coordinates come from lib/agpChart.ts, the same module the Insights
 * screen draws from, so the printed chart and the on-screen chart agree.
 */
function buildAgpSvg(agp: Agp, unit: GlucoseUnit, band: TargetBand): string {
  const g = buildAgpGeometry(agp, AGP_BOX, band);
  if (!g) return "";
  const { width: W, height: H } = AGP_BOX;
  const f1 = (n: number) => n.toFixed(1);

  const yTicks = g.yTicks
    .map(
      ({ value, y }) =>
        `<line x1="${g.plotLeft}" y1="${f1(y)}" x2="${g.plotRight}" y2="${f1(y)}" stroke="#eee"/>` +
        `<text x="${g.plotLeft - 4}" y="${f1(y + 3)}" font-size="9" fill="#777" text-anchor="end">${esc(formatGlucose(value, unit))}</text>`
    )
    .join("");
  // Middle-anchored text centres on x, so the first/last ticks (sitting right at
  // the plot edges) would overflow the viewBox by half their glyph width. Anchor
  // the end ticks toward the inside instead; only the interior ticks stay centred.
  const lastXTick = g.xTicks.length - 1;
  const xTicks = g.xTicks
    .map(({ hour, x }, i) => {
      const anchor = i === 0 ? "start" : i === lastXTick ? "end" : "middle";
      return `<text x="${f1(x)}" y="${H - 6}" font-size="9" fill="#777" text-anchor="${anchor}">${hour}:00</text>`;
    })
    .join("");

  const dots = g.medianLine
    .map((p) => `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="2" fill="#0891b2"/>`)
    .join("");
  const hasCurve = g.iqrPolygon.length > 0;

  return (
    `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="${g.targetBand.x}" y="${f1(g.targetBand.y)}" width="${f1(g.targetBand.width)}" height="${f1(g.targetBand.height)}" fill="#10b981" fill-opacity="0.1"/>` +
    yTicks +
    // Wider 5-95% band drawn first (lighter), then the 25-75% band on top of
    // it (darker) - same layering as the app's AGP percentile ribbons.
    (hasCurve ? `<polygon points="${pointsAttr(g.p595Polygon)}" fill="#22d3ee" fill-opacity="0.09"/>` : "") +
    (hasCurve ? `<polygon points="${pointsAttr(g.iqrPolygon)}" fill="#22d3ee" fill-opacity="0.18"/>` : "") +
    (hasCurve ? `<polyline points="${pointsAttr(g.medianLine)}" fill="none" stroke="#0891b2" stroke-width="2"/>` : "") +
    dots +
    xTicks +
    `</svg>`
  );
}

type Tf = (k: string, o?: Record<string, unknown>) => string;

/** Report colour for a reading, five-band, against the profile's range. */
function dotColor(v: number, band: TargetBand): string {
  if (v >= VERY_HIGH_MGDL) return GLUCOSE_COLORS.veryHigh;
  if (v < 54) return GLUCOSE_VERY_LOW;
  if (v < band.low) return GLUCOSE_COLORS.low;
  if (v <= band.high) return GLUCOSE_COLORS.normal;
  return GLUCOSE_COLORS.elevated;
}

// Timeline glyph geometry, defined once and shared by both the day bands and
// their legend, so the two can never draw the same mark two different ways.
const TIMELINE_DOT_R = 3;
const TIMELINE_MEAL_FONT = 7;
const TIMELINE_DOSE_R = 1.8;
const TIMELINE_DOSE_COLOR = "#2563eb";

/**
 * A small inline-SVG key for the timeline's own glyphs (glucose dot, meal
 * triangle, dose dot), built from the exact same size/colour constants the
 * bands draw with. The colour legend for what each glucose colour MEANS
 * already lives at the top of the report, so this only explains the shapes.
 */
function buildTimelineLegend(tf: Tf, showDoses: boolean): string {
  const item = (glyph: string, label: string) =>
    `<span><svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">${glyph}</svg>${label}</span>`;
  return (
    `<div class="tlleg">` +
    item(`<circle cx="6" cy="6" r="${TIMELINE_DOT_R}" fill="${GLUCOSE_COLORS.normal}"/>`, tf("report.legendGlucose")) +
    item(`<text x="6" y="9" font-size="${TIMELINE_MEAL_FONT}" text-anchor="middle" fill="${BRAND}">&#9650;</text>`, tf("report.legendMeal")) +
    (showDoses
      ? item(`<circle cx="6" cy="6" r="${TIMELINE_DOSE_R}" fill="${TIMELINE_DOSE_COLOR}"/>`, tf("report.legendDose"))
      : "") +
    `</div>`
  );
}

/**
 * The daily time-line: one horizontal band per day, a 00-24 axis with the day's
 * glucose readings as colour-coded dots, meals as small triangles above and
 * doses as dots below, and the day's avg + TIR at the band head. `page-break-
 * inside: avoid` on each band keeps a day from splitting across a page.
 */
function buildTimeline(
  sugar: SugarLog[],
  meals: MealLog[],
  injections: Injection[],
  band: TargetBand,
  unit: GlucoseUnit,
  tf: Tf,
  /** insulin_mode "none": the dose row and its legend glyph are not drawn. */
  showDoses: boolean
): string {
  type Day = { readings: SugarLog[]; meals: MealLog[]; doses: Injection[] };
  const dayMap = new Map<string, Day>();
  const ensure = (iso: string): Day => {
    const k = formatDateKey(iso);
    let d = dayMap.get(k);
    if (!d) {
      d = { readings: [], meals: [], doses: [] };
      dayMap.set(k, d);
    }
    return d;
  };
  for (const s of sugar) ensure(s.logged_at).readings.push(s);
  for (const m of meals) ensure(m.logged_at).meals.push(m);
  if (showDoses) {
    for (const i of injections) if (i.dose_units && i.dose_units > 0) ensure(i.logged_at).doses.push(i);
  }
  const dayKeys = Array.from(dayMap.keys()).sort().reverse();
  if (dayKeys.length === 0) return "";

  const W = 540;
  const padL = 6;
  const padR = 6;
  const span = W - padL - padR;
  const xFor = (iso: string) => {
    const d = new Date(iso);
    const h = d.getHours() + d.getMinutes() / 60;
    return padL + (h / 24) * span;
  };
  const grid = [6, 12, 18]
    .map((h) => `<line x1="${(padL + (h / 24) * span).toFixed(1)}" y1="4" x2="${(padL + (h / 24) * span).toFixed(1)}" y2="26" stroke="#f4f4f5"/>`)
    .join("");
  const u = glucoseUnitLabel(unit);

  const bands = dayKeys
    .map((k) => {
      const g = dayMap.get(k)!;
      const levels = g.readings.map((r) => r.glucose_level_mgdl);
      const avg = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
      const inR = levels.filter((v) => v >= band.low && v <= band.high).length;
      const tir = levels.length ? Math.round((inR / levels.length) * 100) : null;
      const dots = g.readings
        .map((r) => `<circle cx="${xFor(r.logged_at).toFixed(1)}" cy="15" r="${TIMELINE_DOT_R}" fill="${dotColor(r.glucose_level_mgdl, band)}"/>`)
        .join("");
      const mealMarks = g.meals
        .map((m) => `<text x="${xFor(m.logged_at).toFixed(1)}" y="7" font-size="${TIMELINE_MEAL_FONT}" text-anchor="middle" fill="${BRAND}">&#9650;</text>`)
        .join("");
      const doseMarks = g.doses
        .map((i) => `<circle cx="${xFor(i.logged_at).toFixed(1)}" cy="27" r="${TIMELINE_DOSE_R}" fill="${TIMELINE_DOSE_COLOR}"/>`)
        .join("");
      const summary =
        avg != null
          ? `${esc(formatGlucose(avg, unit))} ${u} · TIR ${esc(pct(tir ?? 0))}`
          : "-";
      return (
        `<div class="band"><div class="bandhead"><span class="bd">${esc(fmtDay(new Date(`${k}T12:00:00`)))}</span><span class="bs">${summary}</span></div>` +
        `<svg viewBox="0 0 ${W} 30" width="100%" height="30" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">` +
        `<line x1="${padL}" y1="15" x2="${W - padR}" y2="15" stroke="#eee"/>${grid}${mealMarks}${dots}${doseMarks}</svg></div>`
      );
    })
    .join("");
  return `<h2 class="pbreak">${tf("report.timelineTitle")}</h2><div class="cap">${tf("report.timelineCaption")}</div>${buildTimelineLegend(tf, showDoses)}${bands}`;
}

/** The events page: low events (+ follow-up), the highest five readings, and a
 *  basal/bolus dose summary bar. */
function buildEvents(
  sugar: SugarLog[],
  insights: ReturnType<typeof computeInsights>,
  hypoThresh: number,
  unit: GlucoseUnit,
  tf: Tf,
  /** insulin_mode "none": the basal/bolus dose bar is not drawn. */
  showDoses: boolean
): string {
  const u = glucoseUnitLabel(unit);
  const byNewest = [...sugar].sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));
  const hypos = byNewest.filter((s) => s.glucose_level_mgdl < hypoThresh);
  // The re-check a low is read against is the FIRST reading inside the window,
  // not any reading inside it: `sugar` arrives newest-first, so find() returned
  // the LATEST one, and a low followed by two readings printed the second - a
  // number taken up to 15 minutes after the one that actually answered it.
  const followUp = (s: SugarLog): SugarLog | undefined => {
    const from = new Date(s.logged_at).getTime();
    let best: SugarLog | undefined;
    let bestDt = Infinity;
    for (const x of sugar) {
      const dt = (new Date(x.logged_at).getTime() - from) / 60000;
      if (dt > 0 && dt <= LOW_FOLLOWUP_MINUTES && dt < bestDt) {
        bestDt = dt;
        best = x;
      }
    }
    return best;
  };
  const hypoRows = hypos
    .slice(0, 20)
    .map((s) => {
      const { date, time } = fmtDateTime(s.logged_at);
      const f = followUp(s);
      return `<tr><td>${esc(date)} ${esc(time)}</td><td>${esc(formatGlucose(s.glucose_level_mgdl, unit))} ${u}</td><td>${f ? `${esc(formatGlucose(f.glucose_level_mgdl, unit))} ${u}` : "-"}</td></tr>`;
    })
    .join("");
  const top5 = [...sugar]
    .sort((a, b) => b.glucose_level_mgdl - a.glucose_level_mgdl)
    .slice(0, 5)
    .map((s) => {
      const { date, time } = fmtDateTime(s.logged_at);
      return `<tr><td>${esc(date)} ${esc(time)}</td><td>${esc(formatGlucose(s.glucose_level_mgdl, unit))} ${u}</td></tr>`;
    })
    .join("");
  const bb = insights.basalUnits + insights.bolusUnits;
  const basalPct = bb > 0 ? Math.round((insights.basalUnits / bb) * 100) : 0;
  const doseBar =
    showDoses && bb > 0
      ? `<div class="tirbar"><div style="width:${basalPct}%;background:${BRAND}"></div><div style="width:${100 - basalPct}%;background:#f59e0b"></div></div>` +
        `<div class="tirleg"><span><i style="background:${BRAND}"></i>${tf("insights.basal")} ${esc(num(Math.round(insights.basalUnits * 10) / 10))}</span><span><i style="background:#f59e0b"></i>${tf("insights.bolus")} ${esc(num(Math.round(insights.bolusUnits * 10) / 10))}</span></div>`
      : "";
  const hypoSection = hypoRows
    ? `<h3 class="evh">${tf("report.hypoEvents")}</h3><table><thead><tr><th>${tf("export.colDate")}</th><th>${tf("export.colGlucose")}</th><th>${tf("report.followUp", { n: LOW_FOLLOWUP_MINUTES })}</th></tr></thead><tbody>${hypoRows}</tbody></table>`
    : "";
  const topSection = top5
    ? `<h3 class="evh">${tf("report.topReadings")}</h3><table><tbody>${top5}</tbody></table>`
    : "";
  const doseSection = doseBar ? `<h3 class="evh">${tf("report.doseSummary")}</h3>${doseBar}` : "";
  if (!hypoSection && !topSection && !doseSection) return "";
  return `<h2 class="pbreak">${tf("report.eventsTitle")}</h2>${hypoSection}${topSection}${doseSection}`;
}

/** A KPI tile identical in shape to buildHtml's own `.kpi` cards, plus an
 *  optional third "delta" line (`.kd`) - shared by every D10 section below so
 *  they read as one family with the report's existing headline KPIs. */
function kpiTile(label: string, value: string, color: string, delta?: string): string {
  return (
    `<div class="kpi" style="border-top-color:${color}">` +
    `<div class="kv">${value}</div><div class="kl">${label}</div>` +
    (delta ? `<div class="kd">${delta}</div>` : "") +
    `</div>`
  );
}

/** Signed "+N unit" / "-N unit", the print equivalent of the app's own
 *  avgDeltaChip - never a bare number, so a positive/negative change is never
 *  ambiguous on paper. */
function signedGlucose(mgdl: number, unit: GlucoseUnit): string {
  const u = glucoseUnitLabel(unit);
  return `${mgdl >= 0 ? "+" : "-"}${formatGlucose(Math.abs(mgdl), unit)} ${u}`;
}

/** Weekly comparison (D10a): this calendar week (so far) vs. the previous
 *  full week - TIR / average / CV. Only printed when the report's own range
 *  both covers at least two weeks AND actually reaches "now" (the section is
 *  inherently about the CURRENT week, so a report of a past date range would
 *  otherwise print a comparison outside its own stated period). */
function buildWeeklyCompareHtml(
  readings: SugarLog[],
  range: DateRange,
  band: TargetBand,
  unit: GlucoseUnit,
  tf: Tf
): string {
  const endsNow = Math.abs(Date.now() - range.end) <= 26 * 3_600_000;
  if (!endsNow || rangeWindowDays(range) < 14) return "";
  const wc = weeklyComparison(readings, Date.now(), weekAnchorForLang(currentLang()), {
    low: band.low,
    high: band.high,
  });
  if (wc.currentReadingCount === 0 && wc.previousReadingCount === 0) return "";
  const vsPrev = tf("insights.vsPrevious");
  const tiles =
    kpiTile(
      tf("insights.timeInRange"),
      wc.tir.current == null ? "-" : esc(pct(wc.tir.current)),
      GLUCOSE_COLORS.normal,
      wc.tir.delta == null
        ? undefined
        : `${wc.tir.delta >= 0 ? "+" : "-"}${esc(pct(Math.abs(wc.tir.delta)))} ${vsPrev}`
    ) +
    kpiTile(
      tf("insights.avgGlucose"),
      wc.avg.current == null ? "-" : `${esc(formatGlucose(wc.avg.current, unit))} ${esc(glucoseUnitLabel(unit))}`,
      BRAND,
      wc.avg.delta == null ? undefined : `${esc(signedGlucose(wc.avg.delta, unit))} ${vsPrev}`
    ) +
    kpiTile(
      tf("insights.cv"),
      wc.cv.current == null ? "-" : esc(pct(wc.cv.current)),
      BRAND,
      wc.cv.delta == null
        ? undefined
        : `${wc.cv.delta >= 0 ? "+" : "-"}${esc(pct(Math.abs(wc.cv.delta)))} ${vsPrev}`
    );
  return `<h2>${tf("insights.weeklyCompareTitle")}</h2><div class="kpis">${tiles}</div>`;
}

/** Hour-of-day heat strip (D10b): mean glucose per 3-hour block, pooled over
 *  the report's range. Gated on AGP_MIN_READINGS - the same "is this pooled
 *  view even meaningful" floor the AGP chart itself already uses. */
function buildHourBandHtml(
  readings: SugarLog[],
  days: number,
  band: TargetBand,
  unit: GlucoseUnit,
  tf: Tf
): string {
  if (readings.length < AGP_MIN_READINGS) return "";
  const bandsArr = hourBandAverages(readings, days);
  if (bandsArr.every((b) => b.n === 0)) return "";
  const cells = bandsArr
    .map((b) => {
      const label = `${two(b.startHour)}-${two(b.endHour)}`;
      if (b.avg == null) {
        return `<div class="hbcell" style="background:#e5e7eb"><div class="hbv">-</div><div class="hbl">${label}</div></div>`;
      }
      const style = `background:${dotColor(b.avg, band)}${b.sparse ? ";opacity:0.45" : ""}`;
      return `<div class="hbcell" style="${style}"><div class="hbv">${esc(formatGlucose(b.avg, unit))}</div><div class="hbl">${label}</div></div>`;
    })
    .join("");
  return (
    `<h2>${tf("insights.heatStripTitle")}</h2><div class="cap">${tf("insights.heatStripSub")}</div>` +
    `<div class="heatstrip">${cells}</div>`
  );
}

/** Best day + streaks (D10d): the single best-TIR day in the last 30 days, a
 *  day-in-target streak and a plain logging streak. Gated on the report range
 *  being at least a week (a streak over less than that is not informative)
 *  and on there being SOMETHING to show (skipped outright otherwise, rather
 *  than printing an all-zero section). */
function buildBestDayHtml(
  readings: SugarLog[],
  range: DateRange,
  band: TargetBand,
  unit: GlucoseUnit,
  tf: Tf
): string {
  if (rangeWindowDays(range) < 7) return "";
  const bs = bestDayAndStreaks(readings, { low: band.low, high: band.high }, Date.now());
  if (!bs.bestDay && bs.targetDayStreak.longest === 0 && bs.loggingStreak.longest === 0) return "";
  const u = glucoseUnitLabel(unit);
  const bestTile = bs.bestDay
    ? kpiTile(
        tf("insights.bestDayLabel"),
        esc(fmtDay(new Date(`${bs.bestDay.day}T12:00:00`))),
        GLUCOSE_COLORS.normal,
        `${esc(pct(bs.bestDay.tir))} ${tf("insights.timeInRange")} &middot; ${esc(formatGlucose(bs.bestDay.avg, unit))} ${esc(u)}`
      )
    : "";
  const tiles =
    bestTile +
    kpiTile(
      tf("insights.streakTargetLabel"),
      String(bs.targetDayStreak.current),
      BRAND,
      tf("insights.streakLongest", { n: bs.targetDayStreak.longest })
    ) +
    kpiTile(
      tf("insights.streakLoggingLabel"),
      String(bs.loggingStreak.current),
      BRAND,
      tf("insights.streakLongest", { n: bs.loggingStreak.longest })
    );
  const note = `<div class="cap">${tf("insights.streaksNote", { pct: pct(DAY_IN_TARGET_TIR_PCT) })}</div>`;
  return `<h2>${tf("insights.bestDayStreaksTitle")}</h2><div class="kpis">${tiles}</div>${note}`;
}

/** Below this many meals with a computable delta, "lowest vs. highest" is one
 *  or two data points dressed up as a comparison. */
const MEAL_RESPONSE_PDF_MIN_SAMPLE = 3;

/** Meal response summary (D10e): average glucose change after a meal, plus
 *  the lowest- and highest-change meals BY NAME (the user's own logged meal
 *  names - never "good"/"bad", only "lowest"/"highest average change"). */
function buildMealResponseHtml(
  meals: MealLog[],
  readings: SugarLog[],
  mealNames: Map<string, string>,
  unit: GlucoseUnit,
  tf: Tf
): string {
  const ms = mealResponseSummary(meals, readings);
  if (ms.deltaSampleSize < MEAL_RESPONSE_PDF_MIN_SAMPLE) return "";
  const avgTile = kpiTile(
    tf("insights.mealResponseAvgLabel"),
    ms.avgDelta == null ? "-" : esc(signedGlucose(ms.avgDelta, unit)),
    BRAND,
    tf("insights.mealResponseSampleNote", { n: ms.deltaSampleSize })
  );
  const row = (label: string, entry: typeof ms.best) =>
    entry
      ? `<tr><td>${label}</td><td>${esc(mealNames.get(entry.mealId) ?? "-")}</td><td class="v">${esc(signedGlucose(entry.delta as number, unit))}</td></tr>`
      : "";
  const rows = row(tf("insights.mealResponseLowest"), ms.best) + row(tf("insights.mealResponseHighest"), ms.worst);
  const table = rows ? `<table><tbody>${rows}</tbody></table>` : "";
  return (
    `<h2>${tf("insights.mealResponseTitle")}</h2><div class="cap">${tf("insights.mealResponseSub")}</div>` +
    `<div class="kpis">${avgTile}</div>${table}`
  );
}

/** Weeks of history the CV trend needs before a line means anything more than
 *  "not much data yet" (matches the "8-12 weeks" range lib/insightsPro.ts's
 *  cvTrend docstring itself calls out). */
const CV_TREND_PDF_MIN_WEEKS = 8;
const CV_TREND_PDF_MAX_WEEKS = 12;

/** CV trend (D10f): a small inline-SVG line of weekly glucose variability
 *  (%CV), one point per calendar week - the print equivalent of the app's
 *  Sparkline. Weeks with no basis for a CV (fewer than 2 readings) are simply
 *  skipped when drawing the line, exactly like a gap in the app's own chart. */
function buildCvTrendHtml(readings: SugarLog[], range: DateRange, tf: Tf): string {
  const weeksAvail = Math.floor(rangeWindowDays(range) / 7);
  if (weeksAvail < CV_TREND_PDF_MIN_WEEKS) return "";
  const weeks = Math.min(weeksAvail, CV_TREND_PDF_MAX_WEEKS);
  const trend = cvTrend(readings, Date.now(), weekAnchorForLang(currentLang()), weeks);
  const withCv = trend.weeks.filter(
    (w): w is CvWeekPoint & { cv: number } => w.cv != null
  );
  if (withCv.length === 0) return "";

  const W = 300;
  const H = 60;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 8;
  const vals = withCv.map((w) => w.cv);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = trend.weeks.length;
  const stepX = n > 1 ? (W - padL - padR) / (n - 1) : 0;
  const xFor = (i: number) => padL + i * stepX;
  const yFor = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);

  let path = "";
  trend.weeks.forEach((w, i) => {
    if (w.cv == null) return;
    path += `${path ? "L" : "M"}${xFor(i).toFixed(1)},${yFor(w.cv).toFixed(1)} `;
  });
  const dots = trend.weeks
    .map((w, i) =>
      w.cv == null ? "" : `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(w.cv).toFixed(1)}" r="2.2" fill="#0891b2"/>`
    )
    .join("");
  const svg =
    `<svg viewBox="0 0 ${W} ${H}" width="260" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${path.trim()}" fill="none" stroke="#0891b2" stroke-width="2"/>${dots}</svg>`;

  const last = withCv[withCv.length - 1];
  const prev = withCv.length > 1 ? withCv[withCv.length - 2] : null;
  const deltaLine = prev
    ? `<div class="cap">${last.cv - prev.cv >= 0 ? "+" : "-"}${esc(pct(Math.abs(last.cv - prev.cv)))} ${tf("insights.vsPrevious")}</div>`
    : "";
  return `<h2>${tf("insights.cvTrendTitle")}</h2><div class="cap">${tf("insights.cvTrendSub")}</div>${svg}${deltaLine}`;
}

function buildHtml(
  profile: UserProfile,
  range: DateRange,
  insights: ReturnType<typeof computeInsights>,
  timelineHtml: string,
  eventsHtml: string,
  agpSvg: string,
  tir: TirBreakdown,
  glucose: { date: string; time: string; value: string; period: string }[],
  injections: { date: string; time: string; site: string; dose: string }[],
  meds: { date: string; time: string; name: string }[],
  meals: { date: string; time: string; food: string; carbs: string; dose: string }[],
  /** D10g: the weekly-compare / hour-band / best-day / meal-response / CV-
   *  trend sections, already built and concatenated (each "" when the range
   *  or the data does not clear its own threshold - see report.ts's build*Html
   *  functions), so this stays a single optional splice into the template. */
  proInsightsHtml = ""
): string {
  const unit: GlucoseUnit = profile.glucose_unit ?? "mgdl";
  const u = glucoseUnitLabel(unit);
  // The band the caption states is the profile's own, matching the chart above.
  const reportBand = targetBandFor(profile);
  // A profile with no insulin mode gets no insulin surface in the document it
  // hands its doctor: no dose metrics, no injection table, no dose column. But
  // mode changes must never hide already-logged data (lib/insulinMode), so the
  // flag also fires when the reported range itself still holds injections.
  const usesInsulin =
    insulinModeUsesInsulin(insulinModeOf(profile)) || injections.length > 0;
  // Same rule as usesInsulin above: the toggle, or (mode changes must never
  // hide already-logged data) a medication row still sitting in this range.
  const usesMeds = profile.oral_meds_enabled === 1 || meds.length > 0;
  const fmtG = (mgdl: number | null) =>
    mgdl == null ? "-" : `${formatGlucose(mgdl, unit)} ${u}`;
  // Cover shows the actual range; "generated" is the real current moment.
  const start = new Date(range.start);
  const rangeEnd = new Date(range.end);
  const windowDays = rangeWindowDays(range);
  const generated = new Date();

  const t = (k: string, o?: Record<string, unknown>) => esc(i18n.t(k, o));

  // Arabic is the one bundle written right-to-left, and a PDF has no viewer to
  // guess for it: without `dir` the tables came out left-aligned with the labels
  // and their values on the wrong sides of the row. Only the text directions flip;
  // the SVG charts are geometry (hour 0 stays on the left, as a clock reads) and
  // are left exactly as drawn. Both strings below are EMPTY in every other
  // language, so those documents are byte for byte the ones produced before.
  const rtl = currentLang().slice(0, 2) === "ar";
  const dirAttr = rtl ? ' dir="rtl"' : "";
  const rtlCss = rtl
    ? `
  [dir="rtl"] th, [dir="rtl"] td { text-align: right; }
  [dir="rtl"] td.v { text-align: left; }
  [dir="rtl"] .head .info { text-align: left; }
  [dir="rtl"] .tirleg i { margin-right: 0; margin-left: 4px; }`
    : "";

  // Summary rows (label, value) - labels and values reuse existing i18n.
  const summaryRows: [string, string][] = [
    [t("insights.avgGlucose"), fmtG(insights.avgGlucose)],
    [t("insights.timeInRange"), insights.inRangePct == null ? "-" : esc(pct(insights.inRangePct))],
    [t("insights.gmi"), insights.gmi == null ? "-" : esc(pct(insights.gmi, 1))],
    [t("insights.variability"), fmtG(insights.glucoseSD)],
    [t("insights.cv"), insights.glucoseCV == null ? "-" : esc(pct(insights.glucoseCV))],
    [t("insights.lows"), String(insights.hypoCount)],
  ];
  if (usesInsulin) {
    summaryRows.push(
      [t("insights.avgDose"), insights.avgDailyDose == null ? "-" : `${num(Math.round(insights.avgDailyDose * 10) / 10)} ${t("common.units")}`],
      [
        t("insights.basalBolus"),
        insights.basalPct == null
          ? "-"
          : `${num(Math.round(insights.basalUnits * 10) / 10)} / ${num(Math.round(insights.bolusUnits * 10) / 10)} ${t("common.units")}`,
      ],
      [t("insights.injectionsCount"), String(insights.injectionCount)]
    );
  }

  const summaryTable = `
    <table>
      <tbody>
        ${summaryRows
          .map(
            ([label, value]) =>
              `<tr><td class="k">${label}</td><td class="v">${value}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`;

  // KPI cards: the headline metrics as colour-accented boxes (mySugr-style).
  const kpis: { label: string; value: string; color: string }[] = [
    { label: t("insights.avgGlucose"), value: fmtG(insights.avgGlucose), color: BRAND },
    { label: t("insights.gmi"), value: insights.gmi == null ? "-" : esc(pct(insights.gmi, 1)), color: BRAND },
    { label: t("insights.timeInRange"), value: insights.inRangePct == null ? "-" : esc(pct(insights.inRangePct)), color: GLUCOSE_COLORS.normal },
    { label: t("insights.variability"), value: fmtG(insights.glucoseSD), color: BRAND },
    { label: t("insights.cv"), value: insights.glucoseCV == null ? "-" : esc(pct(insights.glucoseCV)), color: BRAND },
    { label: t("insights.lows"), value: String(insights.hypoCount), color: GLUCOSE_COLORS.low },
  ];
  const kpiCards = `<div class="kpis">${kpis
    .map(
      (k) =>
        `<div class="kpi" style="border-top-color:${k.color}"><div class="kv">${k.value}</div><div class="kl">${k.label}</div></div>`
    )
    .join("")}</div>`;

  // TIR stacked bar: veryLow / low / target / high / veryHigh, GLUCOSE colours.
  const tirTotal = Math.max(1, tir.total);
  const tirSegs: { n: number; color: string; label: string }[] = [
    { n: tir.veryLow, color: GLUCOSE_VERY_LOW, label: t("insights.veryLow") },
    { n: tir.low, color: GLUCOSE_COLORS.low, label: t("insights.low") },
    { n: tir.target, color: GLUCOSE_COLORS.normal, label: t("insights.inRange") },
    { n: tir.high, color: GLUCOSE_COLORS.elevated, label: t("insights.high") },
    { n: tir.veryHigh, color: GLUCOSE_COLORS.veryHigh, label: t("insights.veryHigh") },
  ];
  const tirBar =
    tir.total > 0
      ? `<div class="tirbar">${tirSegs
          .map(
            (s) =>
              `<div style="width:${((s.n / tirTotal) * 100).toFixed(1)}%;background:${s.color}"></div>`
          )
          .join("")}</div>` +
        `<div class="tirleg">${tirSegs
          .map(
            (s) =>
              `<span><i style="background:${s.color}"></i>${s.label} ${esc(pct((s.n / tirTotal) * 100))}</span>`
          )
          .join("")}</div>`
      : "";

  const section = (title: string, head: string, body: string) =>
    body
      ? `<h2>${title}</h2><table><thead>${head}</thead><tbody>${body}</tbody></table>`
      : "";

  const glucoseSection = section(
    t("report.glucoseReadings"),
    `<tr><th>${t("export.colDate")}</th><th>${t("export.colTime")}</th><th>${t("export.colGlucose")}</th><th>${t("dashboard.selectPeriod")}</th></tr>`,
    glucose
      .map(
        (r) =>
          `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.value)}</td><td>${esc(r.period)}</td></tr>`
      )
      .join("")
  );

  const injectionSection = usesInsulin
    ? section(
        t("injection.title"),
        `<tr><th>${t("export.colDate")}</th><th>${t("export.colTime")}</th><th>${t("export.colSite")}</th><th>${t("export.colInsulin")}</th></tr>`,
        injections
          .map(
            (r) =>
              `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.site)}</td><td>${esc(r.dose)}</td></tr>`
          )
          .join("")
      )
    : "";

  const medSection = usesMeds
    ? section(
        t("meds.title"),
        `<tr><th>${t("export.colDate")}</th><th>${t("export.colTime")}</th><th>${t("export.colNote")}</th></tr>`,
        meds
          .map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.name)}</td></tr>`)
          .join("")
      )
    : "";
  // Splices in as its own line only when non-empty, so a profile with no
  // medication data at all gets the exact same HTML (and PDF) this report
  // produced before the med section existed.
  const medBlock = medSection ? `\n  ${medSection}` : "";

  const mealSection = section(
    t("report.meals"),
    `<tr><th>${t("export.colDate")}</th><th>${t("export.colTime")}</th><th>${t("export.colFood")}</th><th>${t("export.colCarbs")}</th>${
      usesInsulin ? `<th>${t("export.colInsulin")}</th>` : ""
    }</tr>`,
    meals
      .map(
        (r) =>
          `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.food)}</td><td>${esc(r.carbs)}</td>${
            usesInsulin ? `<td>${esc(r.dose)}</td>` : ""
          }</tr>`
      )
      .join("")
  );

  return `<!DOCTYPE html>
<html lang="${currentLang()}"${dirAttr}>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 24px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px; }
  .head .brand { color: ${BRAND}; font-size: 13px; font-weight: 700; letter-spacing: .02em; }
  .head .title { font-size: 25px; font-weight: 800; color: #111; margin-top: 3px; }
  .head .info { text-align: right; color: #555; font-size: 11px; line-height: 1.7; }
  .head .info b { color: #222; font-weight: 600; }
  .headsep { border: none; border-top: 2px solid ${BRAND}; margin: 6px 0 20px; }
  h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  /* No uppercasing: Turkish 'i' upcases wrong under CSS text-transform. */
  th { background: #f4f4f5; font-size: 10px; letter-spacing: .03em; color: #555; }
  td.k { color: #555; width: 55%; }
  td.v { font-weight: 600; text-align: right; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ddd; color: #777; font-size: 10px; line-height: 1.5; }
  .cap { color: #777; font-size: 10px; margin: 4px 0 2px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 14px; }
  .kpi { flex: 1 1 28%; min-width: 120px; border: 1px solid #eee; border-top: 4px solid ${BRAND}; border-radius: 8px; padding: 11px 13px; background: #fafafa; }
  .kpi .kv { font-size: 23px; font-weight: 800; color: #111; }
  .kpi .kl { font-size: 11px; color: #666; margin-top: 3px; }
  .tirbar { display: flex; width: 100%; height: 18px; border-radius: 5px; overflow: hidden; margin: 4px 0 6px; }
  .tirleg { display: flex; flex-wrap: wrap; gap: 10px; font-size: 10px; color: #555; }
  .tirleg span { display: inline-flex; align-items: center; }
  .tirleg i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; margin-right: 4px; }
  .tlleg { display: flex; flex-wrap: wrap; gap: 12px; font-size: 10px; color: #555; margin: 2px 0 8px; }
  .tlleg span { display: inline-flex; align-items: center; gap: 3px; }
  .tlleg svg { display: block; flex-shrink: 0; }
  .band { page-break-inside: avoid; margin-bottom: 5px; }
  .bandhead { display: flex; justify-content: space-between; font-size: 9px; color: #555; }
  .bandhead .bd { font-weight: 700; color: #222; }
  .pbreak { page-break-before: always; }
  .evh { font-size: 12px; margin: 12px 0 4px; color: #333; }
  .kpi .kd { font-size: 10px; color: #777; margin-top: 4px; }
  /* Physically LTR always (00 -> 24 left to right), same fixed-order lock as
     app/insights.tsx's own heat strip: a clock, not a reading-direction list.
     Without this, [dir="rtl"] on <body> (Arabic) flips the flex order and
     puts hour 0 on the right. */
  .heatstrip { display: flex; gap: 4px; margin: 4px 0 12px; direction: ltr; }
  .hbcell { flex: 1; border-radius: 6px; padding: 6px 2px; text-align: center; color: #1a1a1a; }
  .hbcell .hbv { font-size: 11px; font-weight: 700; }
  .hbcell .hbl { font-size: 8px; opacity: .75; margin-top: 2px; }${rtlCss}
</style>
</head>
<body${dirAttr}>
  <div class="head">
    <div>
      <div class="brand">zerospike</div>
      <div class="title">${t("report.reportTitle")}</div>
    </div>
    <div class="info">
      <div><b>${t("report.profile")}:</b> ${esc(profile.name)}</div>
      <div><b>${t("report.dateRange")}:</b> ${fmtDay(start)} - ${fmtDay(rangeEnd)}</div>
      <div><b>${t("report.generated")}:</b> ${fmtDay(generated)} ${two(generated.getHours())}:${two(generated.getMinutes())}</div>
    </div>
  </div>
  <hr class="headsep" />

  <h2>${t("report.summary")}</h2>
  ${kpiCards}
  ${tirBar ? `<div class="cap">${t("insights.timeInRange")}</div>${tirBar}` : ""}

  ${agpSvg ? `<h2>${t("report.agpTitle")}</h2>${agpSvg}<div class="cap">${t("report.agpCaption", { low: esc(formatGlucose(reportBand.low, unit)), high: esc(formatGlucose(reportBand.high, unit)) })}</div>` : ""}

  ${proInsightsHtml}

  <h2>${t("report.summary")}</h2>
  ${summaryTable}

  ${timelineHtml}

  ${eventsHtml}

  ${glucoseSection}
  ${injectionSection}${medBlock}
  ${mealSection}

  <div class="foot">
    ${t("disclaimer.body")}<br/>
    ${insights.gmi != null ? `${t("insights.gmiNote")}<br/>` : ""}
    ${t("insights.disclaimer")}
  </div>
</body>
</html>`;
}

/**
 * Splits the journal feed back into the three per-table row shapes the metric
 * helpers take (computeInsights, computeAgp, buildTimeline, buildEvents).
 *
 * The feed carries every column those helpers read; the few it does not are the
 * ones none of them touch (a reading's HealthKit mirror uuid, a meal's raw
 * custom name - the resolved display_name is what the tables print - its source
 * template, and an injection's meal reference). They are filled with the honest
 * empty value rather than guessed at. Feed order is newest-first, exactly like the per-table
 * queries this replaces, and every helper downstream either sorts for itself or
 * does not care.
 */
function splitJournalFeed(
  profileId: string,
  entries: Awaited<ReturnType<typeof getJournal>>
): { sugar: SugarLog[]; meals: MealLog[]; injections: Injection[] } {
  const sugar: SugarLog[] = [];
  const meals: MealLog[] = [];
  const injections: Injection[] = [];
  // Medication entries (schema v16) pass through untouched: they feed none of the
  // three metric tables, and no figure in this document is computed from them.
  for (const e of entries) {
    if (e.kind === "glucose") {
      sugar.push({
        id: e.id,
        profile_id: profileId,
        glucose_level_mgdl: e.glucose_level_mgdl,
        period_tag: e.period_tag,
        source: e.source,
        logged_at: e.logged_at,
        tags: e.tags,
        healthkit_uuid: null,
      });
    } else if (e.kind === "meal") {
      meals.push({
        id: e.id,
        profile_id: profileId,
        sugar_log_id: e.sugar_log_id,
        food_id: e.food_id,
        custom_food_name: null,
        portion_g: e.portion_g,
        calculated_carbs_g: e.calculated_carbs_g,
        insulin_dose_units: e.insulin_dose_units,
        photo_uri_local: e.photo_uri_local,
        personal_note: e.personal_note,
        logged_at: e.logged_at,
        tags: e.tags,
        meal_template_id: null,
      });
    } else if (e.kind === "injection") {
      injections.push({
        id: e.id,
        profile_id: profileId,
        site: e.site,
        site_point: e.site_point,
        dose_units: e.dose_units,
        insulin_type: e.insulin_type,
        bolus_kind: null,
        meal_log_id: null,
        note: e.note,
        source: e.source,
        logged_at: e.logged_at,
        tags: e.tags,
        // The journal feed this row is rebuilt from does not carry the product
        // (schema v22); the report never prints it, so null is the honest value
        // rather than a guess from the profile's CURRENT product.
        insulin_product_id: null,
        insulin_product_other: null,
      });
    }
  }
  return { sugar, meals, injections };
}

export async function exportLogsPdf(
  profile: UserProfile,
  windowDays: number,
  /** Optional explicit range; when given it overrides the windowDays shortcut. */
  range?: DateRange,
  /** Store-screenshot only: skip the share sheet and (optionally) copy the PDF to
   *  a deterministic path so the capture pipeline can pull it headlessly. */
  opts?: { skipShare?: boolean; copyTo?: string }
): Promise<ExportResult> {
  const lang = currentLang();
  // One conversion: a shortcut window OR a hand-picked range, same downstream.
  const r = range ?? rangeFromWindow(windowDays);
  const effectiveDays = rangeWindowDays(r);
  const unit: GlucoseUnit = profile.glucose_unit ?? "mgdl";

  // The range is a SQL filter, not a JS pass over the newest N rows: a report of
  // a month further back than the row cap used to be quietly incomplete.
  //
  // ONE read of the three log tables, not two. The journal feed already unions
  // sugar_logs / meal_logs / injection_logs over this exact range (and resolves
  // meal names through the foods join), and the raw per-table queries that used to
  // run alongside it re-read the very same rows to hand the metric functions their
  // own copy. Splitting the feed back out costs one pass over rows already in
  // memory; the queries cost a second trip through every table.
  //
  // EXPORT_MAX_ROWS now caps the merged feed rather than each table separately,
  // which only matters for a range holding more than 20 000 entries in total. Past
  // that point the document was already truncated - and now its charts, its
  // metrics and its tables all describe the SAME rows, where before the metrics
  // could cover readings the tables had no room to list.
  const entries = await getJournal(profile.id, lang, EXPORT_MAX_ROWS, r);
  const { sugar, meals: mealsRaw, injections: inj } = splitJournalFeed(
    profile.id,
    entries
  );

  // The report measures against the profile's own range, exactly like the app.
  const reportBand = targetBandFor(profile);
  const insights = computeInsights(sugar, mealsRaw, inj, effectiveDays, {
    low: reportBand.low,
    high: reportBand.high,
  }, r);
  // AGP over exactly the range's readings (the query already scoped them; the
  // huge window keeps computeAgp from re-windowing them).
  const sugarInRange = sugar;
  const agpSvg = buildAgpSvg(computeAgp(sugarInRange, 1_000_000), unit, reportBand);

  // Five-band TIR breakdown over the window, against the profile's own range.
  const tir: TirBreakdown = { veryLow: 0, low: 0, target: 0, high: 0, veryHigh: 0, total: 0 };
  for (const s of sugar) {
    const v = s.glucose_level_mgdl;
    tir.total++;
    if (v >= 250) tir.veryHigh++;
    else if (v < 54) tir.veryLow++;
    else if (v < reportBand.low) tir.low++;
    else if (v <= reportBand.high) tir.target++;
    else tir.high++;
  }

  // Tables are built from the journal feed (resolved names) within the window,
  // oldest-first for natural reading order.
  const inWindow = [...entries].reverse();
  if (inWindow.length === 0) return { ok: false, reason: "noData" };

  const glucose = inWindow
    .filter((e) => e.kind === "glucose")
    .map((e) => {
      const { date, time } = fmtDateTime(e.logged_at);
      const g = e as Extract<typeof e, { kind: "glucose" }>;
      return {
        date,
        time,
        value: `${formatGlucose(g.glucose_level_mgdl, unit)} ${glucoseUnitLabel(unit)}`,
        period: periodLabel(g.period_tag),
      };
    });

  const injections = inWindow
    .filter((e) => e.kind === "injection")
    .map((e) => {
      const { date, time } = fmtDateTime(e.logged_at);
      const x = e as Extract<typeof e, { kind: "injection" }>;
      const siteLabel = x.site
        ? i18n.t(`injectionSite.${x.site}`)
        : i18n.t("injectionSite.unassigned");
      return {
        date,
        time,
        // A short marker for a row confirmed straight from the basal
        // reminder (source 'reminder' - see lib/services/basalConfirm.ts),
        // same " · " badge pattern app/(tabs)/injection.tsx already uses for
        // the calculator's own 'fromCalculator' rows.
        site:
          x.source === "reminder"
            ? `${siteLabel} · ${i18n.t("report.fromReminder")}`
            : siteLabel,
        dose:
          x.dose_units != null ? `${num(x.dose_units)} ${i18n.t("common.units")}` : "",
      };
    });

  const meds = inWindow
    .filter((e) => e.kind === "med")
    .map((e) => {
      const { date, time } = fmtDateTime(e.logged_at);
      const m = e as Extract<typeof e, { kind: "med" }>;
      return { date, time, name: medNoteCell(m.name, m.note) };
    });

  const meals = inWindow
    .filter((e) => e.kind === "meal")
    .map((e) => {
      const { date, time } = fmtDateTime(e.logged_at);
      const m = e as Extract<typeof e, { kind: "meal" }>;
      return {
        date,
        time,
        food: m.display_name,
        carbs: `${num(Math.round(m.calculated_carbs_g * 10) / 10)} ${i18n.t("common.grams")}`,
        dose: `${num(m.insulin_dose_units)} ${i18n.t("common.units")}`,
      };
    });

  // Daily timeline + events, from the raw in-range rows.
  const tf: Tf = (k, o) => esc(i18n.t(k, o));
  // Same effective flag as buildHtml below: mode, or leftover injection data
  // in this exact range (inj comes from the same getJournal fetch above).
  const usesInsulin = insulinModeUsesInsulin(insulinModeOf(profile)) || inj.length > 0;
  const timelineHtml = buildTimeline(sugarInRange, mealsRaw, inj, reportBand, unit, tf, usesInsulin);
  const eventsHtml = buildEvents(sugarInRange, insights, hypoThreshold(profile), unit, tf, usesInsulin);

  // D10g: meal display names, already resolved by the journal feed (the same
  // names printed in the meals table below) - keyed by id so
  // buildMealResponseHtml can print the lowest/highest-change meal BY NAME
  // without a second query.
  const mealNameById = new Map<string, string>();
  for (const e of inWindow) if (e.kind === "meal") mealNameById.set(e.id, e.display_name);

  const proInsightsHtml =
    buildWeeklyCompareHtml(sugarInRange, r, reportBand, unit, tf) +
    buildHourBandHtml(sugarInRange, effectiveDays, reportBand, unit, tf) +
    buildBestDayHtml(sugarInRange, r, reportBand, unit, tf) +
    buildCvTrendHtml(sugarInRange, r, tf) +
    buildMealResponseHtml(mealsRaw, sugarInRange, mealNameById, unit, tf);

  const html = buildHtml(
    profile,
    r,
    insights,
    timelineHtml,
    eventsHtml,
    agpSvg,
    tir,
    glucose,
    injections,
    meds,
    meals,
    proInsightsHtml
  );

  const { uri } = await Print.printToFileAsync({ html });

  // Store-screenshot path: copy to a deterministic location and skip the share
  // sheet, so the capture pipeline can pull the PDF without any UI interaction.
  if (opts?.skipShare) {
    let finalUri = uri;
    if (opts.copyTo) {
      try {
        await FileSystem.deleteAsync(opts.copyTo, { idempotent: true });
        await FileSystem.copyAsync({ from: uri, to: opts.copyTo });
        finalUri = opts.copyTo;
      } catch {
        /* fall back to the print-cache uri */
      }
    }
    logEvent("report_generated", { window: windowDays });
    return { ok: true, uri: finalUri, count: inWindow.length };
  }

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: "sharingUnavailable" };
  }

  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: i18n.t("report.shareTitle"),
    UTI: "com.adobe.pdf",
  });

  logEvent("report_generated", { window: windowDays });
  return { ok: true, uri, count: inWindow.length };
}
