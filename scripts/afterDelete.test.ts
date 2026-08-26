/**
 * P17 structural guards: the parts of the delete aftermath whose correctness
 * lives in the SHAPE of the code rather than in a value a pure function
 * returns.
 *
 * Two of them cannot be expressed as ordinary assertions. "No await sits
 * between this read and this write" is a property of the source text: any
 * runtime that could observe it would need a real native bridge to yield to.
 * "This function never cancels a countdown" is the same kind of claim. Both
 * were real defects found in review, so both are pinned here against drift -
 * the same source-reading approach scripts/swipeAction.test.ts uses for the
 * library constants it depends on.
 *
 * Run: npx tsx scripts/afterDelete.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const root = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

/** The body of a top-level `async function name(...)`, by walking the
 *  parameter list to its closing paren first - the parameters themselves
 *  contain an object type whose braces would otherwise be mistaken for the
 *  body - and then brace-matching from the `{` that follows. */
function functionBody(source: string, name: string): string {
  const decl = new RegExp(`(?:export )?async function ${name}\\s*\\(`);
  const at = source.search(decl);
  if (at < 0) return "";
  let i = source.indexOf("(", at);
  let parens = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") parens++;
    else if (source[i] === ")") {
      parens--;
      if (parens === 0) break;
    }
  }
  const open = source.indexOf("{", i);
  if (open < 0) return "";
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    const ch = source[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open, j + 1);
    }
  }
  return "";
}

/** Source with every line comment and block comment blanked out, so prose that
 *  merely MENTIONS "await" or "cancel" cannot satisfy or break a guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

console.log("zerospike delete-aftermath structural test");

section("A. the countdown claim is a real compare-and-set");
{
  const src = stripComments(read("lib/services/notifications.ts"));
  const body = functionBody(src, "schedulePostMealAt");
  ok("schedulePostMealAt was found", body.length > 0);

  const readAt = body.indexOf("AsyncStorage.getItem(POSTMEAL_TIMER_END_KEY)");
  const writeAt = body.indexOf("AsyncStorage.multiSet(entries)");
  ok("the claim reads the stored end", readAt >= 0);
  ok("the claim writes the timer", writeAt >= 0);
  ok("the read comes before the write", readAt >= 0 && writeAt > readAt);

  // THE guard. Between the read completing and the write starting there must
  // be nothing that yields the event loop - otherwise a countdown armed in
  // that gap is silently overwritten, which is exactly the defect this
  // closes. Only synchronous parsing and the `if (running) return false`
  // bail-out are allowed to live in there.
  // From the read's own expression (its `await` sits BEFORE readAt, so it is
  // already excluded) up to the write, minus the write's own trailing `await`.
  // What is left is exactly the code that runs in the gap.
  const between = body.slice(readAt, writeAt).replace(/await\s*$/, "");
  eq("NO await between the claim's read and its write", between.includes("await"), false);
  ok("the bail-out itself sits in that gap", between.includes("return false"));

  // ...and the claim must be the FIRST thing the function does, because
  // everything below it (the notification cancel) is destructive to a
  // countdown that turns out to be someone else's.
  const channelAt = body.indexOf("ensureAndroidChannel()");
  const cancelAt = body.indexOf("cancelScheduledNotificationAsync(POSTMEAL_ID)");
  ok("the android channel step exists", channelAt >= 0);
  ok("the notification cancel exists", cancelAt >= 0);
  ok("the claim runs BEFORE the android channel await", writeAt < channelAt);
  ok("the claim runs BEFORE the notification cancel", writeAt < cancelAt);
}

section("B. an undo never cancels a countdown it did not arm");
{
  const src = stripComments(read("lib/services/notifications.ts"));
  const body = functionBody(src, "restorePostMealWindow");
  ok("restorePostMealWindow was found", body.length > 0);

  // No cancel on ANY path. The sibling that moves a RUNNING countdown
  // (restartPostMealTimerAt) does cancel unconditionally when it finds the
  // window elapsed, which is why the undo path must never reach it.
  eq("no cancelPostMealTimer", body.includes("cancelPostMealTimer"), false);
  eq("no cancelAlarm", body.includes("cancelAlarm"), false);
  eq("no cancelScheduledNotificationAsync", body.includes("cancelScheduledNotificationAsync"), false);
  ok("it arms through the claim, not a plain write", body.includes("claimIfIdle: true"));

  const undo = stripComments(read("lib/afterDelete.ts"));
  eq(
    "the undo path does not reach restartPostMealTimerAt at all",
    undo.includes("restartPostMealTimerAt"),
    false
  );
  ok(
    "it asks the pure question first",
    functionBody(undo, "undoAfterDelete").includes("postMealWindowRestorable")
  );
}

section("C. the template counters are written exactly once per undo");
{
  // Both one-tap save undos restore the template's captured pre-save pair
  // themselves. Letting applyAfterDelete recompute the counters as well was a
  // database write whose whole effect was overwritten a moment later, so each
  // such undo must suppress the recomputation - one suppression per restore.
  for (const rel of ["app/(tabs)/food.tsx", "app/meal-template.tsx"]) {
    const src = stripComments(read(rel));
    const restores = src.split("await setTemplateUsage(").length - 1;
    const suppressed = src.split("settleTemplates: false").length - 1;
    ok(`${rel}: restores the counters itself`, restores >= 1, `counted ${restores}`);
    eq(`${rel}: one suppression per restore`, suppressed, restores);
  }
  // The calculator's save undo does NOT restore them itself, so it must NOT
  // suppress: this is the drift that would silently reopen the counter leak.
  const calc = stripComments(read("app/calculator.tsx"));
  eq("app/calculator.tsx: restores nothing itself", calc.includes("setTemplateUsage("), false);
  eq("app/calculator.tsx: so it never suppresses", calc.includes("settleTemplates: false"), false);
}

section("D. every meal delete path still runs the shared cleanup");
{
  // One entry per user-facing meal delete found in the P17 scan. The counts
  // are minimums: a path may gain calls, but losing one means a delete that
  // leaves its countdown behind again.
  const paths: [string, number][] = [
    ["components/useJournalRows.tsx", 1],
    ["app/calculator.tsx", 2],
    ["app/(tabs)/food.tsx", 2],
    ["app/meal-template.tsx", 1],
  ];
  for (const [rel, expected] of paths) {
    const src = stripComments(read(rel));
    const calls =
      src.split("applyAfterDelete(").length -
      1 +
      (src.split("applyAfterDeleteFromSnapshot(").length - 1);
    ok(`${rel} still runs the shared cleanup`, calls >= expected, `counted ${calls}, want >= ${expected}`);
  }
  // And the undo half is wired wherever an undo exists for that delete.
  ok(
    "the journal rows replay the aftermath on undo",
    stripComments(read("components/useJournalRows.tsx")).includes("undoAfterDelete(")
  );
  ok(
    "the calculator's own meal delete replays it too",
    stripComments(read("app/calculator.tsx")).includes("undoAfterDelete(")
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
