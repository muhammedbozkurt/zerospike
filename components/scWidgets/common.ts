import { GLUCOSE_RICH, THEME } from "../../lib/theme/tokens";
import { VERY_HIGH_MGDL } from "../../lib/glucose";
import type { LiveData } from "../../lib/services/liveData";
import { withAlpha } from "../rich/GlassCard";

/**
 * W1a screenshot-only widget mock scene. Shared colours and helpers so the
 * lock-screen, Dynamic Island, home-screen and mini-widget replicas (built for
 * the ASO capture, see app/sc-widgets.tsx) all read from the SAME values the
 * real targets/widget/*.swift and lib/services/androidWidget.ts already use,
 * instead of a third hand-copied palette drifting out of step with either.
 */

/** Mirrors SmallPalette in targets/widget/SmallWidgets.swift and TILE_INK in
 *  lib/services/androidWidget.ts: one identity hue per logging flow. */
export const TILE_INK = { // theme-ok: getters read the live palette
  get glucose() {
    return THEME.accent;
  },
  get meal() {
    return GLUCOSE_RICH.target;
  },
  get injection() {
    return THEME.violet;
  },
  get med() {
    return THEME.caution;
  },
  get countdown() {
    return THEME.caution;
  },
};

/** Colours a reading against the profile's own band, same ramp as
 *  androidWidget.ts's readingColor / GlucoseColor.forReading in index.swift. */
export function readingColor(
  mgdl: number | null | undefined,
  band: LiveData["band"] | undefined
): string {
  if (mgdl == null) return THEME.muted;
  const hypo = band?.hypo ?? 70;
  const high = band?.high ?? 180;
  const veryHigh = band?.veryHigh ?? VERY_HIGH_MGDL;
  if (mgdl < hypo) return GLUCOSE_RICH.low;
  if (mgdl >= veryHigh) return GLUCOSE_RICH.veryHigh;
  if (mgdl <= high) return GLUCOSE_RICH.target;
  if (mgdl <= high * 1.25) return GLUCOSE_RICH.high;
  return GLUCOSE_RICH.wellAbove;
}

/** The next reminder's SF Symbol twin, mirroring nextReminderGlyph in
 *  targets/widget/LiveData.swift: an alarm-mode reminder draws the alarm
 *  glyph, everything else the plain bell. */
export function nextReminderIcon(
  mode: LiveData["nextReminderMode"]
): "alarm-outline" | "notifications-outline" {
  return mode === "alarm" ? "alarm-outline" : "notifications-outline";
}

export function unitLabel(unit: LiveData["unit"] | undefined): string {
  return unit === "mmol" ? "mmol/L" : "mg/dL";
}

/** `Text(due, style: .timer)` twin: digit-only, locale-neutral countdown
 *  (H:MM:SS, or MM:SS under an hour), matching what the real countdown pill
 *  and the Live Activity actually print. */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** JS twin of smallElapsedLabel in targets/widget/SmallWidgets.swift: "6 sa 23
 *  dk once", hand-composed from the app's own labels so it never depends on a
 *  device's system language. `null` when the snapshot carries no reading or
 *  no elapsed-time labels yet (an older snapshot). */
export function elapsedLabel(data: LiveData | null, now: number): string | null {
  const at = data?.lastGlucoseAt;
  const labels = data?.labels;
  if (at == null || !labels?.hourShort || !labels?.minuteShort || !labels?.agoTemplate) return null;
  const totalMinutes = Math.max(0, Math.floor((now - at) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const duration = hours > 0 ? `${hours} ${labels.hourShort} ${minutes} ${labels.minuteShort}` : `${minutes} ${labels.minuteShort}`;
  return labels.agoTemplate.replace("{{t}}", duration);
}

/** Ink at an alpha: the translucent fills and rules of every scene, theme-following. */
export function inkA(alpha: number): string {
  return withAlpha(THEME.text, alpha);
}
