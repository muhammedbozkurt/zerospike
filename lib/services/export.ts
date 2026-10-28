import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import i18n from "../i18n";
import { getJournal } from "../db/journal";
import { countSugarHourly, eachSugarHourlyPage } from "../db/sugarHourly";
import { currentLang } from "../i18n";
import type { GlucoseUnit, InsulinType, LogTag, PeriodTag } from "../db/types";
import { formatGlucose, glucoseUnitLabel } from "../glucose";
import { COMMA_DECIMAL, num } from "../format";
import type { DateRange } from "../insights";
import {
  CSV_MAX_ROWS,
  CSV_PAGE_ROWS,
  EXPORT_MAX_ROWS,
  csvFooterRows,
  planFeedPages,
  truncationMessage,
  writeFeedPaged,
  type ExportProgress,
  type ExportTruncation,
} from "../exportLimits";

export type ExportResult =
  | { ok: true; uri: string; count: number; truncated?: ExportTruncation }
  | { ok: false; reason: "noData" | "sharingUnavailable" };

export { EXPORT_MAX_ROWS };

/** A plain number as this file writes them (optional minus, dot or comma decimal). */
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;
/** A spreadsheet reads a cell opening with one of these as a formula (OWASP CSV injection). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Quotes a field when it contains the active delimiter, a quote or a newline. Text
 *  that would open as a formula gets a leading apostrophe; real numbers stay numbers. */
export function csvEscape(value: string | number | null | undefined, delim: string): string {
  if (value == null) return "";
  let s = String(value);
  if (typeof value === "string" && FORMULA_LEAD.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delim)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** A CSV number in the locale's decimal mark, WITHOUT grouping (grouping marks
 *  would collide with the delimiter). English keeps the dot. */
