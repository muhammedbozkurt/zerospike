/**
 * lib/afterLogsPaywall.ts correctness harness (2.3.4's "first value" paywall).
 * No jest, same standalone style as scripts/downsellDay7.test.ts.
 *
 * Run: npx tsx scripts/afterLogsPaywall.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (id: string) => any;
declare const __dirname: string;
const nodeFs = require("node:fs");
const nodePath = require("node:path");

import {
  AFTER_LOGS_THRESHOLD,
  shouldTriggerAfterLogsPaywall,
} from "../lib/afterLogsPaywall";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike afterLogsPaywall test");

section("A. threshold matches the spec");
{
  eq("AFTER_LOGS_THRESHOLD", AFTER_LOGS_THRESHOLD, 3);
}

section("B. 2 logs -> no");
{
  const result = shouldTriggerAfterLogsPaywall({
    logCount: 2,
    alreadyTriggered: false,
    isProUser: false,
  });
  ok("false", !result);
}

section("C. 3 logs, never triggered -> yes, exactly once");
{
  const first = shouldTriggerAfterLogsPaywall({
    logCount: 3,
    alreadyTriggered: false,
    isProUser: false,
  });
  ok("true on the crossing", first);
  // The caller marks the flag right after this returns true; the very next
  // read (still 3, or more) must never fire again.
  const second = shouldTriggerAfterLogsPaywall({
    logCount: 3,
    alreadyTriggered: true,
    isProUser: false,
  });
  ok("false once the flag is set", !second);
  const evenMore = shouldTriggerAfterLogsPaywall({
    logCount: 10,
    alreadyTriggered: true,
    isProUser: false,
  });
  ok("still false with more logs, flag set", !evenMore);
}

section("D. Pro user -> no, regardless of log count");
{
  const result = shouldTriggerAfterLogsPaywall({
    logCount: 5,
    alreadyTriggered: false,
    isProUser: true,
  });
  ok("false", !result);
}

section("E. flag already set -> no, even on the very first read");
{
  const result = shouldTriggerAfterLogsPaywall({
    logCount: 3,
    alreadyTriggered: true,
    isProUser: false,
  });
  ok("false", !result);
}

section(
  "F. logCount is the VISIBLE count the caller reads with excludeCalculatorInjections - " +
    "documented at the type, not enforced here (this function only compares a number)"
);
{
  // A meal-with-dose logged through app/calculator.tsx writes a meal row AND
  // a second, silent source='calculator' injection row - two rows for one
  // action the user only sees once. If the caller passed the RAW count (3
  // rows: 1 meal + 1 auto-injection + 1 unrelated glucose reading) instead of
  // the visible one (2: the meal and the glucose reading), this function
  // would fire a whole log early. It has no way to tell the difference
  // itself - excludeCalculatorInjections is entirely the caller's contract
  // (see lib/db/journal.ts, app/(tabs)/index.tsx).
  const withRawCount = shouldTriggerAfterLogsPaywall({
    logCount: 3, // wrong: raw count including the auto-written injection
    alreadyTriggered: false,
    isProUser: false,
  });
  ok("raw (unfiltered) count of 3 still reads as a trigger - caller's job to avoid this", withRawCount);
  const withVisibleCount = shouldTriggerAfterLogsPaywall({
    logCount: 2, // correct: excludeCalculatorInjections applied by the caller
    alreadyTriggered: false,
    isProUser: false,
  });
  ok("visible count of 2 does not trigger yet", !withVisibleCount);
}

section("G. only the user's own entries are counted (Health / CGM imports are not logs)");
{
  // A session that imported 3 Apple Health readings and then saved 2 manual
  // ones opened this paywall one log early. The caller reads the journal with
  // userEntered: true (SQL in lib/db/journalSql.ts, executed by
  // scripts/journal.test.ts section F); pin the call site here.
  const dash: string = nodeFs.readFileSync(nodePath.join(__dirname, "..", "app", "(tabs)", "index.tsx"), "utf8");
  const at = dash.indexOf("AFTER_LOGS_THRESHOLD, undefined");
  const call = at >= 0 ? dash.slice(at, at + 160) : "";
  ok("the dashboard check reads the journal with userEntered: true", /userEntered:\s*true/.test(call), call);
  ok("and still excludes the calculator's silent bolus row", /excludeCalculatorInjections:\s*true/.test(call));
  const sql: string = nodeFs.readFileSync(nodePath.join(__dirname, "..", "lib", "db", "journalSql.ts"), "utf8");
  ok("the SQL filter is the manual-source allowlist", sql.includes("s.source = 'manual'"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
