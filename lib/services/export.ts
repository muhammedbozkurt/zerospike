import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import i18n from "../i18n";
import { getJournal } from "../db/journal";
import { currentLang } from "../i18n";
import type { InsulinType, LogTag, PeriodTag } from "../db/types";
import { num } from "../format";

export type ExportResult =
  | { ok: true; uri: string; count: number }
  | { ok: false; reason: "noData" | "sharingUnavailable" };

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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

/**
 * Generates a real, fully-offline CSV of a profile's complete journal
 * (glucose + meal logs) and opens the native share sheet (WhatsApp, Email…).
 */
export async function exportLogsCsv(
  profileId: string,
  profileName: string
): Promise<ExportResult> {
  const lang = currentLang();
  const entries = await getJournal(profileId, lang, 5000);
  if (entries.length === 0) return { ok: false, reason: "noData" };

  const headers = [
    i18n.t("export.colDate"),
    i18n.t("export.colTime"),
    i18n.t("export.colType"),
    i18n.t("export.colGlucose"),
    i18n.t("export.colCarbs"),
    i18n.t("export.colInsulin"),
    i18n.t("export.colFood"),
    i18n.t("export.colSite"),
    i18n.t("export.colNote"),
    i18n.t("export.colTags"),
  ];

  const rows: string[] = [headers.map(csvEscape).join(",")];

  // entries are newest-first; export oldest-first for a natural reading order
  for (const e of [...entries].reverse()) {
    const { date, time } = fmtDate(e.logged_at);
    if (e.kind === "glucose") {
      rows.push(
        [
          date,
          time,
          `${i18n.t("export.typeGlucose")} · ${periodLabel(e.period_tag)}`,
          e.glucose_level_mgdl,
          "",
          "",
          "",
          "",
          "",
          tagsLabel(e.tags),
        ]
          .map(csvEscape)
          .join(",")
      );
    } else if (e.kind === "meal") {
      rows.push(
        [
          date,
          time,
          i18n.t("export.typeMeal"),
          "",
          Math.round(e.calculated_carbs_g * 10) / 10,
          e.insulin_dose_units,
          e.display_name,
          "",
          e.personal_note ?? "",
          tagsLabel(e.tags),
        ]
          .map(csvEscape)
          .join(",")
      );
    } else {
      // injection
      const typeLabel = insulinTypeLabel(e.insulin_type);
      rows.push(
        [
          date,
          time,
          typeLabel
            ? `${i18n.t("export.typeInjection")} · ${typeLabel}`
            : i18n.t("export.typeInjection"),
          "",
          "",
          e.dose_units != null ? num(e.dose_units) : "",
          "",
          i18n.t(`injectionSite.${e.site}`),
          e.note ?? "",
          tagsLabel(e.tags),
        ]
          .map(csvEscape)
          .join(",")
      );
    }
  }

  // Trailing medical disclaimer so the doctor-facing export is never read as
  // prescriptive (blank separator row keeps it clear of the data table).
  rows.push("");
  rows.push(csvEscape(i18n.t("export.disclaimer")));

  // UTF-8 BOM so Excel renders Turkish characters correctly.
  const content = "﻿" + rows.join("\r\n");

  const safeName = profileName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  const stamp = (() => {
    const d = new Date();
    return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(
      d.getHours()
    )}${two(d.getMinutes())}`;
  })();
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

  return { ok: true, uri: fileUri, count: entries.length };
}
