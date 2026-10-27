/**
 * Arabic RTL display fixes (2.5.0): basal line composition, Latin store name
 * isolation in sentence-final position, SegmentedStat divider side.
 *
 * Run: npx -y tsx scripts/arBidi.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { basalTodaySummary } from "../lib/format";
import ar from "../lib/i18n/locales/ar";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

const FSI = "⁨";
const LRI = "⁦";
const PDI = "⁩";
const base = { time: "10:30 م", units: "24", unitShort: "U", unitLong: "وحدة" };

const arOut = basalTodaySummary({ lang: "ar", ...base });
check("ar: bare Latin 'U' is not used", !/\bU\b/.test(arOut));
check("ar: uses the Arabic unit word", arOut.includes("وحدة"));
check(
  "ar: time and dose are separate auto-direction isolates",
  arOut === `${FSI}10:30 م${PDI}، ${FSI}24 وحدة${PDI}`
);
check("ar: no LTR isolate around the mixed run", !arOut.includes(LRI));

check(
  "en unchanged",
  basalTodaySummary({ lang: "en", time: "10:30 PM", units: "24", unitShort: "U", unitLong: "units" }) ===
    `${LRI}10:30 PM, 24 U${PDI}`
);
check(
  "ja unchanged",
  basalTodaySummary({ lang: "ja", time: "22:30", units: "24", unitShort: "U", unitLong: "単位" }) ===
    `${LRI}22:30、24 U${PDI}`
);
check(
  "de unchanged",
  basalTodaySummary({ lang: "de", time: "22:30", units: "24", unitShort: "IE", unitLong: "Einheiten" }) ===
    `${LRI}22:30, 24 IE${PDI}`
);

const root = join(__dirname, "..");
const arSrc = readFileSync(join(root, "lib/i18n/locales/ar.ts"), "utf8");
const hints = (arSrc.match(/(?:measureCgmHint|modeCgmHint): "[^"]*"/g) ?? []).map((l) => l.replace(/^[^"]*"/, "").replace(/^.*لديك في /, "CGM لديك في "));
check("ar: both CGM hints found", hints.length === 2);
for (const h of hints) {
  check(
    "ar: store name isolated before the final period",
    h === 'CGM لديك في \\u2068{{store}}\\u2069."'
  );
}

const ui = readFileSync(join(root, "components/ui.tsx"), "utf8");
const home = readFileSync(join(root, "app/(tabs)/index.tsx"), "utf8");
const leftDivider = /borderLeftWidth: 1, borderLeftColor: THEME\.border/;
const startDivider = /borderStartWidth: 1, borderStartColor: THEME\.border/;
check("SegmentedStat divider uses borderStart (RTL-aware)", startDivider.test(ui) && !leftDivider.test(ui));
check("home skeleton divider uses borderStart", startDivider.test(home) && !leftDivider.test(home));

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
