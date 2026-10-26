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
  EXPORT_MAX_ROWS,
  applyRowLimit,
  csvFooterRows,
  truncationMessage,
} from "../lib/exportLimits";

let passed = 0;
let failed = 0;

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
}

{
  const exp = read("lib/services/export.ts");
  ok("CSV fetches limit + 1", /getJournal\(profileId, lang, CSV_MAX_ROWS \+ 1, range\)/.test(exp));
  ok("CSV writes the note via the footer helper", exp.includes("csvFooterRows(") && exp.includes("truncated: truncation"));
  const rep = read("lib/services/report.ts");
  ok("PDF reads up to the analysis limit + 1", /getJournal\(profile\.id, lang, ANALYSIS_MAX_ROWS \+ 1, r\)/.test(rep));
  ok("PDF no longer reads with the list limit", !/getJournal\(profile\.id, lang, EXPORT_MAX_ROWS/.test(rep));
  const page = read("app/settings/data.tsx");
  ok("settings: toast for a cut export", page.includes("truncationMessage(") && /res\.truncated/.test(page));
}

{
  const dir = join(ROOT, "lib/i18n/locales");
  for (const f of readdirSync(dir).filter((x: string) => x.endsWith(".ts"))) {
    const src: string = readFileSync(join(dir, f), "utf8");
    const block = src.slice(src.indexOf("  export: {"), src.indexOf("  report: {"));
    for (const key of ["truncated", "truncatedList"]) {
      const m = block.match(new RegExp(`\\n    ${key}:\\s*"([^"]+)"`));
      ok(`${f}: export.${key} has {{count}}`, !!m && m[1].includes("{{count}}"), m ? m[1] : "missing");
      ok(`${f}: export.${key} has no em-dash`, !m || !m[1].includes("—"));
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
