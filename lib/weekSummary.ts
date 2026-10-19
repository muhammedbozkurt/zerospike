/**
 * What the dashboard's "this week" strip shows. Pure, so the first-day rule is
 * testable without a renderer.
 *
 * With no glucose measurement EVER logged the three boxes (average, time in
 * range, streak) would read "No data / No data / 0": a row of empty tiles on a
 * brand-new dashboard. They are hidden and one line says when the summary
 * appears. Once any measurement exists the long-standing rule applies: the
 * boxes show while the last 7 days hold a reading or an injection, and nothing
 * is drawn otherwise (no hint then, because the user has measured before).
 */

export interface WeekSummaryInput {
  /** Any glucose reading at all, on any day. */
  hasAnyReading: boolean;
  weekReadings: number;
  weekInjections: number;
}

export type WeekSummaryView = "boxes" | "firstHint" | "hidden";

export function weekSummaryView(i: WeekSummaryInput): WeekSummaryView {
  if (!i.hasAnyReading) return "firstHint";
  return i.weekReadings > 0 || i.weekInjections > 0 ? "boxes" : "hidden";
}

export function showWeekBoxes(i: WeekSummaryInput): boolean {
  return weekSummaryView(i) === "boxes";
}
