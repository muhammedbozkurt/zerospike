import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import i18n, { currentLang } from "../i18n";
import { getJournal } from "../db/journal";
import { listSugarLogs, listMealLogs } from "../db/logs";
import { getInjections } from "../db/injections";
import { computeInsights } from "../insights";
import { formatGlucose, glucoseUnitLabel } from "../glucose";
import { num } from "../format";
import type { GlucoseUnit, PeriodTag, UserProfile } from "../db/types";
import type { ExportResult } from "./export";

/**
 * Generates a printable A4 PDF report (HTML → PDF via expo-print) of a profile's
 * data over a recent window, and opens the native share sheet.
 *
 * Descriptive only: the report shows the user's own logged data plus standard
 * metrics with their existing disclaimers. No interpretation or advice.
 */

const BRAND = "#22d3ee";

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`,
    time: `${two(d.getHours())}:${two(d.getMinutes())}`,
  };
}

function fmtDay(d: Date): string {
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
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

function buildHtml(
  profile: UserProfile,
  windowDays: number,
  insights: ReturnType<typeof computeInsights>,
  glucose: { date: string; time: string; value: string; period: string }[],
  injections: { date: string; time: string; site: string; dose: string; pen: string }[],
  meals: { date: string; time: string; food: string; carbs: string; dose: string }[]
): string {
  const unit: GlucoseUnit = profile.glucose_unit ?? "mgdl";
  const u = glucoseUnitLabel(unit);
  const fmtG = (mgdl: number | null) =>
    mgdl == null ? "-" : `${formatGlucose(mgdl, unit)} ${u}`;
  const now = new Date();
  const start = new Date(now.getTime() - windowDays * 86_400_000);

  const t = (k: string, o?: Record<string, unknown>) => esc(i18n.t(k, o));

  // Summary rows (label, value) — labels and values reuse existing i18n.
  const summaryRows: [string, string][] = [
    [t("insights.avgGlucose"), fmtG(insights.avgGlucose)],
    [t("insights.timeInRange"), insights.inRangePct == null ? "-" : `${Math.round(insights.inRangePct)} %`],
    [t("insights.gmi"), insights.gmi == null ? "-" : `${insights.gmi.toFixed(1)} %`],
    [t("insights.variability"), fmtG(insights.glucoseSD)],
    [t("insights.cv"), insights.glucoseCV == null ? "-" : `${Math.round(insights.glucoseCV)} %`],
    [t("insights.lows"), String(insights.hypoCount)],
    [t("insights.avgDose"), insights.avgDailyDose == null ? "-" : `${num(Math.round(insights.avgDailyDose * 10) / 10)} ${t("common.units")}`],
    [
      t("insights.basalBolus"),
      insights.basalPct == null
        ? "-"
        : `${num(Math.round(insights.basalUnits * 10) / 10)} / ${num(Math.round(insights.bolusUnits * 10) / 10)} ${t("common.units")}`,
    ],
    [t("insights.injectionsCount"), String(insights.injectionCount)],
  ];

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

  const injectionSection = section(
    t("injection.title"),
    `<tr><th>${t("export.colDate")}</th><th>${t("export.colTime")}</th><th>${t("export.colSite")}</th><th>${t("export.colInsulin")}</th><th>${t("export.colPen")}</th></tr>`,
    injections
      .map(
        (r) =>
          `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.site)}</td><td>${esc(r.dose)}</td><td>${esc(r.pen)}</td></tr>`
      )
      .join("")
  );

  const mealSection = section(
    t("report.meals"),
    `<tr><th>${t("export.colDate")}</th><th>${t("export.colTime")}</th><th>${t("export.colFood")}</th><th>${t("export.colCarbs")}</th><th>${t("export.colInsulin")}</th></tr>`,
    meals
      .map(
        (r) =>
          `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.food)}</td><td>${esc(r.carbs)}</td><td>${esc(r.dose)}</td></tr>`
      )
      .join("")
  );

  return `<!DOCTYPE html>
<html lang="${currentLang()}">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 24px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .head { border-bottom: 3px solid ${BRAND}; padding-bottom: 10px; margin-bottom: 16px; }
  .head h1 { color: ${BRAND}; font-size: 20px; margin: 0 0 6px; }
  .meta { color: #444; font-size: 11px; line-height: 1.5; }
  .meta b { color: #111; }
  h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f4f4f5; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #555; }
  td.k { color: #555; width: 55%; }
  td.v { font-weight: 600; text-align: right; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ddd; color: #777; font-size: 10px; line-height: 1.5; }
</style>
</head>
<body>
  <div class="head">
    <h1>${t("export.title")}</h1>
    <div class="meta">
      <div><b>${t("report.profile")}:</b> ${esc(profile.name)}</div>
      <div><b>${t("report.dateRange")}:</b> ${fmtDay(start)} - ${fmtDay(now)} (${t("insights.windowDays", { n: windowDays })})</div>
      <div><b>${t("report.generated")}:</b> ${fmtDay(now)} ${two(now.getHours())}:${two(now.getMinutes())}</div>
    </div>
  </div>

  <h2>${t("report.summary")}</h2>
  ${summaryTable}

  ${glucoseSection}
  ${injectionSection}
  ${mealSection}

  <div class="foot">${t("insights.disclaimer")}</div>
</body>
</html>`;
}

export async function exportLogsPdf(
  profile: UserProfile,
  windowDays: number
): Promise<ExportResult> {
  const lang = currentLang();
  const since = Date.now() - windowDays * 86_400_000;
  const within = (iso: string) => new Date(iso).getTime() >= since;
  const unit: GlucoseUnit = profile.glucose_unit ?? "mgdl";

  const [sugar, mealsRaw, inj, entries] = await Promise.all([
    listSugarLogs(profile.id, 5000),
    listMealLogs(profile.id, 5000),
    getInjections(profile.id, 5000),
    getJournal(profile.id, lang, 5000),
  ]);

  const insights = computeInsights(sugar, mealsRaw, inj, windowDays);

  // Tables are built from the journal feed (resolved names) within the window,
  // oldest-first for natural reading order.
  const inWindow = entries.filter((e) => within(e.logged_at)).reverse();
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
      return {
        date,
        time,
        site: i18n.t(`injectionSite.${x.site}`),
        dose:
          x.dose_units != null ? `${num(x.dose_units)} ${i18n.t("common.units")}` : "",
        pen: x.pen_name ?? "",
      };
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

  const html = buildHtml(profile, windowDays, insights, glucose, injections, meals);

  const { uri } = await Print.printToFileAsync({ html });

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: "sharingUnavailable" };
  }

  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: i18n.t("export.title"),
    UTI: "com.adobe.pdf",
  });

  return { ok: true, uri, count: inWindow.length };
}
