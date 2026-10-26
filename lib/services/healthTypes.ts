import type { PeriodTag } from "../db/types";
import type { HealthWriteMeta } from "../healthMeta";

/**
 * Shared types + constants for the health-store provider layer (health.ts
 * facade + healthAppleKit.ts / healthConnect.ts / healthMock.ts providers).
 * Kept free of react-native / native imports so it can be imported from
 * anywhere without pulling in platform code.
 */

/** Our own app id, used to skip our OWN writes on import (loop guard).
 *  Same string on both platforms: iOS bundle id == Android package name. */
export const OWN_BUNDLE_ID = "com.greeneyeapp.zerospike";

/** How far back an iOS sync scans the health store (days). */
export const SYNC_WINDOW_DAYS = 90;
/** How far back an Android sync scans Health Connect (days). Health Connect
 *  only grants a 30-day look-back by default from the moment permission is
 *  granted; anything older needs READ_HEALTH_DATA_HISTORY, which widens the
 *  Play Store health-data declaration we are not making yet. */
export const ANDROID_SYNC_WINDOW_DAYS = 30;
/** Samples the one-shot read (readRecentGlucose) returns. The sync itself no
 *  longer stops here: it pages (readGlucosePage), so a sensor's 90 days fit. */
export const SYNC_MAX_SAMPLES = 300;
/** Samples per page of a paged read. */
export const IOS_GLUCOSE_PAGE_SIZE = 2000;
export const ANDROID_GLUCOSE_PAGE_SIZE = 1000;
/** Most samples one sync round reads. HealthKit continues from its anchor next
 *  round; Health Connect re-reads its (30 day) window, so its cap covers a
 *  1-minute sensor for the whole window. */
export const IOS_SYNC_ROUND_MAX_SAMPLES = 30_000;
export const ANDROID_SYNC_ROUND_MAX_SAMPLES = 60_000;

export interface GlucoseSample {
  value: number; // mg/dL
  date: string; // ISO timestamp
  period_tag: PeriodTag;
  /** The store's id for the sample (HealthKit uuid, Health Connect record id). */
  externalId?: string | null;
  /** The app that wrote it (bundle id / package name). */
  sourceApp?: string | null;
  /** Device / source name text, only used for sensor detection. */
  deviceText?: string | null;
  /** Typed by the user (HKWasUserEntered, MANUAL_ENTRY): never a sensor reading. */
  userEntered?: boolean;
  /** Health Connect specimenSource, when the store reports one. */
  specimenSource?: number | null;
  /** Health Connect recordingMethod, when the store reports one. */
  recordingMethod?: number | null;
}

/** One page of a paged glucose read. */
export interface GlucosePage {
  samples: GlucoseSample[];
  /** Ids the store reports as deleted since the cursor (HealthKit). */
  deletedIds: string[];
  /** Where the next read continues: a HealthKit anchor or a Health Connect
   *  page token. Persist it only after the page was imported. */
  cursor: string | null;
  hasMore: boolean;
}

export interface GlucosePageRequest {
  windowDays: number;
  cursor: string | null;
  pageSize: number;
}

/** Outcome of a sync so the UI can tell the user exactly what happened. */
export type SyncStatus = "ok" | "unavailable" | "denied" | "error";
export interface SyncResult {
  status: SyncStatus;
  /** newly inserted rows */
  inserted: number;
  /** samples read from the health store (0 -> nothing there / no permission) */
  read: number;
}

/** Where a sync was triggered from; stored with the last-sync record. */
export type HealthSyncSource = "foreground" | "background" | "manual";

/** Structured failure reason for the UI (the visible text is the caller's). */
export type HealthSyncError = "unavailable" | "denied" | "read_failed";

/** Per-profile record of the last sync attempt (AsyncStorage healthLastSync). */
export interface HealthLastSync {
  atIso: string;
  status: SyncStatus;
  inserted: number;
  read: number;
  source: HealthSyncSource;
  error: HealthSyncError | null;
}

/** Data types the app can write to the health store besides glucose. */
export type HealthWriteKind = "carbs" | "insulin";
export type InsulinKind = "bolus" | "basal";

