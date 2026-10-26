/**
 * Which Health source apps are sensors, decided from the readings themselves.
 * Pure and dependency-free so scripts/cgmDetect.test.ts runs it under Node.
 *
 * Detection only MARKS rows (is_cgm); it never changes the profile's mode. A
 * hand-typed reading is never a sensor reading, whatever the cadence.
 */

export const CGM_CADENCE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A source with at least this many readings in 24 h... */
export const CGM_CADENCE_MIN_SAMPLES = 36;
/** ...whose consecutive gaps have a median of at most this, is a sensor. */
export const CGM_CADENCE_MAX_MEDIAN_GAP_MS = 6 * 60 * 1000;
/** With a supporting hint (name, specimen), a thinner stream is enough. */
export const CGM_HINT_MIN_SAMPLES = 12;

/** Health Connect BloodGlucoseRecord.specimenSource values. */
export const HC_SPECIMEN_INTERSTITIAL_FLUID = 1;
export const HC_SPECIMEN_CAPILLARY_BLOOD = 2;
export const HC_SPECIMEN_WHOLE_BLOOD = 6;
/** Health Connect Metadata.recordingMethod values. */
export const HC_RECORDING_MANUAL_ENTRY = 3;

/** What one imported reading tells the detector. */
export interface DetectSample {
  atMs: number;
  /** HealthKit HKWasUserEntered, or Health Connect recordingMethod MANUAL_ENTRY. */
  userEntered?: boolean;
  /** Health Connect specimenSource (0 unknown ... 6 whole blood). */
  specimenSource?: number | null;
  /** Health Connect recordingMethod. Weak: also used when it could not be told. */
  recordingMethod?: number | null;
}

export type CgmOverride = "auto" | "cgm" | "not_cgm";

export type CgmDetectReason =
  | "override"
  | "manual"
  | "cadence"
  | "hint"
  | "known"
  | "none";

export interface CgmDetectResult {
  isCgm: boolean;
  reason: CgmDetectReason;
}

export interface CgmDetectContext {
  /** Source app / package name (HKSource bundle id, Health Connect dataOrigin). */
  sourceApp?: string | null;
  /** Free text from the device (name, manufacturer, model). */
  deviceText?: string | null;
  /** A user override for this source; nothing in this card stores one. */
  override?: CgmOverride | null;
  /** This source already has sensor rows in the recent past: keep marking them. */
  knownCgm?: boolean;
}

/** Substrings of a lower-cased app / device name that point at a sensor. A hint
 *  only, never proof: ids are not verified and xDrip4iOS gets a per-user id. */
export const CGM_NAME_HINTS: readonly string[] = [
  "dexcom",
  "libre",
  "abbott",
  "xdrip",
  "eversense",
  "senseonics",
  "medtronic",
  "minimed",
  "juggluco",
  "glucodata",
  "dexdrip",
];

export function nameHintsCgm(...texts: (string | null | undefined)[]): boolean {
  for (const text of texts) {
    if (!text) continue;
    const lower = text.toLowerCase();
    if (CGM_NAME_HINTS.some((hint) => lower.includes(hint))) return true;
  }
  return false;
}

/** Median of the gaps between consecutive times (input sorted ascending). */
export function medianGapMs(sortedMs: readonly number[]): number {
  if (sortedMs.length < 2) return Infinity;
  const gaps: number[] = new Array(sortedMs.length - 1);
  for (let i = 1; i < sortedMs.length; i++) gaps[i - 1] = sortedMs[i] - sortedMs[i - 1];
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/** The most readings that fall inside any 24 h window (input sorted). */
export function maxReadingsIn24h(sortedMs: readonly number[]): number {
  let best = 0;
  let left = 0;
  for (let right = 0; right < sortedMs.length; right++) {
    while (sortedMs[right] - sortedMs[left] > CGM_CADENCE_WINDOW_MS) left++;
    if (right - left + 1 > best) best = right - left + 1;
  }
  return best;
}

/**
 * True when some 24 h window holds enough readings, spaced like a sensor's.
 * Windows ending at every 12th reading (plus the last) are tried: the limits
 * are loose enough that no qualifying window is missed, and a 1-minute stream
 * stays cheap.
 */
export function hasSensorCadence(sortedMs: readonly number[]): boolean {
  const n = sortedMs.length;
  if (n < CGM_CADENCE_MIN_SAMPLES) return false;
  let left = 0;
  for (let right = 0; right < n; right++) {
    while (sortedMs[right] - sortedMs[left] > CGM_CADENCE_WINDOW_MS) left++;
    const size = right - left + 1;
    if (size < CGM_CADENCE_MIN_SAMPLES) continue;
    if (right % 12 !== 0 && right !== n - 1) continue;
    if (medianGapMs(sortedMs.slice(left, right + 1)) <= CGM_CADENCE_MAX_MEDIAN_GAP_MS) {
      return true;
    }
  }
  return false;
}

/**
 * Decides whether the readings of ONE source app are a sensor stream.
 *
 *  - an explicit override wins;
 *  - hand-typed readings (user entered / MANUAL_ENTRY) and finger-stick specimens
 *    never count toward a sensor;
 *  - the cadence rule alone is enough: 36 readings in 24 h with a median gap of
 *    6 minutes or less;
 *  - a name hint or an interstitial-fluid specimen needs only 12 readings in 24 h
 *    (a first sync with little data);
 *  - a source that already produced sensor rows lately stays a sensor, so a few
 *    readings after a sensor change are not demoted.
 */
export function detectCgmSource(
  samples: readonly DetectSample[],
  context: CgmDetectContext = {}
): CgmDetectResult {
  if (context.override === "cgm") return { isCgm: true, reason: "override" };
  if (context.override === "not_cgm") return { isCgm: false, reason: "override" };

  const times: number[] = [];
  let interstitial = false;
  for (const s of samples) {
    if (!Number.isFinite(s.atMs)) continue;
    if (s.userEntered === true || s.recordingMethod === HC_RECORDING_MANUAL_ENTRY) continue;
    if (
      s.specimenSource === HC_SPECIMEN_CAPILLARY_BLOOD ||
      s.specimenSource === HC_SPECIMEN_WHOLE_BLOOD
    ) {
      continue;
    }
    if (s.specimenSource === HC_SPECIMEN_INTERSTITIAL_FLUID) interstitial = true;
    times.push(s.atMs);
  }
  if (times.length === 0) {
    return { isCgm: false, reason: samples.length > 0 ? "manual" : "none" };
  }
  times.sort((a, b) => a - b);

  if (hasSensorCadence(times)) return { isCgm: true, reason: "cadence" };

  const hinted = interstitial || nameHintsCgm(context.sourceApp, context.deviceText);
  if (hinted && maxReadingsIn24h(times) >= CGM_HINT_MIN_SAMPLES) {
    return { isCgm: true, reason: "hint" };
  }
  if (context.knownCgm) return { isCgm: true, reason: "known" };
  return { isCgm: false, reason: "none" };
}
