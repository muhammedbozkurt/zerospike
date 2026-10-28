import { pct } from "../format";
import { getActiveLang } from "../lang";
import type { CgmSourceKind } from "./metrics";
import { healthStoreLabelKey } from "./sourceLabel";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** What a window's figures were computed from (the fields of Insights). */
export interface BasisSummary {
  basis: "cgm" | "manual";
  /** 0..100, null when the window holds no sensor reading. */
  cgmCoverage: number | null;
  cgmSources: CgmSourceKind[];
  manualReadings: number;
}

/** Generic store names only: a kind of source, never a device or app brand. */
export function sourceNames(t: T, os: string, sources: CgmSourceKind[]): string {
  return sources
    .map((s) => (s === "nightscout" ? t("cgmSource.nightscout") : t(healthStoreLabelKey(os))))
    .join(", ");
}

/**
 * "Data: CGM (Apple Health, Nightscout) · coverage 86 % · 42 manual readings" or
 * "Data: all readings, sensor and manual · CGM coverage 12 %"; null when no sensor
 * reading exists, so a profile that never had a sensor sees no such line. Below
 * half coverage the figures come from the WHOLE set (sensor and hand-entered
 * together, see selectGlucoseBasis), so the label names that set, not the
 * hand-entered readings alone.
 */
export function basisLine(t: T, os: string, b: BasisSummary): string | null {
  if (b.cgmCoverage == null) return null;
  const coverage = pct(b.cgmCoverage);
  if (b.basis === "cgm") {
    const sources = sourceNames(t, os, b.cgmSources);
    return b.manualReadings > 0
      ? t("cgmInsights.basisCgmManual", { sources, pct: coverage, n: b.manualReadings })
      : t("cgmInsights.basisCgm", { sources, pct: coverage });
  }
  return t("cgmInsights.basisAll", { pct: coverage });
}

/** "7 days", or "1 day" for a single day. */
export function windowDaysText(t: T, n: number): string {
  return n === 1 ? t("insights.windowOneDay") : t("insights.windowDays", { n });
}

/** "In the last 14 days, 92 % CGM coverage". */
export function coverageLine(t: T, days: number, coveragePct: number): string {
  // French sets a (non-breaking) space before a colon.
  const colon = getActiveLang() === "fr" ? "\u00A0:" : ":";
  if (days <= 1) return `${t("cgmInsights.coverage")}${colon} ${pct(coveragePct)}`;
  return t("cgmInsights.coverageLine", { days, pct: pct(coveragePct) });
}
