/**
 * Reads of sugar_hourly (schema v30): the one-row-per-hour summaries that
 * replace sensor readings older than a year (lib/cgm/retention.ts). Only the
 * exports read them; no screen does. The SQL lives here without a module-level
 * database import so scripts/opus5aImport.test.ts runs it on node:sqlite.
 */
import type { DateRange } from "../insights";

interface Reader {
  getAllAsync<T>(sql: string, params: (string | number | null)[]): Promise<T[]>;
}

export interface HourlyRow {
  hour_utc: string;
  source: string;
  n: number;
  mean: number;
  min: number;
  max: number;
}

/** Rows per page of an export read. */
export const HOURLY_PAGE_ROWS = 5000;

/** Placeholders: profile_id, from, to. */
export const HOURLY_COUNT_SQL =
  "SELECT COUNT(*) AS c FROM sugar_hourly WHERE profile_id = ? AND hour_utc >= ? AND hour_utc <= ?;";

/** Keyset page, oldest first. Placeholders: profile_id, from, to, after hour,
 *  after hour, after source, limit. Start with after = "", "". */
export const HOURLY_PAGE_SQL = `SELECT hour_utc, source, n, mean, min, max FROM sugar_hourly
  WHERE profile_id = ? AND hour_utc >= ? AND hour_utc <= ?
    AND (hour_utc > ? OR (hour_utc = ? AND source > ?))
  ORDER BY hour_utc, source LIMIT ?;`;

function bounds(range: DateRange): [string, string] {
  return [new Date(range.start).toISOString(), new Date(range.end).toISOString()];
}

export async function countHourlyRows(
  db: Reader,
  profileId: string,
  range: DateRange
): Promise<number> {
  const [from, to] = bounds(range);
  const row = (await db.getAllAsync<{ c: number }>(HOURLY_COUNT_SQL, [profileId, from, to]))[0];
  return row?.c ?? 0;
}

/** Calls `visit` with each page, oldest first, never holding more than one. */
export async function forEachHourlyPage(
  db: Reader,
  profileId: string,
  range: DateRange,
  visit: (rows: HourlyRow[]) => Promise<void>,
  pageRows: number = HOURLY_PAGE_ROWS
): Promise<number> {
  const [from, to] = bounds(range);
  let afterHour = "";
  let afterSource = "";
  let total = 0;
  for (;;) {
    const rows = await db.getAllAsync<HourlyRow>(HOURLY_PAGE_SQL, [
      profileId,
      from,
      to,
      afterHour,
      afterHour,
      afterSource,
      pageRows,
    ]);
    if (rows.length === 0) break;
    await visit(rows);
    total += rows.length;
    const last = rows[rows.length - 1];
    afterHour = last.hour_utc;
    afterSource = last.source;
    if (rows.length < pageRows) break;
  }
  return total;
}

export async function countSugarHourly(profileId: string, range: DateRange): Promise<number> {
  const { getDb } = await import("./index");
  return countHourlyRows(await getDb(), profileId, range);
}

export async function eachSugarHourlyPage(
  profileId: string,
  range: DateRange,
  visit: (rows: HourlyRow[]) => Promise<void>
): Promise<number> {
  const { getDb } = await import("./index");
  return forEachHourlyPage(await getDb(), profileId, range, visit);
}
