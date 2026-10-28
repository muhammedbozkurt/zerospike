import type {
  DiabetesType,
  GlucoseUnit,
  Injection,
  InjectionSite,
  LogTag,
  MealLog,
  PeriodTag,
  SugarLog,
  UserProfile,
} from "../db/types";
import {
  INJECTION_SITES,
  LOG_TAGS,
  SELECTABLE_SITES,
  canonicalSite,
} from "../db/types";
import { targetBandFor } from "../agpChart";
import { glucoseToDisplay, VERY_HIGH_MGDL } from "../glucose";
import { computeInsights, type DateRange } from "../insights";
import { insulinModeUsesInsulin } from "../insulinMode";
import { CGM_DETECT_MIN_READINGS } from "../db/cgmSql";

/**
 * Spike context packet v1: a 14-day summary computed ON THE DEVICE and sent
 * only while the user's separate context consent is on (spikeConsent.ts).
 *
 * What it can hold is closed by construction. Counts and averages, the target
 * range, meal tags and injection regions (both fixed app enums), and the shape
 * of the logging habit. It never holds a single reading, a timestamp, an
 * insulin amount, a free-text field or a Health / Health Connect record. The one
 * thing derived from sensor (CGM) rows is the optional `cgm` block: four numbers
 * (count, coverage, average, share in range), never a reading, a time series, a
 * source app, a device name or an external id. validateContextPacket() enforces that shape (and the 2 KB
 * ceiling) on every packet before it leaves the module, and the packet is
 * dropped, never trimmed, when it does not pass.
 */

export const SPIKE_CONTEXT_DAYS = 14;
/** The packet must stay strictly under this many bytes. */
export const SPIKE_CONTEXT_MAX_BYTES = 2048;