export interface HealthSummary {
  /** Total exercise/active minutes over the window (null if unavailable). */
  activeMinutes: number | null;
  /** Insulin delivery split from the health store (iOS/DIY Loop only). */
  insulin: { basalUnits: number; bolusUnits: number; count: number } | null;
}

/** Three-state Health Connect availability, mirroring getSdkStatus(): the SDK
 *  is missing, the Health Connect provider app needs a Play update, or it is
 *  ready to use. iOS has no equivalent - callers only see this on Android. */
export type HealthConnectStatus = "unavailable" | "update_required" | "available";

/**
 * One health-store backend (Apple HealthKit / Android Health Connect / the
 * dev mock), selected at runtime by health.ts's provider picker. Every method
 * is safe to call directly - each implementation swallows its own native
 * errors and resolves a neutral value instead of throwing.
 */
export interface HealthProvider {
  isAvailable(): Promise<boolean>;
  requestReadPermissions(): Promise<boolean>;
  requestWritePermission(): Promise<boolean>;
  /** Read and write in ONE system dialog (the connect flow). `write` is the
   *  verified share outcome, never just "the dialog closed". */
  requestReadWritePermissions(): Promise<{ read: boolean; write: boolean }>;
  /** Current write grant, without prompting. */
  isWriteAuthorized(): Promise<boolean>;
  readRecentGlucose(windowDays: number, max: number): Promise<GlucoseSample[]>;
  /** Paged read for the sync. Rejects on a native failure: an empty page means
   *  "nothing new", never "the read failed". */
  readGlucosePage(request: GlucosePageRequest): Promise<GlucosePage>;
  /** `meta` makes the write idempotent per record id (see lib/healthMeta.ts);
   *  the returned id can equal an earlier one when the store upserted. */
  writeGlucose(mgdl: number, dateIso: string, meta?: HealthWriteMeta): Promise<string | null>;
  /** Throws when the store could not delete, so the caller can queue a retry. */
  deleteGlucose(id: string): Promise<void>;
  deleteGlucoseBatch(ids: string[]): Promise<void>;
  readSummary(windowDays: number): Promise<HealthSummary>;
  /** Grams of carbohydrate (HealthKit DietaryCarbohydrates / HC Nutrition). */
  writeCarbs(grams: number, dateIso: string, meta?: HealthWriteMeta): Promise<string | null>;
  /** iOS only (HealthKit InsulinDelivery); Health Connect has no insulin type
   *  and always resolves null. */
  writeInsulin(
    units: number,
    kind: InsulinKind,
    dateIso: string,
    meta?: HealthWriteMeta
  ): Promise<string | null>;
  /** Throw when the store could not delete, so the caller can queue a retry. */
  deleteCarbsBatch(ids: string[]): Promise<void>;
  deleteInsulinBatch(ids: string[]): Promise<void>;
  /** Share/write grant for one extra data type, requested at point of use. */
  requestKindWritePermission(kind: HealthWriteKind): Promise<boolean>;
  isKindWriteAuthorized(kind: HealthWriteKind): Promise<boolean>;
  /** Read grant WITHOUT prompting (background runs must never open a dialog).
   *  iOS cannot reveal read access, so it resolves true there. */
  isReadGranted(): Promise<boolean>;
  /** iOS: HKObserverQuery + enableBackgroundDelivery for blood glucose. The
   *  callback only signals "something changed"; false when unsupported. */
  startBackgroundObserver(onChange: () => void): Promise<boolean>;
  stopBackgroundObserver(): Promise<void>;
  /** Android: Health Connect READ_HEALTH_DATA_IN_BACKGROUND grant. */
  hasBackgroundReadPermission(): Promise<boolean>;
  requestBackgroundReadPermission(): Promise<boolean>;
  /** Android getChanges: did BloodGlucose change since the committed token?
   *  commit() advances the token and must only run after a successful import. */
  peekGlucoseChanges(): Promise<{
    changed: boolean;
    /** Health Connect ids deleted since the committed token. */
    deletedIds?: string[];
    commit(): Promise<void>;
  }>;
}
