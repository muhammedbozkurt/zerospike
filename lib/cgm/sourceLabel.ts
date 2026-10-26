/**
 * Generic source names for a reading: never a device or app brand, only the
 * kind of source. Dependency-free; the screens translate the keys.
 */

export type SourceBadgeKind = "cgm" | "nightscout" | "health";

export const SOURCE_LABEL_KEY: Record<SourceBadgeKind, string> = {
  cgm: "cgmSource.cgm",
  nightscout: "cgmSource.nightscout",
  health: "cgmSource.health",
};

/** Manual readings get no badge. */
export function sourceBadgeKind(
  source: string | null | undefined,
  isCgm: boolean | number | null | undefined
): SourceBadgeKind | null {
  if (source === "nightscout") return "nightscout";
  if (isCgm === true || isCgm === 1) return "cgm";
  if (source === "health") return "health";
  return null;
}

/** The health store this platform reads from, as an existing translation key. */
export function healthStoreLabelKey(os: string): string {
  return os === "android" ? "settings.healthSectionAndroid" : "settings.healthSection";
}
