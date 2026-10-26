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
  /** Set when the PDF tables were ALSO cut, to fewer rows than `limit`: both
   *  limits applied at once and the note names both. */
  listLimit?: number;
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
  formattedLimit: string,
  formattedListLimit?: string
): string {
  if (!info.listOnly && info.listLimit != null && formattedListLimit != null) {
    return t("export.truncatedBoth", { count: formattedLimit, list: formattedListLimit });
  }
  return t(info.listOnly ? "export.truncatedList" : "export.truncated", {
    count: formattedLimit,
  });
}

/** Rows read and written per round trip when a CSV is built page by page. */
export const CSV_PAGE_ROWS = 20000;

/** Lets the UI draw a frame between two heavy stages (progress text, spinner). */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The stage a running export is in, for the progress line on the settings row. */
export type ExportProgress =
  | { stage: "reading"; done: number; total: number }
  | { stage: "writing"; done: number; total: number }
  | { stage: "analyzing" }
  | { stage: "rendering" };

/** Whole-number share (0..100) of a stage, never past 100. */
export function progressPercent(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/**
 * Writes a planned feed to a file one page at a time: the header, then every
 * page oldest first (read, turned into lines, appended, released), then the
 * footer. The result is byte for byte what joining all the lines with CRLF would
 * give, but no more than one page of rows is ever in memory.
 */
export async function writeFeedPaged<T>(opts: {
  plan: FeedPlan;
  /** Newest-first rows of a page's span (the journal feed). */
  readPage: (range: { start: number; end: number }, limit: number) => Promise<T[]>;
  /** Rows of one page, OLDEST first, as CSV lines (rows that print nothing may be skipped). */
  toLines: (oldestFirst: T[]) => string[];
  /** Appends text to the file (the first call may create it). */
  write: (chunk: string) => Promise<void>;
  header: string;
  footerRows: string[];
  onProgress?: (p: ExportProgress) => void;
}): Promise<{ chunks: number; rows: number }> {
  const { plan, readPage, toLines, write, onProgress } = opts;
  await write(opts.header);
  let chunks = 1;
  let rows = 0;
  onProgress?.({ stage: "writing", done: 0, total: plan.total });
  for (let i = plan.pages.length - 1; i >= 0; i--) {
    const page = plan.pages[i];
    const found = await readPage({ start: page.start, end: page.end }, page.count + PAGE_TIE_SLACK);
    const lines = toLines(found.reverse());
    if (lines.length > 0) {
      await write("\r\n" + lines.join("\r\n"));
      chunks++;
    }
    rows += found.length;
    onProgress?.({ stage: "writing", done: Math.min(rows, plan.total), total: plan.total });
    await yieldToUi();
  }
  await write("\r\n" + opts.footerRows.join("\r\n"));
  chunks++;
  return { chunks, rows };
}

/** Readings that share a millisecond with a page's oldest row can sit past the
 *  planning read's limit; the second read leaves room for them. */
const PAGE_TIE_SLACK = 1000;

export interface FeedPlan {
  /** Newest page first. `start`/`end` are the inclusive epoch-ms span, `count`
   *  the rows the planning read found in it. */
  pages: { start: number; end: number; count: number }[];
  total: number;
  /** More rows exist than `max`; the pages hold the newest `max`. */
  cut: boolean;
}

/**
 * Splits a range into time pages WITHOUT keeping their rows: each page is read
 * newest-first (at most `pageRows`), only counted, and the next page continues
 * strictly before its oldest reading. It stops once `max` rows are counted; on a
 * cut the last page starts at the `max`-th newest row, so the pages together
 * hold the newest `max` rows (a few more when readings share a millisecond).
 *
 * A second pass reads each page again, oldest page first, which is what lets a
 * CSV be written oldest-first without ever holding more than one page of rows.
 */
export async function planFeedPages<T extends { logged_at: string }>(
  read: (range: { start: number; end: number }, limit: number) => Promise<T[]>,
  range: { start: number; end: number },
  max: number,
  pageRows: number = CSV_PAGE_ROWS,
  /** Sees the rows that will be kept, page by page, while they are counted. */
  inspect?: (kept: T[]) => void
): Promise<FeedPlan> {
  const pages: FeedPlan["pages"] = [];
  let end = range.end;
  let total = 0;
  while (end >= range.start) {
    const want = Math.min(pageRows, max + 1 - total);
    const rows = await read({ start: range.start, end }, want);
    if (rows.length === 0) break;
    if (total + rows.length > max) {
      const keep = max - total;
      if (keep > 0) {
        inspect?.(rows.slice(0, keep));
        pages.push({ start: Date.parse(rows[keep - 1].logged_at), end, count: keep });
      }
      return { pages, total: total + keep, cut: true };
    }
    inspect?.(rows);
    const oldest = Date.parse(rows[rows.length - 1].logged_at);
    total += rows.length;
    pages.push({ start: oldest, end, count: rows.length });
    if (rows.length < want) break;
    end = oldest - 1;
  }
  return { pages, total, cut: false };
}