function csvNum(n: number, decimalComma: boolean): string {
  const s = String(Math.round(n * 100) / 100);
  return decimalComma ? s.replace(".", ",") : s;
}

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`,
    time: `${two(d.getHours())}:${two(d.getMinutes())}`,
  };
}

function periodLabel(tag: PeriodTag): string {
  return i18n.t(`period.${tag}`);
}

function insulinTypeLabel(type: InsulinType | null): string {
  if (type === "basal") return i18n.t("insights.basal");
  if (type === "bolus") return i18n.t("insights.bolus");
  return "";
}

function tagsLabel(tags: LogTag[]): string {
  return tags.map((tag) => i18n.t(`tags.${tag}`)).join(", ");
}

/** A medication row's Note cell: name and note share it (no dedicated note
 *  column) as "name · note", or bare name when there is no note - unchanged
 *  from every row exported before notes existed. */
function medNoteCell(name: string | null, note: string | null): string {
  const n = (name ?? "").trim();
  const nt = (note ?? "").trim();
  if (!nt) return n;
  return n ? `${n} · ${nt}` : nt;
}

/** "All time" for a CSV without a chosen range (the feed needs two bounds). */
const FAR_FUTURE_MS = Date.UTC(2100, 0, 1);

type FeedEntry = Awaited<ReturnType<typeof getJournal>>[number];

/**
 * Generates a real, fully-offline CSV of a profile's complete journal
 * (glucose + meal logs) and opens the native share sheet (WhatsApp, Email…).
 *
 * The file is written in pages of CSV_PAGE_ROWS rows, appended one after the
 * other: a year of five-minute sensor readings is 100 000+ rows, and holding the
 * feed, a reversed copy and every line at once is what runs a phone out of
 * memory. `onProgress` reports the stage and, while writing, how far along it is.
 */
export async function exportLogsCsv(
  profileId: string,
  profileName: string,
  /** The profile's display unit. Storage is mg/dL; the export follows the unit
   *  the user actually reads, and names it in its own column. */
  unit: GlucoseUnit = "mgdl",
  /** Optional explicit range; when given, only entries inside it are exported. */
  range?: DateRange,
  /** The caller's insulin_mode signal (lib/insulinMode): false means the profile's
   *  current mode is "none". Combined below with whether the exported range
   *  itself still holds injection rows, so a profile that logged doses before
   *  switching modes off does not lose that history from its export. Defaults
   *  to today's shape for any caller that has no profile in hand. */
  usesInsulin = true,
  onProgress?: (p: ExportProgress) => void
): Promise<ExportResult> {
  const lang = currentLang();
  const span = range ?? { start: 0, end: FAR_FUTURE_MS };
  const readPage = (r: { start: number; end: number }, limit: number) =>
    getJournal(profileId, lang, limit, r);

  // The range goes into SQL, not a filter over the newest rows: an export of an
  // early month used to come back short (or empty) once the profile had more
  // history than the limit, with nothing in the file saying so.
  // The planning pass counts rows page by page and keeps none of them; one row
  // past the cap is how a cut is told from an exact fit.
  onProgress?.({ stage: "reading", done: 0, total: 0 });
  let sawInjection = false;
  const plan = await planFeedPages(readPage, span, CSV_MAX_ROWS, CSV_PAGE_ROWS, (kept) => {
    if (!sawInjection) sawInjection = kept.some((e) => e.kind === "injection");
  });
  const truncation: ExportTruncation | undefined = plan.cut
    ? { limit: CSV_MAX_ROWS, listOnly: false }
    : undefined;
  // Sensor readings older than a year live on as hourly summaries (schema v30);
  // a range that reaches back that far gets them as a second table.
  const hourlyCount = await countSugarHourly(profileId, span);
  if (plan.total === 0 && hourlyCount === 0) return { ok: false, reason: "noData" };

  // Mode changes must never hide already-logged data (lib/insulinMode): a
  // profile that switched insulin_mode to "none" still gets the insulin/site
  // columns when this exact range holds injection rows from before the switch.
  const effectiveUsesInsulin = usesInsulin || sawInjection;

  // Locales whose decimal mark is a comma (tr/de/es/fr/it/pt) get a ";"
  // delimiter and a comma decimal, so Excel splits columns correctly
  // instead of pasting every row into one cell. en/ja/ar write
  // the dot, so they keep the "," format - and the list is lib/format's own, the
  // same one the Intl-formatted glucose column is written from, so a file can
  // never carry a dotted reading in a comma-decimal sheet.
  const decimalComma = COMMA_DECIMAL.includes(lang);
  const delim = decimalComma ? ";" : ",";
  const esc = (v: string | number | null | undefined) => csvEscape(v, delim);
  const cnum = (n: number) => csvNum(n, decimalComma);

  const headers = [
    i18n.t("export.colDate"),
    i18n.t("export.colTime"),
    i18n.t("export.colType"),
    i18n.t("export.colGlucose"),
    i18n.t("export.colUnit"),
    i18n.t("export.colCarbs"),
    i18n.t("export.colInsulin"),
    i18n.t("export.colFood"),
    i18n.t("export.colSite"),
    i18n.t("export.colNote"),
    i18n.t("export.colTags"),
  ];

  // Index of the two insulin-only columns. Dropping them from the header AND
  // from every row in one place is what keeps the sheet rectangular.
  const INSULIN_COL = 6;
  const SITE_COL = 8;
  const line = (cells: (string | number | null | undefined)[]) =>
    (effectiveUsesInsulin
      ? cells
      : cells.filter((_, i) => i !== INSULIN_COL && i !== SITE_COL)
    )
      .map(esc)
      .join(delim);

  const entryLine = (e: FeedEntry): string | null => {
    const { date, time } = fmtDate(e.logged_at);
    if (e.kind === "glucose") {
      return line([
        date,
        time,
        `${i18n.t("export.typeGlucose")} · ${periodLabel(e.period_tag)}`,
        // The user's own unit, not the raw storage value: a mmol/L household
        // reading "112" in their doctor's copy would be a real misreading.
        formatGlucose(e.glucose_level_mgdl, unit),
        glucoseUnitLabel(unit),
        "",
        "",
        "",
        "",
        "",
        tagsLabel(e.tags),
      ]);
    }
    if (e.kind === "meal") {
      return line([
        date,
        time,
        i18n.t("export.typeMeal"),
        "",
        "",
        cnum(Math.round(e.calculated_carbs_g * 10) / 10),
        cnum(e.insulin_dose_units),
        e.display_name,
        "",
        e.personal_note ?? "",
        tagsLabel(e.tags),
      ]);
    }
    if (e.kind === "injection") {
      const typeLabel = insulinTypeLabel(e.insulin_type);
      return line([
        date,
        time,
        typeLabel
          ? `${i18n.t("export.typeInjection")} · ${typeLabel}`
          : i18n.t("export.typeInjection"),
        "",
        "",
        "",
        e.dose_units != null ? cnum(e.dose_units) : "",
        "",
        e.site ? i18n.t(`injectionSite.${e.site}`) : i18n.t("injectionSite.unassigned"),
        e.note ?? "",
        tagsLabel(e.tags),
      ]);
    }
    if (e.kind === "med") {
      // No dedicated column for a medication name: it rides in Note, the same
      // slot a hand-typed remark would use in every other row kind. A logged
      // note joins it there too, as "name · note".
      return line([
        date,
        time,
        i18n.t("export.typeMed"),
        "",
        "",
        "",
        "",
        "",
        "",
        medNoteCell(e.name, e.note),
        "",
      ]);
    }
    return null;
  };

  const safeName = profileName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  const ymd = (d: Date) =>
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
  // A chosen range names the file by its span; otherwise by the generation time.
  const stamp = range
    ? `${ymd(new Date(range.start))}-${ymd(new Date(range.end))}`
    : `${ymd(new Date())}_${two(new Date().getHours())}${two(new Date().getMinutes())}`;
  const fileUri = `${FileSystem.cacheDirectory}zerospike_${safeName}_${stamp}.csv`;
  await FileSystem.deleteAsync(fileUri, { idempotent: true });

  // UTF-8 BOM so Excel renders Turkish characters correctly. No `sep=` line:
  // Excel then ignores the BOM and reads the file as ANSI, which garbles every
  // non-ASCII header and note in the tr/de/fr/es/it/pt files. Those locales use
  // ";" as Excel's own list separator, so the delimiter alone splits the columns.
  const header = "﻿" + line(headers);

  // Trailing medical disclaimer so the doctor-facing export is never read as
  // prescriptive (blank separator row keeps it clear of the data table).
  const footerRows = csvFooterRows(
    esc,
    i18n.t("export.disclaimer"),
    truncation ? truncationMessage((k, o) => i18n.t(k, o), truncation, num(truncation.limit)) : null
  );

  await writeFeedPaged({
    plan,
    readPage,
    // pages arrive newest-first; the file reads oldest-first
    toLines: (oldestFirst) => {
      const out: string[] = [];
      for (const e of oldestFirst) {
        const l = entryLine(e);
        if (l != null) out.push(l);
      }
      return out;
    },
    write: (chunk) =>
      FileSystem.writeAsStringAsync(fileUri, chunk, {
        encoding: FileSystem.EncodingType.UTF8,
        append: true,
      }),
    header,
    footerRows: hourlyCount > 0 ? [] : footerRows,
    onProgress,
  });

  if (hourlyCount > 0) {
    const unitName = glucoseUnitLabel(unit);
    await FileSystem.writeAsStringAsync(
      fileUri,
      "\r\n" +
        esc(i18n.t("export.hourlyTitle")) +
        "\r\n" +
        [
          i18n.t("export.colDate"),
          i18n.t("export.colTime"),
          i18n.t("export.colReadings"),
          i18n.t("export.colMean"),
          i18n.t("export.colMin"),
          i18n.t("export.colMax"),
          i18n.t("export.colUnit"),
        ]
          .map(esc)
          .join(delim),
      { encoding: FileSystem.EncodingType.UTF8, append: true }
    );
    await eachSugarHourlyPage(profileId, span, async (rows) => {
      const lines = rows.map((h) => {
        const { date, time } = fmtDate(h.hour_utc);
        return [
          date,
          time,
          h.n,
          formatGlucose(h.mean, unit),
          formatGlucose(h.min, unit),
          formatGlucose(h.max, unit),
          unitName,
        ]
          .map(esc)
          .join(delim);
      });
      await FileSystem.writeAsStringAsync(fileUri, "\r\n" + lines.join("\r\n"), {
        encoding: FileSystem.EncodingType.UTF8,
        append: true,
      });
    });
    await FileSystem.writeAsStringAsync(fileUri, "\r\n" + footerRows.join("\r\n"), {
      encoding: FileSystem.EncodingType.UTF8,
      append: true,
    });
  }

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: "sharingUnavailable" };
  }

  onProgress?.({ stage: "sharing" });
  await Sharing.shareAsync(fileUri, {
    mimeType: "text/csv",
    dialogTitle: i18n.t("export.title"),
    UTI: "public.comma-separated-values-text",
  });

  return { ok: true, uri: fileUri, count: plan.total, truncated: truncation };
}
