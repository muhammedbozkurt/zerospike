import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash, logEvent } from "../analytics";
import { LOG_KINDS, type LogKind } from "../analytics/eventSchema";
import { getDb } from "../db";
import { USER_ENTERED_SQL } from "../glucoseSource";

/**
 * first_log: the first time this install logs each kind of entry, reported once.
 *
 * The kinds are the ones analytics may know (LOG_KINDS: glucose, meal, other),
 * not the finer ones the call sites name: the first injection, the first basal
 * dose and the first medication entry all count as the one "other", so it is
 * reported once, and the table cannot tell who uses insulin or pills.
 *
 * One AsyncStorage flag per kind keeps it once even if the user deletes
 * everything and starts over. An install that already holds entries of a kind
 * must never report it as new, so the flag is also filled silently from the
 * database, twice: once at first open (seedFirstLogFlags, from the dashboard),
 * and again at write time, where a second row of the kind proves the one just
 * written was not the first. The write-time check is what protects a cold start
 * through a notification or widget, which reaches a log screen without the
 * dashboard having mounted.
 */

export const FIRST_LOG_KINDS = LOG_KINDS;
export type FirstLogKind = LogKind;

/** What a log_added call site reports. A basal dose is an injection here. */
export type LoggedKind = "glucose" | "meal" | "injection" | "med" | "basal";

/** glucose and meal stay as they are; injections, basal doses and medication are "other". */
export function firstLogKindOf(logged: LoggedKind): FirstLogKind {
  return logged === "glucose" || logged === "meal" ? logged : "other";
}

const FLAG_PREFIX = "zerospike.firstLog.";
const SEEDED_KEY = "zerospike.firstLogSeeded";

// Rows of the kind across every profile, capped at 2: enough to tell "only the
// entry just written" from "there were others". A Health import is not an entry
// the user made, so it does not make a manual reading any less the first.
const COUNT_SQL: Record<FirstLogKind, string> = {
  glucose:
    `SELECT COUNT(*) AS c FROM (SELECT 1 FROM sugar_logs WHERE ${USER_ENTERED_SQL} LIMIT 2);`,
  meal: "SELECT COUNT(*) AS c FROM (SELECT 1 FROM meal_logs LIMIT 2);",
  other:
    "SELECT COUNT(*) AS c FROM (SELECT 1 FROM injection_logs UNION ALL SELECT 1 FROM med_logs LIMIT 2);",
};

async function rowsOfKind(kind: FirstLogKind): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(COUNT_SQL[kind]);
  return row?.c ?? 0;
}

// Kinds already settled in this session, claimed before the first await so two
// quick saves of one kind cannot both report it.
const settled = new Set<FirstLogKind>();

/**
 * Call right after a log row is written, next to its log_added event. Reports
 * first_log{kind} when this was the install's first entry of that kind.
 */
export async function noteFirstLog(logged: LoggedKind): Promise<void> {
  const kind = firstLogKindOf(logged);
  if (settled.has(kind)) return;
  settled.add(kind);
  try {
    const flagKey = FLAG_PREFIX + kind;
    if ((await AsyncStorage.getItem(flagKey)) != null) return;
    const wasFirst = (await rowsOfKind(kind)) <= 1;
    await AsyncStorage.setItem(flagKey, "1");
    if (wasFirst) logEvent("first_log", { kind });
  } catch (err) {
    settled.delete(kind);
    logCrash(err, { service: "firstLog", op: "note", kind });
  }
}

/**
 * Fills the flag of every kind the install already has entries of, without
 * reporting anything, once. A fresh install finds nothing to fill and only
 * records that it looked.
 */
export async function seedFirstLogFlags(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(SEEDED_KEY)) != null) return;
    for (const kind of FIRST_LOG_KINDS) {
      const flagKey = FLAG_PREFIX + kind;
      if ((await AsyncStorage.getItem(flagKey)) != null) continue;
      if ((await rowsOfKind(kind)) > 0) await AsyncStorage.setItem(flagKey, "1");
    }
    await AsyncStorage.setItem(SEEDED_KEY, "1");
  } catch (err) {
    logCrash(err, { service: "firstLog", op: "seed" });
  }
}
