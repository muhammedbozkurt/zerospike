/**
 * PDF report share-sheet file name (lib/reportFileName.ts).
 * Run: npx tsx scripts/reportFileName.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (id: string) => any;
declare const __dirname: string;

import { reportPdfFileName } from "../lib/reportFileName";

let passed = 0;
let failed = 0;
function eq<T>(name: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const d = new Date(2026, 9, 28, 13, 5);
eq("tr", reportPdfFileName("tr", d), "zerospike-rapor-2026-10-28.pdf");
eq("en", reportPdfFileName("en", d), "zerospike-report-2026-10-28.pdf");
eq("de", reportPdfFileName("de", d), "zerospike-bericht-2026-10-28.pdf");
eq("unknown language falls back to en", reportPdfFileName("xx", d), "zerospike-report-2026-10-28.pdf");
eq("zero padding", reportPdfFileName("fr", new Date(2026, 0, 5)), "zerospike-rapport-2026-01-05.pdf");
for (const lang of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  eq(`${lang} is plain ASCII`, /^[A-Za-z0-9._-]+\.pdf$/.test(reportPdfFileName(lang, d)), true);
}

const src: string = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "..", "lib", "services", "report.ts"),
  "utf8"
);
eq("report.ts renames the printed file", src.includes("reportPdfFileName(currentLang()"), true);
eq("the name builder takes no profile or reading input", src.includes("reportPdfFileName(currentLang(), new Date())"), true);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
