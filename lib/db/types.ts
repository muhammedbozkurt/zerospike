export type Lang =
  | "tr"
  | "en"
  | "de"
  | "es"
  | "fr"
  | "it"
  | "pt"
  | "ar"
  | "ja";

/** Time-of-day meal slots that drive the active carb ratio. */
export type MealSlot = "breakfast" | "lunch" | "dinner";

export type PeriodTag =
  | "fasting"
  | "pre_meal"
  | "post_meal_2h"
  | "bedtime"
  | "manual";

/** Blood-glucose display unit. Storage is always mg/dL; this only affects how
 *  values are shown and entered. */
export type GlucoseUnit = "mgdl" | "mmol";

/** Optional context labels attachable to any log (schema v5). Stored as a JSON
 *  array of these keys; labels are resolved from i18n (`tags.<key>`). */
export type LogTag =
  | "sport"
  | "illness"
  | "stress"
  | "travel"
  | "alcohol"
  | "other";

/** Canonical order (chip display + serialization). */
export const LOG_TAGS: LogTag[] = [
  "sport",
  "illness",
  "stress",
  "travel",
  "alcohol",
  "other",
];

/** Safe parse of a stored tags JSON string → known tags only, canonical order. */
export function parseTags(json: string | null | undefined): LogTag[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    const set = new Set(arr.filter((x) => (LOG_TAGS as string[]).includes(x)));
    return LOG_TAGS.filter((tag) => set.has(tag));
  } catch {
    return [];
  }
}

/** Serializes tags → JSON string, dropping unknowns/dupes, canonical order. */
export function serializeTags(
  tags: readonly string[] | null | undefined
): string {
  if (!tags || tags.length === 0) return "[]";
  const set = new Set(tags.filter((x) => (LOG_TAGS as string[]).includes(x)));
  return JSON.stringify(LOG_TAGS.filter((tag) => set.has(tag)));
}

/** Diabetes type, collected in onboarding. Tone only: it NEVER enters any
 *  calculation (regulation rule). Kept on the profile so the copy the user reads
 *  can match what they told us. */
export type DiabetesType = "type1" | "type2" | "gestational" | "prediabetes" | "unknown" | "none";

/** Which insulin the user actually takes. Drives which surfaces are shown:
 *  "none" hides the whole injection/bolus apparatus. */
export type InsulinMode = "basal" | "bolus" | "both" | "none";

export interface UserProfile {
  id: string; // UUID
  name: string;
  insulin_sensitivity_factor: number; // mg/dL dropped per 1 unit (ISF)
  carb_ratio_breakfast: number; // g carb per 1 unit
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  /** Target RANGE, not a single ceiling (ADA states targets as ranges). */
  target_fasting_min: number; // default 80
  target_fasting_max: number; // default 100
  target_postmeal_min: number; // default 80
  target_postmeal_max: number; // default 140
  /** The user's own low threshold in mg/dL (default 70, ADA level-1). */
  hypo_threshold_mgdl: number;
  daily_carb_target_g: number; // upper end of the daily carb range
  daily_carb_target_min_g: number; // lower end (default 0.8 x max)
  glucose_unit: GlucoseUnit; // display/entry unit (storage stays mg/dL)
  diabetes_type: DiabetesType; // tone only, never a calculation input
  insulin_mode: InsulinMode; // which insulin surfaces are shown
  /** 1 when the user entered/confirmed their own ICR+ISF, 0 while the app is
   *  still running on the "not sure" defaults. Surfaces a neutral notice on the
   *  calculator so a default is never mistaken for a personal ratio. */
  ratios_confirmed: number; // 0 | 1
  /** Insulin product catalog (schema v15, lib/insulinCatalog.ts). Null while the
   *  profile has not picked a product / entered a daily basal dose; the app falls
   *  back to the generic profile (bolusProfileFor / basalProfileFor) either way. */
  basal_daily_units: number | null;
  basal_insulin_id: string | null;
  bolus_insulin_id: string | null;
  /** 1 when the oral-medication surfaces are shown for this profile (schema
   *  v16). Presentation flag: it decides what the user sees and never enters a
   *  calculation - no dose, no insulin figure and no metric reads it. */
  oral_meds_enabled: number; // 0 | 1
  created_at: string;
}

