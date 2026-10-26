import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import i18n from "../i18n";
import { getJournal } from "../db/journal";
import { currentLang } from "../i18n";
import type { GlucoseUnit, InsulinType, LogTag, PeriodTag } from "../db/types";
import { formatGlucose, glucoseUnitLabel } from "../glucose";
import { COMMA_DECIMAL, num } from "../format";
import type { DateRange } from "../insights";
import {
  CSV_MAX_ROWS,
  EXPORT_MAX_ROWS,
  applyRowLimit,
  csvFooterRows,
  truncationMessage,
  type ExportTruncation,
} from "../exportLimits";

export type ExportResult =
  | { ok: true; uri: string; count: number; truncated?: ExportTruncation }
  | { ok: false; reason: "noData" | "sharingUnavailable" };

export { EXPORT_MAX_ROWS };

/** Quotes a field when it contains the active delimiter, a quote or a newline. */
function csvEscape(value: string | number | null | undefined, delim: string): string {
  if (value == null) return "";
  const s = String(value);
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

/**
 * Generates a real, fully-offline CSV of a profile's complete journal
 * (glucose + meal logs) and opens the native share sheet (WhatsApp, Email…).
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
  usesInsulin = true
): Promise<ExportResult> {
  const lang = currentLang();
  // The range goes into SQL, not a filter over the newest 5000 rows: an export of
  // an early month used to come back short (or empty) once the profile had more
  // history than the limit, with nothing in the file saying so.
  // One row past the cap: it is how a cut is told from an exact fit.
  const { rows: entries, truncated } = applyRowLimit(
    await getJournal(profileId, lang, CSV_MAX_ROWS + 1, range),
    CSV_MAX_ROWS
  );
  const truncation: ExportTruncation | undefined = truncated
    ? { limit: CSV_MAX_ROWS, listOnly: false }
    : undefined;
  if (entries.length === 0) return { ok: false, reason: "noData" };

  // Mode changes must never hide already-logged data (lib/insulinMode): a
  // profile that switched insulin_mode to "none" still gets the insulin/site
  // columns when this exact range holds injection rows from before the switch.
  const effectiveUsesInsulin =
    usesInsulin || entries.some((e) => e.kind === "injection");

  // Locales whose decimal mark is a comma (tr/de/es/fr/it/pt) get a ";"
  // delimiter, a comma decimal, and a leading `sep=;` hint so Excel splits
  // columns correctly instead of pasting every row into one cell. en/ja/ar write
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

  const rows: string[] = [line(headers)];

  // entries are newest-first; export oldest-first for a natural reading order
  for (const e of [...entries].reverse()) {
    const { date, time } = fmtDate(e.logged_at);
    if (e.kind === "glucose") {
      rows.push(
        line([
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
        ])
      );
    } else if (e.kind === "meal") {
      rows.push(
        line([
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
        ])
      );
    } else if (e.kind === "injection") {
      const typeLabel = insulinTypeLabel(e.insulin_type);
      rows.push(
        line([
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
          e.site
            ? i18n.t(`injectionSite.${e.site}`)
            : i18n.t("injectionSite.unassigned"),
          e.note ?? "",
          tagsLabel(e.tags),
        ])
      );
    } else if (e.kind === "med") {
      // No dedicated column for a medication name: it rides in Note, the same
      // slot a hand-typed remark would use in every other row kind. A logged
      // note joins it there too, as "name · note".
      rows.push(
        line([
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
        ])
      );
    }
  }

  // Trailing medical disclaimer so the doctor-facing export is never read as
  // prescriptive (blank separator row keeps it clear of the data table).
  rows.push(
    ...csvFooterRows(
      esc,
      i18n.t("export.disclaimer"),
      truncation ? truncationMessage((k, o) => i18n.t(k, o), truncation, num(truncation.limit)) : null
    )
  );

  // UTF-8 BOM so Excel renders Turkish characters correctly, plus a `sep=` hint
  // for the comma-decimal locales so Excel picks the right delimiter.
  const sepLine = decimalComma ? `sep=${delim}\r\n` : "";
  const content = "﻿" + sepLine + rows.join("\r\n");

  const safeName = profileName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  const ymd = (d: Date) =>
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
  // A chosen range names the file by its span; otherwise by the generation time.
  const stamp = range
    ? `${ymd(new Date(range.start))}-${ymd(new Date(range.end))}`
    : `${ymd(new Date())}_${two(new Date().getHours())}${two(new Date().getMinutes())}`;
  const fileUri = `${FileSystem.cacheDirectory}zerospike_${safeName}_${stamp}.csv`;

  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: "sharingUnavailable" };
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: "text/csv",
    dialogTitle: i18n.t("export.title"),
    UTI: "public.comma-separated-values-text",
  });

  return { ok: true, uri: fileUri, count: entries.length, truncated: truncation };
}