/** The four measurement periods the packet reports, in packet order. */
export const PERIOD_KEYS = ["fasting", "preMeal", "postMeal", "bedtime"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** period_tag values that map to a reported period. "manual" and "unset" are
 *  counted in `readings` but belong to no period. */
const PERIOD_KEY_BY_TAG: Partial<Record<PeriodTag, PeriodKey>> = {
  fasting: "fasting",
  pre_meal: "preMeal",
  post_meal_2h: "postMeal",
  bedtime: "bedtime",
};

/** Readings: only what the user typed. A Health import is `source = 'health'`
 *  and is excluded by this allowlist, so a new source value is excluded too. */
const USER_SUGAR_SOURCE = "manual";
/** Injections have no Health origin in the schema; these are the app's own
 *  writes (typed by hand, the calculator's bolus row, a confirmed reminder). */
const USER_INJECTION_SOURCES: ReadonlySet<string> = new Set([
  "manual",
  "calculator",
  "reminder",
]);

/** An average over fewer readings than this is withheld: the mean of a single
 *  reading is that reading, and single readings are not shared. The overall
 *  average is withheld as well when exactly one reading is left outside the
 *  period averages (see buildContextPacket). */
export const MIN_READINGS_FOR_AVERAGE = 2;

/** A sensor delivers a reading about every five minutes. */
export const CGM_READINGS_PER_DAY = 288;
/** Below this many sensor readings the CGM block is left out: a mean over a
 *  handful of readings is close to the readings themselves. */
export const MIN_CGM_READINGS = CGM_DETECT_MIN_READINGS;

export type SpikeTreatment = "insulin" | "pills" | "none";

export interface PeriodStat {
  n: number;
  avg: number | null;
}

/** What the CGM block is computed from: aggregates over the window's sensor
 *  rows (is_cgm = 1), computed by the database. No row ever leaves the query. */
export interface CgmAggregate {
  count: number;
  avgMgdl: number | null;
  inRangeCount: number;
}

export interface CgmStats {
  readings: number;
  /** Share of the readings a sensor delivers in the window (288 a day), 0 to 100. */
  coveragePct: number;
  avg: number;
  inRangePct: number;
}

export interface ContextPacket {
  v: 1;
  days: number;
  /** Unit of every glucose figure below (avg, target): the profile's own. */
  unit: GlucoseUnit;
  profile: {
    diabetes: DiabetesType;
    treatment: SpikeTreatment;
    target: { low: number; high: number };
  };
  glucose: {
    readings: number;
    avg: number | null;
    inRangePct: number | null;
    lowCount: number;
    highCount: number;
    perDay: number;
    byPeriod: Record<PeriodKey, PeriodStat>;
  };
  meals: {
    count: number;
    tags: Partial<Record<LogTag, number>>;
  };
  injections: {
    count: number;
    sites: Partial<Record<InjectionSite, number>>;
  };
  logging: {
    daysWithLogs: number;
    emptyPeriods: PeriodKey[];
    streakDays: number;
  };
  /** Present only when the window holds enough sensor readings. */
  cgm?: CgmStats;
}

/** The profile fields the packet reads. */
export type SpikeProfile = Pick<
  UserProfile,
  | "id"
  | "glucose_unit"
  | "diabetes_type"
  | "insulin_mode"
  | "oral_meds_enabled"
  | "target_fasting_min"
  | "target_postmeal_max"
>;

export interface ContextInput {
  profile: SpikeProfile;
  sugar: readonly SugarLog[];
  meals: readonly MealLog[];
  injections: readonly Injection[];
  /** Sensor aggregates for the window, when the profile has any. */
  cgm?: CgmAggregate | null;
  days?: number;
  now?: number;
}

function coveragePctOf(readings: number, days: number): number {
  return Math.min(100, Math.round((readings / (days * CGM_READINGS_PER_DAY)) * 100));
}

/** The CGM block, or undefined when the aggregate is missing, unusable or too thin. */
function cgmStatsOf(agg: CgmAggregate | null | undefined, days: number, unit: GlucoseUnit): CgmStats | undefined {
  if (!agg || !Number.isFinite(agg.count) || agg.count < MIN_CGM_READINGS) return undefined;
  if (agg.avgMgdl == null || !Number.isFinite(agg.avgMgdl) || !Number.isFinite(agg.inRangeCount)) return undefined;
  const readings = Math.floor(agg.count);
  const inRange = Math.min(readings, Math.max(0, agg.inRangeCount));
  return {
    readings,
    coveragePct: coveragePctOf(readings, days),
    avg: glucoseToDisplay(agg.avgMgdl, unit),
    inRangePct: Math.round((inRange / readings) * 100),
  };
}

function clampDays(days: number | undefined): number {
  const n = Math.floor(days ?? SPIKE_CONTEXT_DAYS);
  return Number.isFinite(n) ? Math.min(SPIKE_CONTEXT_DAYS, Math.max(1, n)) : SPIKE_CONTEXT_DAYS;
}

/** The last `days` LOCAL calendar days, today included, up to `now`. Calendar
 *  based so daysWithLogs can never exceed `days`. */
function windowRange(days: number, now: number): DateRange {
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - (days - 1));
  return { start: first.getTime(), end: now };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mean(ns: number[]): number | null {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
}

const DIABETES_TYPES: readonly string[] = [
  "type1",
  "type2",
  "gestational",
  "prediabetes",
  "none",
  "unknown",
];

function treatmentOf(profile: SpikeProfile): SpikeTreatment {
  if (insulinModeUsesInsulin(profile.insulin_mode)) return "insulin";
  return profile.oral_meds_enabled === 1 ? "pills" : "none";
}

/** Consecutive logged local days ending today, or yesterday when today is still
 *  empty (the same forgiving rule as the dashboard's streak). */
function streakOf(dayKeys: ReadonlySet<string>, now: number, limit: number): number {
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!dayKeys.has(dayKeyOf(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dayKeys.has(dayKeyOf(cursor))) return 0;
  }
  let count = 0;
  while (count < limit && dayKeys.has(dayKeyOf(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/**
 * Pure packet builder: the same inputs always give the same packet. Rows from
 * any source may be passed in; the Health-source exclusion and the window are
 * applied here, so a caller cannot leak one by forgetting a filter.
 */
export function buildContextPacket(input: ContextInput): ContextPacket {
  const days = clampDays(input.days);
  const now = input.now ?? Date.now();
  const range = windowRange(days, now);
  const inWindow = (iso: string): boolean => {
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t >= range.start && t <= range.end;
  };

  const unit: GlucoseUnit = input.profile.glucose_unit === "mmol" ? "mmol" : "mgdl";
  const band = targetBandFor(input.profile);
  const sugar = input.sugar.filter(
    (x) => x.source === USER_SUGAR_SOURCE && inWindow(x.logged_at)
  );
  const meals = input.meals.filter((x) => inWindow(x.logged_at));
  const injections = input.injections.filter(
    (x) => USER_INJECTION_SOURCES.has(x.source) && inWindow(x.logged_at)
  );

  const insights = computeInsights(sugar, meals, injections, days, band, range);
  const show = (mgdl: number | null, n: number): number | null =>
    mgdl == null || n < MIN_READINGS_FOR_AVERAGE ? null : glucoseToDisplay(mgdl, unit);

  const byPeriod = {} as Record<PeriodKey, PeriodStat>;
  for (const key of PERIOD_KEYS) {
    const levels = sugar
      .filter((x) => PERIOD_KEY_BY_TAG[x.period_tag] === key)
      .map((x) => x.glucose_level_mgdl);
    byPeriod[key] = { n: levels.length, avg: show(mean(levels), levels.length) };
  }

  // The overall average is the mean of every reading, the period averages are means
  // of their own readings: with the counts, readings x overall minus the shown period
  // sums gives back the sum of the readings no period average covers (a period with a
  // single reading, readings with no period). When exactly one reading is left over,
  // that sum IS the reading, so the overall average is withheld too.
  const inShownPeriods = PERIOD_KEYS.reduce((sum, key) => sum + (byPeriod[key].avg === null ? 0 : byPeriod[key].n), 0);
  const overallAvg = insights.readings - inShownPeriods === 1 ? null : show(insights.avgGlucose, insights.readings);

  const tags: Partial<Record<LogTag, number>> = {};
  for (const tag of LOG_TAGS) {
    const n = meals.filter((m) => m.tags.includes(tag)).length;
    if (n > 0) tags[tag] = n;
  }

  // The retired abdomen quadrants fold into the side they sit on, so only the
  // current regions ever appear.
  const sites: Partial<Record<InjectionSite, number>> = {};
  for (const site of SELECTABLE_SITES) {
    const n = injections.filter((x) => x.site != null && canonicalSite(x.site) === site).length;
    if (n > 0) sites[site] = n;
  }

  const dayKeys = new Set<string>();
  for (const x of sugar) dayKeys.add(dayKeyOf(new Date(x.logged_at)));
  for (const x of meals) dayKeys.add(dayKeyOf(new Date(x.logged_at)));
  for (const x of injections) dayKeys.add(dayKeyOf(new Date(x.logged_at)));

  const diabetes = DIABETES_TYPES.includes(input.profile.diabetes_type)
    ? input.profile.diabetes_type
    : "unknown";

  const cgm = cgmStatsOf(input.cgm, days, unit);

  return {
    v: 1,
    days,
    unit,
    profile: {
      diabetes,
      treatment: treatmentOf(input.profile),
      target: {
        low: glucoseToDisplay(band.low, unit),
        high: glucoseToDisplay(band.high, unit),
      },
    },
    glucose: {
      readings: insights.readings,
      avg: overallAvg,
      inRangePct: insights.inRangePct == null ? null : Math.round(insights.inRangePct),
      lowCount: insights.hypoCount,
      highCount: sugar.filter((x) => x.glucose_level_mgdl > band.high).length,
      perDay: Math.round((insights.readings / days) * 10) / 10,
      byPeriod,
    },
    meals: { count: meals.length, tags },
    injections: { count: injections.length, sites },
    logging: {
      daysWithLogs: dayKeys.size,
      emptyPeriods: PERIOD_KEYS.filter((key) => byPeriod[key].n === 0),
      streakDays: streakOf(dayKeys, now, days),
    },
    ...(cgm ? { cgm } : {}),
  };
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every way a packet can be wrong, as readable lines; empty means it conforms
 * to ContextPacket v1. Closed key sets at every level (an unexpected key is a
 * violation, not an extra), fixed enums, consistent counts, ASCII only, and the
 * size ceiling.
 */
export function validateContextPacket(value: unknown): string[] {
  const out: string[] = [];
  const bad = (msg: string): void => {
    out.push(msg);
  };
  const obj = (v: unknown, path: string, keys: readonly string[]): Rec | null => {
    if (!isRec(v)) {
      bad(`${path}: not an object`);
      return null;
    }
    for (const k of Object.keys(v)) if (!keys.includes(k)) bad(`${path}.${k}: unexpected key`);
    for (const k of keys) if (!(k in v)) bad(`${path}.${k}: missing`);
    return v;
  };
  const count = (v: unknown, path: string): number => {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100000) return v;
    bad(`${path}: not a count`);
    return 0;
  };
  const num = (v: unknown, path: string, lo: number, hi: number): number | null => {
    if (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi) return v;
    bad(`${path}: out of range`);
    return null;
  };
  const numOrNull = (v: unknown, path: string, lo: number, hi: number): number | null =>
    v === null ? null : num(v, path, lo, hi);
  const tally = (v: unknown, path: string, allowed: readonly string[], cap: number): number => {
    if (!isRec(v)) {
      bad(`${path}: not an object`);
      return 0;
    }
    let sum = 0;
    for (const [k, n] of Object.entries(v)) {
      if (!allowed.includes(k)) bad(`${path}.${k}: not a known key`);
      const c = count(n, `${path}.${k}`);
      if (c < 1) bad(`${path}.${k}: zero entries must be omitted`);
      if (c > cap) bad(`${path}.${k}: more than the total`);
      sum += c;
    }
    return sum;
  };

  const rootKeys = ["v", "days", "unit", "profile", "glucose", "meals", "injections", "logging"];
  if (isRec(value) && "cgm" in value) rootKeys.push("cgm");
  const root = obj(value, "packet", rootKeys);
  if (!root) return out;

  if (root.v !== 1) bad("packet.v: must be 1");
  const days = num(root.days, "packet.days", 1, SPIKE_CONTEXT_DAYS) ?? 0;
  if (root.days !== days || !Number.isInteger(days)) bad("packet.days: not a whole number of days");
  if (root.unit !== "mgdl" && root.unit !== "mmol") bad("packet.unit: must be mgdl or mmol");

  const profile = obj(root.profile, "profile", ["diabetes", "treatment", "target"]);
  if (profile) {
    if (typeof profile.diabetes !== "string" || !DIABETES_TYPES.includes(profile.diabetes)) {
      bad("profile.diabetes: not a known type");
    }
    if (profile.treatment !== "insulin" && profile.treatment !== "pills" && profile.treatment !== "none") {
      bad("profile.treatment: not a known value");
    }
    const target = obj(profile.target, "profile.target", ["low", "high"]);
    if (target) {
      const low = num(target.low, "profile.target.low", 1, 1000);
      const high = num(target.high, "profile.target.high", 1, 1000);
      if (low != null && high != null && low >= high) bad("profile.target: low must be below high");
    }
  }

  let readings = 0;
  const glucose = obj(root.glucose, "glucose", [
    "readings",
    "avg",
    "inRangePct",
    "lowCount",
    "highCount",
    "perDay",
    "byPeriod",
  ]);
  const periodCounts: Partial<Record<PeriodKey, number>> = {};
  if (glucose) {
    readings = count(glucose.readings, "glucose.readings");
    const avg = numOrNull(glucose.avg, "glucose.avg", 0, 1000);
    const pct = numOrNull(glucose.inRangePct, "glucose.inRangePct", 0, 100);
    if ((readings > 0) !== (pct !== null)) bad("glucose.inRangePct: set exactly when there are readings");
    if (pct !== null && !Number.isInteger(pct)) bad("glucose.inRangePct: not a whole number");
    const low = count(glucose.lowCount, "glucose.lowCount");
    const high = count(glucose.highCount, "glucose.highCount");
    if (low + high > readings) bad("glucose: low + high exceed the readings");
    num(glucose.perDay, "glucose.perDay", 0, 100000);
    const by = obj(glucose.byPeriod, "glucose.byPeriod", PERIOD_KEYS);
    let inPeriods = 0;
    let inShownPeriods = 0;
    let periodsRead = false;
    if (by) {
      periodsRead = true;
      for (const key of PERIOD_KEYS) {
        const stat = obj(by[key], `glucose.byPeriod.${key}`, ["n", "avg"]);
        if (!stat) {
          periodsRead = false;
          continue;
        }
        const n = count(stat.n, `glucose.byPeriod.${key}.n`);
        const a = numOrNull(stat.avg, `glucose.byPeriod.${key}.avg`, 0, 1000);
        if ((n >= MIN_READINGS_FOR_AVERAGE) !== (a !== null)) {
          bad(`glucose.byPeriod.${key}: avg set exactly when n is 2 or more`);
        }
        periodCounts[key] = n;
        inPeriods += n;
        if (a !== null) inShownPeriods += n;
      }
      if (inPeriods > readings) bad("glucose.byPeriod: more than the readings");
    }
    // The overall average needs 2 or more readings, and goes too when exactly one
    // reading is left outside the shown period averages: readings x average minus
    // their sums would hand that reading back.
    const leaksOne = periodsRead && readings - inShownPeriods === 1;
    if ((readings >= MIN_READINGS_FOR_AVERAGE && !leaksOne) !== (avg !== null)) {
      bad("glucose.avg: set exactly when there are 2 or more readings and not exactly 1 reading outside the period averages");
    }
  }

  const meals = obj(root.meals, "meals", ["count", "tags"]);
  if (meals) {
    const total = count(meals.count, "meals.count");
    const tagged = tally(meals.tags, "meals.tags", LOG_TAGS, total);
    if (tagged > total * LOG_TAGS.length) bad("meals.tags: more than possible");
  }

  const injections = obj(root.injections, "injections", ["count", "sites"]);
  if (injections) {
    const total = count(injections.count, "injections.count");
    const placed = tally(injections.sites, "injections.sites", INJECTION_SITES, total);
    if (placed > total) bad("injections.sites: more than the injections");
  }

  const logging = obj(root.logging, "logging", ["daysWithLogs", "emptyPeriods", "streakDays"]);
  if (logging) {
    const withLogs = count(logging.daysWithLogs, "logging.daysWithLogs");
    const streak = count(logging.streakDays, "logging.streakDays");
    if (withLogs > days) bad("logging.daysWithLogs: more than the window");
    if (streak > withLogs) bad("logging.streakDays: more than the days with logs");
    const empty = logging.emptyPeriods;
    if (!Array.isArray(empty)) {
      bad("logging.emptyPeriods: not a list");
    } else {
      const expected = PERIOD_KEYS.filter((key) => periodCounts[key] === 0);
      if (empty.length !== expected.length || empty.some((k, i) => k !== expected[i])) {
        bad("logging.emptyPeriods: does not match the empty periods");
      }
    }
  }

  if ("cgm" in root) {
    const cgm = obj(root.cgm, "cgm", ["readings", "coveragePct", "avg", "inRangePct"]);
    if (cgm) {
      const readings = count(cgm.readings, "cgm.readings");
      if (readings < MIN_CGM_READINGS) bad("cgm.readings: fewer than the minimum");
      const coverage = num(cgm.coveragePct, "cgm.coveragePct", 0, 100);
      if (coverage !== null && (!Number.isInteger(coverage) || coverage !== coveragePctOf(readings, days))) {
        bad("cgm.coveragePct: does not match the readings and the window (coverage)");
      }
      num(cgm.avg, "cgm.avg", 0, 1000);
      const pct = num(cgm.inRangePct, "cgm.inRangePct", 0, 100);
      if (pct !== null && !Number.isInteger(pct)) bad("cgm.inRangePct: not a whole number");
    }
  }

  const json = JSON.stringify(value);
  if (!/^[\x20-\x7e]*$/.test(json)) bad("packet: not plain ASCII");
  if (json.length >= SPIKE_CONTEXT_MAX_BYTES) bad("packet: 2 KB or larger");
  return out;
}

export function isValidContextPacket(value: unknown): value is ContextPacket {
  return validateContextPacket(value).length === 0;
}

/** What summarizeForSpike reads. The default is the real db; a caller (or the
 *  node test) can hand in another. */
export interface SpikeContextSource {
  listSugarLogs(profileId: string, limit: number, range: DateRange): Promise<SugarLog[]>;
  listMealLogs(profileId: string, limit: number, range: DateRange): Promise<MealLog[]>;
  getInjections(profileId: string, limit: number, range: DateRange): Promise<Injection[]>;
  resolveProfile(): Promise<SpikeProfile | null>;
  /** Sensor aggregates (count, mean, in-range count) for the window. Optional:
   *  a source without it simply yields a packet without the CGM block. */
  getCgmAggregate?(
    profileId: string,
    range: DateRange,
    band: { low: number; high: number }
  ): Promise<CgmAggregate | null>;
}

/**
 * The only query that touches sensor rows for Spike. It returns three numbers;
 * no reading, timestamp, source_app or external_id is selected. Placeholder
 * order: see cgmAggregateParams. Reads idx_sugar_cgm.
 */
export const CGM_AGGREGATE_SQL =
  "SELECT COUNT(*) AS n, AVG(glucose_level_mgdl) AS avg, " +
  `COALESCE(SUM(CASE WHEN glucose_level_mgdl >= ? AND glucose_level_mgdl <= ? AND glucose_level_mgdl < ${VERY_HIGH_MGDL} THEN 1 ELSE 0 END), 0) AS inr ` +
  "FROM sugar_logs WHERE profile_id = ? AND is_cgm = 1 AND logged_at >= ? AND logged_at <= ?;";

export function cgmAggregateParams(
  profileId: string,
  range: DateRange,
  band: { low: number; high: number }
): (string | number)[] {
  return [
    band.low,
    band.high,
    profileId,
    new Date(range.start).toISOString(),
    new Date(range.end).toISOString(),
  ];
}

export interface SpikeContextOptions {
  /** The profile on screen. Omitted, the stored active profile is used. */
  profile?: SpikeProfile | null;
  source?: SpikeContextSource;
  now?: number;
  /** Whether the cgm block may be built. Omitted, it follows the stored summary
   *  consent: only a consent given on the text that names CGM (version 2)
   *  counts. Fail-closed: an unreadable store means no cgm block. */
  cgmConsent?: boolean;
}

async function cgmConsentGiven(): Promise<boolean> {
  try {
    const { hasSpikeCgmConsent } = require("../services/spikeConsent");
    return (await hasSpikeCgmConsent()) === true;
  } catch {
    return false;
  }
}

/** Same key AppContext writes; duplicated like lib/services/health.ts does. */
const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";
/** Rows are filtered by source AFTER the query, so the cap has to clear a
 *  CGM-style Health import (hundreds a day) or it would crowd manual rows out. */
const SUGAR_FETCH_LIMIT = 10_000;
const LOG_FETCH_LIMIT = 2_000;

/** Required lazily: the db modules pull expo-sqlite, which must stay out of the
 *  module graph scripts/spikeContext.test.ts compiles and runs under node. */
function dbSource(): SpikeContextSource {
  const logs = require("../db/logs");
  const injections = require("../db/injections");
  const profiles = require("../db/profiles");
  const storage = require("@react-native-async-storage/async-storage").default;
  return {
    listSugarLogs: (id, limit, range) => logs.listSugarLogs(id, limit, range),
    listMealLogs: (id, limit, range) => logs.listMealLogs(id, limit, range),
    getInjections: (id, limit, range) => injections.getInjections(id, limit, range),
    resolveProfile: async () => {
      const saved: string | null = await storage.getItem(ACTIVE_PROFILE_KEY);
      const found = saved ? await profiles.getProfile(saved) : null;
      return found ?? (await profiles.getDefaultProfile());
    },
    getCgmAggregate: async (id, range, band) => {
      const db = await require("../db/index").getDb();
      const row = await db.getFirstAsync(CGM_AGGREGATE_SQL, cgmAggregateParams(id, range, band));
      return row ? { count: row.n ?? 0, avgMgdl: row.avg ?? null, inRangeCount: row.inr ?? 0 } : null;
    },
  };
}

/**
 * The packet for the last `days` days (at most 14), or null when anything goes
 * wrong or the result does not validate: no packet is always safer than a
 * doubtful one, and the question still goes out without it.
 */
export async function summarizeForSpike(
  days: number = SPIKE_CONTEXT_DAYS,
  options: SpikeContextOptions = {}
): Promise<ContextPacket | null> {
  try {
    const source = options.source ?? dbSource();
    const profile = options.profile ?? (await source.resolveProfile());
    if (!profile) return null;
    const span = clampDays(days);
    const now = options.now ?? Date.now();
    const range = windowRange(span, now);
    const [sugar, meals, injections] = await Promise.all([
      source.listSugarLogs(profile.id, SUGAR_FETCH_LIMIT, range),
      source.listMealLogs(profile.id, LOG_FETCH_LIMIT, range),
      source.getInjections(profile.id, LOG_FETCH_LIMIT, range),
    ]);
    let cgm: CgmAggregate | null = null;
    if (source.getCgmAggregate && (options.cgmConsent ?? (await cgmConsentGiven()))) {
      try {
        cgm = await source.getCgmAggregate(profile.id, range, targetBandFor(profile));
      } catch {
        cgm = null;
      }
    }
    const packet = buildContextPacket({ profile, sugar, meals, injections, cgm, days: span, now });
    return isValidContextPacket(packet) ? packet : null;
  } catch {
    return null;
  }
}