export interface Food {
  id: string; // UUID
  name_tr: string;
  name_en: string;
  name_de: string;
  name_es: string;
  name_fr: string;
  aliases_json: string; // JSON string[] of synonyms
  category: string; // see lib/db/categories.ts
  barcode: string | null;
  carb_100g: number;
  glycemic_index: number;
  glycemic_load: number;
  portion_size_g: number;
  brand_name: string | null;
  custom_notes: string | null;
  is_custom: number; // 0 | 1
  /** null for the seeded catalog and for the user's own foods; 'off' for a
   *  barcode result cached from Open Food Facts. */
  source: string | null;
  created_at: string;
}

export interface SugarLog {
  id: string;
  profile_id: string;
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  source: string; // 'manual' | 'health'
  logged_at: string;
  tags: LogTag[];
  /** HealthKit sample UUID when this manual reading was mirrored to Apple Health
   *  (schema v10). NULL for readings that were never written to Health. */
  healthkit_uuid: string | null;
}

export interface MealLog {
  id: string;
  profile_id: string;
  sugar_log_id: string | null;
  food_id: string | null;
  custom_food_name: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  insulin_dose_units: number;
  photo_uri_local: string | null;
  personal_note: string | null;
  logged_at: string;
  tags: LogTag[];
  /** The meal template this row was logged from (schema v13), or null. Pure
   *  provenance and NOT a foreign key: the record outlives the template being
   *  renamed, re-itemised or deleted. Also the flag that keeps a template row out
   *  of the "recent meals" chips, which cannot re-log one faithfully. */
  meal_template_id: string | null;
}

export interface Favorite {
  id: string;
  profile_id: string;
  food_id: string;
}

/* ── Meal templates (schema v13) ───────────────────────────────────────────
 *
 * A template is a RECIPE the user wrote down: the meal they repeat, named once
 * and logged with one tap. It is never generated, never suggested and never
 * commented on; the app only stores it, orders it and repeats it.
 *
 * Logging one writes a SINGLE meal_logs row (see lib/db/mealTemplates.ts), and
 * the read rule for its carbs lives in exactly one place (lib/mealTemplates.ts).
 */
