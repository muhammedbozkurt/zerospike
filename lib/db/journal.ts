import { getDb } from "./index";
import type {
  BolusKind,
  InjectionSite,
  InsulinType,
  Lang,
  LogTag,
  PeriodTag,
  SitePoint,
} from "./types";
import { asSitePoint, foodName, parseBolusKind, parseTags } from "./types";
import type { Food } from "./types";
import type { DateRange } from "../insights";
import { journalFeedArgs, journalFeedSql } from "./journalSql";

export interface GlucoseEntry {
  kind: "glucose";
  id: string;
  logged_at: string;
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  source: string;
  tags: LogTag[];
  /** Apple Health sample this reading is mirrored to, when the user opted in.
   *  Carried on the feed so an edit can re-mirror without a second query. */
  healthkit_uuid: string | null;
}

export interface MealEntry {
  kind: "meal";
  id: string;
  logged_at: string;
  food_id: string | null;
  /** The reading this meal is attached to, if any (see lib/mealResponse.ts). */
  sugar_log_id: string | null;
  display_name: string;
  /** Joined food category (lib/db/categories.ts), null for custom-named meals. */
  category: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  insulin_dose_units: number;
  photo_uri_local: string | null;
  personal_note: string | null;
  tags: LogTag[];
}

export interface InjectionEntry {
  kind: "injection";
  id: string;
  logged_at: string;
  /** Null when no region was recorded (an auto-written mealtime bolus). */
  site: InjectionSite | null;
  site_point: SitePoint | null;
  dose_units: number | null;
  insulin_type: InsulinType | null;
  /** Meal vs correction (schema v15). Always null when insulin_type isn't 'bolus'. */
  bolus_kind: BolusKind | null;
  note: string | null;
  /** 'manual', or 'calculator' for the bolus row a meal log wrote for you. */
  source: string;
  tags: LogTag[];
  /** Which product this entry actually used (schema v22, see
   *  ../insulinCatalog). This row's OWN copy, independent of the profile's
   *  current basal_insulin_id / bolus_insulin_id. */
  insulin_product_id: string | null;
  insulin_product_other: string | null;
}

/**
 * An oral medication entry (schema v16). `logged_at` is the ISO instant the
 * union converts med_logs.taken_at into, so every kind in the feed speaks the
 * same time format; the epoch value the row is stored under is Date.parse() of
 * it, exactly. Carries no tags: the table has no tags column.
 */
export interface MedEntry {
  kind: "med";
  id: string;
  logged_at: string;
  /** What the user called it, or null (an unnamed entry is still an entry). */
  name: string | null;
  note: string | null;
}

export type JournalEntry = GlucoseEntry | MealEntry | InjectionEntry | MedEntry;

/** One row of the union in ./journalSql: the columns of the table it came from. */
interface FeedRow {
  kind: "glucose" | "meal" | "injection" | "med";
  id: string;
  logged_at: string;
  tags: string | null;
  // glucose
  glucose_level_mgdl: number | null;
  period_tag: PeriodTag | null;
  source: string | null;
  healthkit_uuid: string | null;
  // meal (+ joined food name columns)
  food_id: string | null;
  sugar_log_id: string | null;
  custom_food_name: string | null;
  portion_g: number | null;
  calculated_carbs_g: number | null;
  insulin_dose_units: number | null;
  photo_uri_local: string | null;
  personal_note: string | null;
  name_tr: string | null;
  name_en: string | null;
  name_de: string | null;
  name_es: string | null;
  name_fr: string | null;
  name_it: string | null;
  name_pt: string | null;
  name_ar: string | null;
  name_ja: string | null;
  category: string | null;
  // injection
  site: InjectionSite | null;
  site_point: number | null;
  dose_units: number | null;
  insulin_type: InsulinType | null;
  bolus_kind: string | null;
  note: string | null;
  // med
  med_name: string | null;
  // injection (schema v22)
  insulin_product_id: string | null;
  insulin_product_other: string | null;
}

