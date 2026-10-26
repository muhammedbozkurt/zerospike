/**
 * lib/exportLimits.ts + export wiring harness (G30). No jest, same standalone
 * style as scripts/sheetLayout.test.ts. The PDF side (note in the footnote,
 * figures from every row) is pinned in scripts/reportLayout.test.ts.
 *
 * The bug this pins: CSV and PDF exports cut the journal to the newest
 * EXPORT_MAX_ROWS rows with nothing in the file or the UI saying so. Now a cut
 * is detected (fetch limit + 1), noted inside the file, and announced by a toast.
 *
 * Run: npx tsx scripts/exportLimits.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare const require: { (id: string): any };

const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

import {
  ANALYSIS_MAX_ROWS,
  CSV_MAX_ROWS,
  CSV_PAGE_ROWS,
  EXPORT_MAX_ROWS,
  applyRowLimit,
  csvFooterRows,
  planFeedPages,
  progressPercent,
  truncationMessage,
  writeFeedPaged,
} from "../lib/exportLimits";

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const ROOT = join(__dirname, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

{
  const under = applyRowLimit(rows(5), 10);
  ok("under the limit: not cut", !under.truncated && under.rows.length === 5);
  const exact = applyRowLimit(rows(10), 10);
  ok("exactly the limit: not cut", !exact.truncated && exact.rows.length === 10);
  const over = applyRowLimit(rows(11), 10);
  ok("limit + 1: cut, newest 10 kept", over.truncated && over.rows.length === 10 && over.rows[0] === 0 && over.rows[9] === 9);
}

ok("page size divides the CSV limit evenly", CSV_MAX_ROWS % CSV_PAGE_ROWS === 0 && CSV_PAGE_ROWS === 20000);
ok("progress percent", progressPercent(0, 0) === 0 && progressPercent(1, 3) === 33 && progressPercent(5, 4) === 100 && progressPercent(-1, 4) === 0);

ok("CSV limit covers 90 days of 5-minute CGM twice over", CSV_MAX_ROWS >= 90 * 288 * 2);
ok("analysis limit is above the list and CSV limits", ANALYSIS_MAX_ROWS > EXPORT_MAX_ROWS && ANALYSIS_MAX_ROWS >= CSV_MAX_ROWS);

{
  const esc = (v: string) => (v.includes(";") ? `"${v}"` : v);
  const plain = csvFooterRows(esc, "disc", null);
  ok("no cut: blank row + disclaimer only", plain.length === 2 && plain[0] === "" && plain[1] === "disc", JSON.stringify(plain));
  const cut = csvFooterRows(esc, "disc", "newest 5; kept");
  ok("cut: escaped note sits before the disclaimer", cut.length === 3 && cut[1] === '"newest 5; kept"' && cut[2] === "disc", JSON.stringify(cut));
}

{
  const t = (k: string, o?: Record<string, unknown>) => `${k}|${o?.count}`;
  ok("whole file cut: export.truncated", truncationMessage(t, { limit: 5, listOnly: false }, "5") === "export.truncated|5");
  ok("list only cut: export.truncatedList", truncationMessage(t, { limit: 5, listOnly: true }, "5") === "export.truncatedList|5");
  const t2 = (k: string, o?: Record<string, unknown>) => `${k}|${o?.count}|${o?.list}`;
  ok("both limits hit: export.truncatedBoth names both", truncationMessage(t2, { limit: 150, listOnly: false, listLimit: 20 }, "150", "20") === "export.truncatedBoth|150|20");
  ok("whole file cut and no list cut: plain note", truncationMessage(t2, { limit: 150, listOnly: false }, "150", "20") === "export.truncated|150|undefined");
}

// ── Paged writing (OPUS-3: a 120k-row CSV never sits in memory at once) ──
{
  const MIN = 60_000;
  const T0 = Date.UTC(2026, 0, 1);
  type Row = { id: number; logged_at: string };
  const makeFeed = (n: number, tieEvery = 0): Row[] =>
    Array.from({ length: n }, (_, i) => {
      const slot = tieEvery > 0 ? Math.floor(i / tieEvery) : i;
      return { id: i, logged_at: new Date(T0 + slot * MIN).toISOString() };
    }).reverse(); // newest first
  const reader = (feed: Row[], stats: { maxReturned: number; calls: number }) =>
    async (r: { start: number; end: number }, limit: number): Promise<Row[]> => {
      stats.calls++;
      const out: Row[] = [];
      for (const row of feed) {
        const t = Date.parse(row.logged_at);
        if (t >= r.start && t <= r.end) out.push(row);
        if (out.length >= limit) break;
      }
      stats.maxReturned = Math.max(stats.maxReturned, out.length);
      return out;
    };
  const span = { start: 0, end: Date.UTC(2100, 0, 1) };

  async function run(): Promise<void> {
    // 120 000 rows: exactly the CSV limit, not a cut.
    {
      const feed = makeFeed(120_000);
      const stats = { maxReturned: 0, calls: 0 };
      const plan = await planFeedPages(reader(feed, stats), span, CSV_MAX_ROWS);
      ok("120k rows: planned, not cut", !plan.cut && plan.total === 120_000, JSON.stringify({ cut: plan.cut, total: plan.total }));
      ok("120k rows: six pages of 20k", plan.pages.length === 6 && plan.pages.every((p) => p.count === 20_000), String(plan.pages.length));
      ok("planning never returns more than a page", stats.maxReturned <= CSV_PAGE_ROWS, String(stats.maxReturned));

      const chunks: string[] = [];
      const pageStats = { maxReturned: 0, calls: 0 };
      const progress: number[] = [];
      const res = await writeFeedPaged({
        plan,
        readPage: reader(feed, pageStats),
        toLines: (rows) => rows.map((r) => `row${r.id}`),
        write: async (c) => void chunks.push(c),
        header: "HEAD",
        footerRows: ["", "disc"],
        onProgress: (p) => {
          if (p.stage === "writing") progress.push(progressPercent(p.done, p.total));
        },
      });
      ok("fake writer got header + 6 pages + footer = 8 chunks", chunks.length === 8 && res.chunks === 8, String(chunks.length));
      const lineCounts = chunks.slice(1, 7).map((c) => c.split("\r\n").length - 1);
      ok("no chunk holds more than one page of lines", lineCounts.every((n) => n === 20_000), JSON.stringify(lineCounts));
      ok("no page read exceeds page + slack rows", pageStats.maxReturned <= CSV_PAGE_ROWS + 1000, String(pageStats.maxReturned));
      ok("every row written exactly once", res.rows === 120_000);
      const joined = chunks.join("");
      const expected = ["HEAD", ...Array.from({ length: 120_000 }, (_, i) => `row${i}`), "", "disc"].join("\r\n");
      ok("paged output equals the one-shot join, oldest first", joined === expected);
      ok("progress rises to 100 and never falls", progress[progress.length - 1] === 100 && progress.every((p, i) => i === 0 || p >= progress[i - 1]), JSON.stringify(progress));
    }
    // 130 000 rows: cut at the newest 120 000.
    {
      const feed = makeFeed(130_000);
      const plan = await planFeedPages(reader(feed, { maxReturned: 0, calls: 0 }), span, CSV_MAX_ROWS);
      ok("130k rows: cut, total is the limit", plan.cut && plan.total === 120_000, JSON.stringify({ cut: plan.cut, total: plan.total }));
      const chunks: string[] = [];
      await writeFeedPaged({
        plan,
        readPage: reader(feed, { maxReturned: 0, calls: 0 }),
        toLines: (rows) => rows.map((r) => `row${r.id}`),
        write: async (c) => void chunks.push(c),
        header: "H",
        footerRows: ["", "note"],
      });
      const body = chunks.slice(1, -1).join("").split("\r\n").filter(Boolean);
      ok("cut: the newest 120k rows, oldest of them first", body.length === 120_000 && body[0] === "row10000" && body[body.length - 1] === "row129999", `${body.length} ${body[0]} ${body[body.length - 1]}`);
    }
    // Readings sharing a millisecond across a page boundary are neither lost nor doubled.
    {
      const feed = makeFeed(50_000, 25);
      const plan = await planFeedPages(reader(feed, { maxReturned: 0, calls: 0 }), span, CSV_MAX_ROWS);
      const seen = new Set<number>();
      let dup = 0;
      await writeFeedPaged({
        plan,
        readPage: reader(feed, { maxReturned: 0, calls: 0 }),
        toLines: (rows) => rows.map((r) => (seen.has(r.id) ? (dup++, "") : (seen.add(r.id), "x"))),
        write: async () => {},
        header: "",
        footerRows: [],
      });
      ok("ties across a page edge: nothing lost, nothing twice", seen.size === 50_000 && dup === 0, `${seen.size} ${dup}`);
    }
    // Empty and small ranges.
    {
      const empty = await planFeedPages(reader([], { maxReturned: 0, calls: 0 }), span, CSV_MAX_ROWS);
      ok("empty range: no pages", empty.pages.length === 0 && empty.total === 0 && !empty.cut);
      const feed = makeFeed(7);
      const plan = await planFeedPages(reader(feed, { maxReturned: 0, calls: 0 }), span, CSV_MAX_ROWS);
      ok("small range: one page", plan.pages.length === 1 && plan.total === 7);
    }
  }
  pending.push(run());
}

{
  const exp = read("lib/services/export.ts");
  ok("CSV plans its pages up to the limit", /planFeedPages\(readPage, span, CSV_MAX_ROWS/.test(exp));
  ok("CSV appends page by page", exp.includes("writeFeedPaged(") && /append:\s*true/.test(exp));
  ok("CSV no longer joins every row into one string", !/rows\.join\(/.test(exp) && !/\[\.\.\.entries\]\.reverse\(\)/.test(exp));
  ok("CSV writes the note via the footer helper", exp.includes("csvFooterRows(") && exp.includes("truncated: truncation"));
  const rep = read("lib/services/report.ts");
  ok("PDF reads the feed up to the analysis limit + 1, without sensor rows", /getJournal\(profile\.id, lang, ANALYSIS_MAX_ROWS \+ 1, r, \{ cgm: "exclude" \}\)/.test(rep));
  ok("PDF reads the sensor readings as lean points under the same guard", /listGlucosePoints\(profile\.id, r, "cgm", ANALYSIS_MAX_ROWS \+ 1\)/.test(rep));
  ok("the stale 'EXPORT_MAX_ROWS caps the merged feed' comment is gone", !rep.includes("EXPORT_MAX_ROWS now caps the merged feed"));
  ok("the note names both limits when both bite", rep.includes("listLimit: entries.length > listLimit ? listLimit : undefined") && rep.includes("truncated.listLimit"));
  ok("PDF no longer reads with the list limit", !/getJournal\(profile\.id, lang, EXPORT_MAX_ROWS/.test(rep));
  const page = read("app/settings/data.tsx");
  ok("settings: toast for a cut export", page.includes("truncationMessage(") && /res\.truncated/.test(page));
}

{
  const dir = join(ROOT, "lib/i18n/locales");
  for (const f of readdirSync(dir).filter((x: string) => x.endsWith(".ts"))) {
    const src: string = readFileSync(join(dir, f), "utf8");
    const block = src.slice(src.indexOf("  export: {"), src.indexOf("  report: {"));
    for (const key of ["truncated", "truncatedList", "truncatedBoth"]) {
      const m = block.match(new RegExp(`\\n    ${key}:\\s*"([^"]+)"`));
      ok(`${f}: export.${key} has {{count}}`, !!m && m[1].includes("{{count}}"), m ? m[1] : "missing");
      if (key === "truncatedBoth") ok(`${f}: export.truncatedBoth has {{list}}`, !!m && m[1].includes("{{list}}"));
      ok(`${f}: export.${key} has no em-dash`, !m || !m[1].includes(String.fromCharCode(0x2014)));
    }
  }
}

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
