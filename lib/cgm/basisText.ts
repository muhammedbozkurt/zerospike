import { pct } from "../format";
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
 * "Data: manual readings · CGM coverage 12 %"; null when no sensor reading
 * exists, so a profile that never had a sensor sees no such line.
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
  return t("cgmInsights.basisManual", { pct: coverage });
}

/** "In the last 14 days, 92 % CGM coverage". */
export function coverageLine(t: T, days: number, coveragePct: number): string {
  return t("cgmInsights.coverageLine", { days, pct: pct(coveragePct) });
}