export interface MealTemplate {
  id: string;
  profile_id: string;
  name: string;
  /** ORDERING signal only, and nullable (a snack template has none). It never
   *  enters a dose: the carb ratio always comes from the clock, because a ratio
   *  describes the time of day, not the name of a recipe. */
  slot: MealSlot | null;
  sort_order: number;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

export interface MealTemplateItem {
  id: string;
  template_id: string;
  /** The LIVE catalogue link, nulled if that food is deleted. */
  food_id: string | null;
  /** What the item was called when it was added; the fallback once food_id is
   *  gone, and the only name a typed-name item ever had. */
  name_snapshot: string;
  /** The carb value at the time it was added; insurance against losing the
   *  catalogue row, never preferred over the live one. */
  carb_100g_snapshot: number;
  portion_g: number;
  /** A carb total stored outright, for an item that has no carb_100g to derive
   *  from (built out of a typed-name meal). Wins over both values above. */
  carbs_g_fixed: number | null;
  sort_order: number;
}

/** Returns the food name in the active language, with graceful fallback. */
export function foodName(food: Food, lang: Lang): string {
  switch (lang) {
    case "en":
      return food.name_en || food.name_tr;
    case "de":
      return food.name_de || food.name_en || food.name_tr;
    case "es":
      return food.name_es || food.name_en || food.name_tr;
    case "fr":
      return food.name_fr || food.name_en || food.name_tr;
    case "tr":
      return food.name_tr || food.name_en;
    // it/pt/ar/ja have no name column in the catalogue: English is the neutral
    // fallback, never Turkish (which the old default branch would have shown).
    default:
      return food.name_en || food.name_tr;
  }
}

export function parseAliases(food: Food): string[] {
  try {
    const arr = JSON.parse(food.aliases_json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/* ── Injection-site logging ────────────────────────────────────────────────
 *
 * Injections are logged directly against an insulin type + optional dose. Stock
 * tracking was removed in R5 and every trace of it (table, column, types, i18n)
 * was dropped in the v8 migration, so nothing dormant is left behind. */

/** Basal (long-acting) vs bolus (mealtime) insulin. */
export type InsulinType = "basal" | "bolus";

/** What a bolus injection was for (schema v15). Always null on a basal row. */
export type BolusKind = "meal" | "correction";

export const BOLUS_KINDS: readonly BolusKind[] = ["meal", "correction"] as const;

/** Narrows any stored value to a BolusKind, or null when it is not one. */
export function parseBolusKind(v: unknown): BolusKind | null {
  return v === "meal" || v === "correction" ? v : null;
}

/**
 * Injection sites (schema v9). The abdomen is split into four quadrants to match
 * the FITTER rotation guidance and the R7.1 body map. The pre-v9 general
 * `abdomen_left` / `abdomen_right` values remain VALID so migrated rows are never
 * rewritten; they are shown on the map as a general abdomen total.
 */
export type InjectionSite =
  // Legacy general abdomen (pre-v9 rows keep these).
  | "abdomen_left"
  | "abdomen_right"
  // v9 abdomen quadrants (front).
  | "abdomen_left_upper"
  | "abdomen_right_upper"
  | "abdomen_left_lower"
  | "abdomen_right_lower"
  | "thigh_left"
  | "thigh_right"
  | "arm_left"
  | "arm_right"
  // Buttocks (back view).
  | "buttock_left"
  | "buttock_right";

/**
 * Every valid site, in canonical order. Drives usage bucketing (so no logged
 * site, legacy or new, is ever hidden from the heat map).
 */
export const INJECTION_SITES: InjectionSite[] = [
  "abdomen_left_upper",
  "abdomen_right_upper",
  "abdomen_left_lower",
  "abdomen_right_lower",
  "thigh_left",
  "thigh_right",
  "arm_left",
  "arm_right",
  "buttock_left",
  "buttock_right",
  "abdomen_left",
  "abdomen_right",
];

/** Sites retired by the anatomically-corrected map. Kept VALID in INJECTION_SITES so
 *  migrated rows are never lost or hidden, but not offered for new selection: the old
 *  abdomen quadrants (replaced by a left/right row each side of the navel). */
export const RETIRED_SITES: InjectionSite[] = [
  "abdomen_left_upper",
  "abdomen_right_upper",
  "abdomen_left_lower",
  "abdomen_right_lower",
];

/**
 * The sites the map offers for SELECTION and that rotation considers: the abdomen as
 * a single row of points on each side of the navel (left / right), the outer thighs
 * and back-outer upper arms (a vertical line each), and the upper-outer buttocks.
 */
export const SELECTABLE_SITES: InjectionSite[] = [
  "abdomen_left",
  "abdomen_right",
  "thigh_left",
  "thigh_right",
  "arm_left",
  "arm_right",
  "buttock_left",
  "buttock_right",
];

/** True for a region the map no longer offers for a new entry (see RETIRED_SITES). */
export function isRetiredSite(site: InjectionSite): boolean {
  return RETIRED_SITES.includes(site);
}

/**
 * The selectable region a stored site belongs to. The four retired v9 quadrants
 * sit on the same side of the navel as the left/right abdomen rows that replaced
 * them, so their history still describes that side. Used by the rotation helpers:
 * a side injected yesterday under its old quadrant name must not read as
 * untouched. Every other site maps to itself.
 */
export function canonicalSite(site: InjectionSite): InjectionSite {
  switch (site) {
    case "abdomen_left_upper":
    case "abdomen_left_lower":
      return "abdomen_left";
    case "abdomen_right_upper":
    case "abdomen_right_lower":
      return "abdomen_right";
    default:
      return site;
  }
}

/**
 * The four rotation points inside one region (schema v8). Following the FITTER
 * quarter/rotation model, a region is split into a 2x2 grid and the user marks
 * the actual point used, not just the region:
 *
 *   1 = upper outer   2 = upper inner
 *   3 = lower outer   4 = lower inner
 *
 * Rows logged before v8 carry null and count toward the region total only.
 */
export type SitePoint = 1 | 2 | 3 | 4;

export const SITE_POINTS: SitePoint[] = [1, 2, 3, 4];

/** Row/column of a point in its region's 2x2 grid (for map + sheet layout). */
export function pointGrid(point: SitePoint): { row: 0 | 1; col: 0 | 1 } {
  return {
    row: point <= 2 ? 0 : 1,
    col: point % 2 === 1 ? 0 : 1,
  };
}

/** Narrows any stored value to a SitePoint, or null when it is not one. */
export function asSitePoint(value: unknown): SitePoint | null {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

export interface Injection {
  id: string; // UUID
  profile_id: string;
  /** Null when no region was recorded (schema v11): the dose calculator writes a
   *  mealtime bolus without ever asking for one, and an unspecified region is
   *  honest where a guessed one would silently shape the rotation picture. */
  site: InjectionSite | null;
  /** Which of the region's four rotation points (v8). Null on older rows. */
  site_point: SitePoint | null;
  dose_units: number | null;
  insulin_type: InsulinType | null;
  /** Meal vs correction (schema v15). Always null when insulin_type isn't 'bolus'. */
  bolus_kind: BolusKind | null;
  meal_log_id: string | null; // FK → meal_logs (SET NULL on meal delete)
  note: string | null;
  /** Where the row came from: 'manual' by default, 'calculator' for the bolus
   *  row the dose calculator writes alongside a meal (so the injection tab can
   *  show it as already-logged instead of inviting a duplicate entry). */
  source: string;
  logged_at: string;
  tags: LogTag[];
}

/* ── Oral medication logging (schema v16) ──────────────────────────────────
 *
 * A diary line, nothing more: the user writes down that they took something and
 * when. The app stores no dose, no schedule and no substance list of its own, so
 * it can neither tell anyone what to take nor claim anything about what they did.
 */

export interface MedLog {
  id: string;
  profile_id: string;
  /** Epoch MILLISECONDS, not the ISO text the older log tables carry (see
   *  ./v16Sql). The journal feed converts it so one union still sorts. */
  taken_at: number;
  /** What the user called it, or null: an entry with no name still records that
   *  something was taken at a time. */
  name: string | null;
  note: string | null;
  /** Epoch milliseconds, like taken_at. When the row was written, which is not
   *  the same as when the medication was taken (a late entry backdates the
   *  latter and never the former). */
  created_at: number;
}

/* ── Reminders registry (schema v17) ───────────────────────────────────────
 *
 * One table backing every scheduled local reminder the app manages: the three
 * that already existed (basal, oral medication, glucose) plus any number of
 * user-defined custom ones. Device-level, like NotificationPrefs (no
 * profile_id): a reminder schedule follows the device owner's own day, not one
 * profile. Storage only - see lib/db/reminders.ts for the accessors and
 * lib/services/notifications.ts (applyReminders) for what turns a row into an
 * actual OS notification.
 */

export type ReminderType = "glucose" | "med" | "basal" | "custom";

export const REMINDER_TYPES: readonly ReminderType[] = [
  "glucose",
  "med",
  "basal",
  "custom",
] as const;

/** Narrows any stored value to a ReminderType, or null when it is not one. */
export function parseReminderType(v: unknown): ReminderType | null {
  return v === "glucose" || v === "med" || v === "basal" || v === "custom"
    ? v
    : null;
}

export interface Reminder {
  id: string;
  type: ReminderType;
  /** What a custom reminder is called; NULL for the three built-in types,
   *  whose copy comes from i18n (notifications.basalTitle etc). */
  label: string | null;
  /** "HH:MM", parsed the same way every other daily reminder in the app is
   *  (see parseHHMM in lib/services/notifications.ts). */
  time: string;
  enabled: number; // 0 | 1
  /** The user's own ordering; also what applyReminders schedules in. */
  sort: number;
  /** Epoch milliseconds, unlike the older log tables' ISO text: nothing here is
   *  ever range-queried against a reading or a meal. */
  created_at: number;
}
