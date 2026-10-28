/**
 * pct()/pctParts(): the sign never breaks away from the number (U+00A0 in
 * de/fr/es), tr/en/others unchanged.   npx tsx scripts/pctFormat.test.ts
 */
import { decimalInputText, pct, pctParts } from "../lib/format";
import { setActiveLang } from "../lib/lang";
import { basisLine, coverageLine } from "../lib/cgm/basisText";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const NB = " ";
for (const l of ["de", "fr", "es"]) {
  setActiveLang(l);
  eq(`${l} pct`, pct(92), `92${NB}%`);
  eq(`${l} pctParts sign`, pctParts(92).sign, `${NB}%`);
}
setActiveLang("tr");
eq("tr pct", pct(92), "%92");
setActiveLang("en");
eq("en pct", pct(92), "92%");
setActiveLang("it");
eq("it pct", pct(92), "92%");

for (const l of ["fr", "de", "es", "it", "pt", "tr"]) {
  setActiveLang(l);
  eq(`${l} decimal input`, decimalInputText(35.2), "35,2");
  eq(`${l} whole input`, decimalInputText(40), "40");
}
for (const l of ["en", "ja", "ar"]) {
  setActiveLang(l);
  eq(`${l} decimal input`, decimalInputText(35.2), "35.2");
}

// CGM coverage is a percentage like any other: written by pct(), never by hand.
const fakeT = (key: string, o?: Record<string, unknown>) =>
  key.startsWith("cgmInsights.")
    ? `${key}|${o?.days ?? ""}|${o?.pct ?? ""}|${o?.sources ?? ""}|${o?.n ?? ""}`
    : key;
const expectCoverage: Record<string, string> = {
  tr: "%92",
  en: "92%",
  it: "92%",
  pt: "92%",
  ja: "92%",
  ar: `92${String.fromCharCode(0x200e)}%`,
  de: `92${NB}%`,
  fr: `92${NB}%`,
  es: `92${NB}%`,
};
for (const [l, want] of Object.entries(expectCoverage)) {
  setActiveLang(l);
  eq(`${l} coverage line carries ${want}`, coverageLine(fakeT, 14, 92), `cgmInsights.coverageLine|14|${want}||`);
  eq(
    `${l} basis line (sensor) carries ${want}`,
    basisLine(fakeT, "ios", { basis: "cgm", cgmCoverage: 92, cgmSources: ["health"], manualReadings: 0 }),
    `cgmInsights.basisCgm||${want}|settings.healthSection|`
  );
}
setActiveLang("en");
eq("no sensor reading: no basis line", basisLine(fakeT, "ios", { basis: "manual", cgmCoverage: null, cgmSources: [], manualReadings: 4 }), null);
eq(
  "low coverage: manual basis, coverage still named",
  basisLine(fakeT, "ios", { basis: "manual", cgmCoverage: 12, cgmSources: ["health"], manualReadings: 4 }),
  "cgmInsights.basisAll||12%||"
);
eq(
  "sensor basis with hand-entered rows names their count",
  basisLine(fakeT, "android", { basis: "cgm", cgmCoverage: 86, cgmSources: ["health", "nightscout"], manualReadings: 42 }),
  "cgmInsights.basisCgmManual||86%|settings.healthSectionAndroid, cgmSource.nightscout|42"
);

// No hand-written percent sign next to a value in the files that format coverage.
const root = nodePath.join(__dirname, "..");
for (const f of ["lib/cgm/basisText.ts", "lib/cgm/metrics.ts"]) {
  const code = nodeFs.readFileSync(nodePath.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (/\$\{[^}]*\}\s*%|%\s*\$\{|\+\s*"%"|"%"\s*\+/.test(code)) {
    failed++;
    console.log(`  x ${f} writes a percent sign by hand`);
  }
}

if (failed) {
  console.log(`pctFormat: ${failed} failed`);
  process.exit(1);
}
console.log("pctFormat: all passed");
