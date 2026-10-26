/** Rows listed in one PDF table set (the numbers are never limited by this). */
export const EXPORT_MAX_ROWS = 20000;

/** A CSV is plain text, so it takes roughly a year of 5-minute CGM readings. */
export const CSV_MAX_ROWS = 120000;

/** What the PDF's AGP and summary are computed from; only a hard memory guard. */
export const ANALYSIS_MAX_ROWS = 150000;

export interface ExportTruncation {
  limit: number;
  /** true: only the PDF's raw row tables were cut, its figures cover every row. */
  listOnly: boolean;
}

/**
 * `newestFirst` was fetched with `max + 1`: the extra row is how a cut is told
 * apart from a range that holds exactly `max` entries.
 */
export function applyRowLimit<T>(
  newestFirst: T[],
  max: number
): { rows: T[]; truncated: boolean } {
  if (newestFirst.length <= max) return { rows: newestFirst, truncated: false };
  return { rows: newestFirst.slice(0, max), truncated: true };
}

/** Blank separator, the optional cut note, then the disclaimer. */
export function csvFooterRows(
  esc: (v: string) => string,
  disclaimer: string,
  truncatedNote: string | null
): string[] {
  const out = [""];
  if (truncatedNote) out.push(esc(truncatedNote));
  out.push(esc(disclaimer));
  return out;
}

export function truncationMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  info: ExportTruncation,
  formattedLimit: string
): string {
  return t(info.listOnly ? "export.truncatedList" : "export.truncated", {
    count: formattedLimit,
  });
}
