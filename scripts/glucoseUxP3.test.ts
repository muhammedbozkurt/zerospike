/**
 * Glucose journal row screen-reader label (status included) and the glucose
 * entry sheet's paste handling (no silent cut, named errors).
 *
 * Run: npx tsx scripts/glucoseUxP3.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare function require(id: string): any;

import en from "../lib/i18n/locales/en";
import tr from "../lib/i18n/locales/tr";
import { setActiveLang } from "../lib/lang";
import { classifyGlucose, glucoseFromDisplay } from "../lib/glucose";
import { glucoseRowLabel } from "../lib/journalA11y";
import {
  GLUCOSE_SHEET_MAX_CHARS,
  glucoseSheetBounds,
  glucoseSheetValueState,
} from "../lib/glucoseSheetInput";
import { readNumericInput } from "../lib/numericField";
import { parseDecimalText, parseWholeText } from "../lib/numberInput";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function tOf(dict: any) {
  return (key: string): string =>
    key.split(".").reduce((o: any, k: string) => (o == null ? o : o[k]), dict) ?? key;
}

// 1. row label: value unit, context, status, time
setActiveLang("en");
const tEn = tOf(en);
const profile = {};
function label(mgdl: number, unit: "mgdl" | "mmol", tag: any, t = tEn) {
  return glucoseRowLabel({
    t,
    mgdl,
    unit,
    status: classifyGlucose(mgdl, tag, profile),
    sourceLabel: "Fasting",
    timeText: "08:15",
    canAddPeriod: tag === "unset",
  });
}

eq("mg/dL in range label", label(90, "mgdl", "fasting"), `90 mg/dL, Fasting, ${en.insights.inRange}, 08:15`);
ok("low label carries the low word", label(60, "mgdl", "fasting").includes(en.insights.low));
ok("high label carries the high word", label(180, "mgdl", "fasting").includes(en.insights.high));
ok("very high label carries its word", label(300, "mgdl", "fasting").includes(en.insights.veryHigh));
ok("low is not announced twice", !label(60, "mgdl", "fasting").includes(en.journal.lowBadge));

const mmolLabel = label(Math.round(glucoseFromDisplay(6.5, "mmol")), "mmol", "fasting");
ok("mmol label has value and unit", /^6[.,]5 mmol\/L, /.test(mmolLabel));
ok("mmol label has the status", mmolLabel.includes(en.insights.high));
ok("mmol label keeps the time last", mmolLabel.endsWith("08:15"));

const unset = label(100, "mgdl", "unset");
ok("unset period still hints at assigning one", unset.endsWith(en.journal.addPeriodTag));
ok("unset label still has the status", unset.includes(en.insights.inRange));

const trLabel = label(90, "mgdl", "fasting", tOf(tr));
ok("tr label uses the tr status word", trLabel.includes(tr.insights.inRange));

// 2. sheet: pasting is judged whole, never cut. Same steps as the sheet's
// onType + typed: readNumericInput, then parse, then the bounds state.
type Verdict = { text: string; kind: string };
function sheet(raw: string, unit: "mgdl" | "mmol", prev = ""): Verdict {
  const mmol = unit === "mmol";
  const r = readNumericInput(raw, prev, { decimals: mmol ? 1 : 0 });
  const typed = r.kind === "malformed" ? null : mmol ? parseDecimalText(r.text) : parseWholeText(r.text);
  const state = glucoseSheetValueState(typed, unit);
  return { text: r.text, kind: r.kind === "malformed" ? "malformed" : state };
}
const mg = (raw: string, prev = "") => sheet(raw, "mgdl", prev);
const mm = (raw: string, prev = "") => sheet(raw, "mmol", prev);

eq("mg/dL 110 is valid", mg("110").kind, "ok");
eq("mg/dL 110,5 pasted is malformed", mg("110,5").kind, "malformed");
eq("mg/dL 110,5 keeps its text on screen", mg("110,5").text, "110,5");
eq("mg/dL 110.5 pasted is malformed", mg("110.5").kind, "malformed");
eq("mg/dL 1100 is above", mg("1100").kind, "above");
eq("mg/dL 1100 keeps all four digits", mg("1100").text, "1100");
eq("mg/dL 600 and 900 are still valid", [mg("600").kind, mg("900").kind], ["ok", "ok"]);
eq("mmol 6,5 is valid", mm("6,5").kind, "ok");
eq("mmol 6.5 is valid", mm("6.5").kind, "ok");
eq("mmol 6,55 pasted is malformed", mm("6,55").kind, "malformed");
eq("mmol 60 is above", mm("60").kind, "above");
eq("typing a 4th digit one key at a time is above, not cut", mg("1100", "110").kind, "above");
eq("typing 110 key by key stays valid", mg("110", "11").kind, "ok");
eq("empty is empty", mg("").kind, "empty");

eq("sheet bounds mg/dL", [glucoseSheetBounds("mgdl").min, glucoseSheetBounds("mgdl").max], [1, 900]);
eq("sheet bounds mmol", [glucoseSheetBounds("mmol").min, glucoseSheetBounds("mmol").max], [0.5, 50]);
ok("field cap leaves room for a whole paste", GLUCOSE_SHEET_MAX_CHARS >= 8);

// 3. the screens really use the helpers
const fs = require("fs");
const sheetSrc: string = fs.readFileSync(`${__dirname}/../components/GlucoseInputSheet.tsx`, "utf8");
ok("sheet derives the above error from the bounds state", sheetSrc.includes("glucoseSheetValueState(typed, unit)"));
ok("sheet no longer cuts at 3-4 characters", !/maxLength=\{mmol \? 4 : 3\}/.test(sheetSrc));
ok("sheet uses the wide cap", sheetSrc.includes("maxLength={GLUCOSE_SHEET_MAX_CHARS}"));
ok("sheet names the above error", sheetSrc.includes("wholeBad || pasteBad || aboveBad"));
const rowSrc: string = fs.readFileSync(`${__dirname}/../components/JournalItem.tsx`, "utf8");
ok("journal row builds its label with the status helper", rowSrc.includes("glucoseRowLabel({"));

if (failed) {
  console.log(`glucoseUxP3: ${failed} failed`);
  process.exit(1);
}
console.log("glucoseUxP3: all passed");