/**
 * Unified chronological feed of a profile's readings, meals, injections and
 * medication entries. Meal names are resolved to the active language (or the
 * custom name).
 *
 * ONE query, not four (see ./journalSql). Limiting each table separately meant
 * `limit` rows of every kind were read to display `limit` rows of the merged feed
 * (300 became up to 900), and the rows beyond the merged cut were fetched only to
 * be thrown away. The UNION is ordered and limited by SQLite, so `limit` means
 * what it says.
 *
 * `range` filters in SQL as well. Without it, an old date range had to be found
 * inside whatever the newest `limit` rows happened to cover, so a report or an
 * export of an early month silently came back short.
 *
 * `options.excludeCalculatorInjections` hides the auto-written mealtime-bolus
 * row (source = 'calculator') from the injection branch. Defaults to false -
 * IOB, the report and every export read the unfiltered feed and must keep
 * seeing that row; only the dashboard's own journal list opts in, to stop
 * showing it as a duplicate line under the meal that wrote it.
 */
export async function getJournal(
  profileId: string,
  lang: Lang,
  limit = 300,
  range?: DateRange,
  options?: { excludeCalculatorInjections?: boolean }
): Promise<JournalEntry[]> {
  const db = await getDb();

  // The statement and its bound values live in ./journalSql (dependency-free), so
  // scripts/journal.test.ts runs the real query rather than a copy of it.
  const rows = await db.getAllAsync<FeedRow>(
    journalFeedSql(range != null, options?.excludeCalculatorInjections ?? false),
    journalFeedArgs(profileId, limit, range)
  );

  return rows.map((r) => {
    if (r.kind === "glucose") {
      const entry: GlucoseEntry = {
        kind: "glucose",
        id: r.id,
        logged_at: r.logged_at,
        glucose_level_mgdl: r.glucose_level_mgdl ?? 0,
        period_tag: r.period_tag ?? "manual",
        source: r.source ?? "manual",
        tags: parseTags(r.tags),
        healthkit_uuid: r.healthkit_uuid,
      };
      return entry;
    }
    if (r.kind === "injection") {
      const entry: InjectionEntry = {
        kind: "injection",
        id: r.id,
        logged_at: r.logged_at,
        site: r.site,
        site_point: asSitePoint(r.site_point),
        dose_units: r.dose_units,
        insulin_type: r.insulin_type,
        bolus_kind: parseBolusKind(r.bolus_kind),
        note: r.note,
        source: r.source ?? "manual",
        tags: parseTags(r.tags),
        insulin_product_id: r.insulin_product_id,
        insulin_product_other: r.insulin_product_other,
      };
      return entry;
    }
    if (r.kind === "med") {
      const entry: MedEntry = {
        kind: "med",
        id: r.id,
        logged_at: r.logged_at,
        name: r.med_name,
        note: r.note,
      };
      return entry;
    }
    let display = r.custom_food_name ?? "";
    if (!display && r.name_tr) {
      display = foodName(
        {
          name_tr: r.name_tr,
          name_en: r.name_en ?? "",
          name_de: r.name_de ?? "",
          name_es: r.name_es ?? "",
          name_fr: r.name_fr ?? "",
          name_it: r.name_it,
          name_pt: r.name_pt,
          name_ar: r.name_ar,
          name_ja: r.name_ja,
        } as Food,
        lang
      );
    }
    const entry: MealEntry = {
      kind: "meal",
      id: r.id,
      logged_at: r.logged_at,
      food_id: r.food_id,
      sugar_log_id: r.sugar_log_id,
      display_name: display || "-",
      category: r.category,
      portion_g: r.portion_g ?? 0,
      calculated_carbs_g: r.calculated_carbs_g ?? 0,
      insulin_dose_units: r.insulin_dose_units ?? 0,
      photo_uri_local: r.photo_uri_local,
      personal_note: r.personal_note,
      tags: parseTags(r.tags),
    };
    return entry;
  });
}
