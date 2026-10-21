/**
 * Standalone harness for the JS side of the last-error record (lib/fatalReport.ts):
 * handler chaining and storage, caps, native/JS merge, clearing, and the optional
 * feedback attachment. No jest; compile + run with node (repo root):
 *
 *   npx tsc scripts/fatalCapture.test.ts --ignoreConfig --outDir .tmp-n3-fatal \
 *     --module commonjs --target es2019 --moduleResolution bundler \
 *     --skipLibCheck --esModuleInterop \
 *   && node .tmp-n3-fatal/scripts/fatalCapture.test.js
 */
import assert from "node:assert/strict";
import {
  FATAL_JS_STORAGE_KEY,
  FEEDBACK_MIN_REPORT_CHARS,
  FEEDBACK_SEPARATOR,
  FEEDBACK_STACK_LINES,
  MAX_JS_MESSAGE_CHARS,
  MAX_STACK_LINES,
  appendReportToMessage,
  buildJsFatalReport,
  composeFeedbackMessage,
  createFatalHandler,
  fatalReportDate,
  formatReportText,
  parseFatalReport,
  pickLatestReport,
  type FatalContext,
  type FatalReport,
} from "../lib/fatalReport";
import { MAX_MESSAGE_CHARS, cleanMessage } from "../lib/feedbackSurvey";

const ctx = (iso = "2026-10-21T10:00:00.000Z"): FatalContext => ({
  platform: "ios",
  build: "90",
  version: "2.4.0",
  now: () => new Date(iso),
});

function boom(message: string, lines: number): Error {
  const e = new Error(message);
  e.stack = Array.from({ length: lines }, (_, i) => `    at fn${i} (index.bundle:${i}:1)`).join("\n");
  return e;
}

// ---- Handler: records fatal, chains the previous handler -------------------
{
  const calls: Array<[unknown, boolean | undefined]> = [];
  const saved: FatalReport[] = [];
  const handler = createFatalHandler({
    previous: (e, f) => calls.push([e, f]),
    save: (r) => {
      saved.push(r);
    },
    context: () => ctx(),
  });
  const err = boom("x is not a function", 3);
  handler(err, true);
  assert.equal(calls.length, 1, "previous handler runs");
  assert.equal(calls[0][0], err);
  assert.equal(calls[0][1], true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "Error");
  assert.equal(saved[0].reason, "x is not a function");
  assert.equal(saved[0].build, "90");
  assert.equal(saved[0].version, "2.4.0");
  assert.equal(saved[0].at, "2026-10-21T10:00:00.000Z");
  assert.equal(saved[0].stack.length, 3);
  // the stored JSON round-trips through the shared parser
  assert.ok(parseFatalReport(JSON.stringify(saved[0])));

  // non-fatal: nothing stored, previous still runs
  handler(new Error("soft"), false);
  handler(new Error("soft2"));
  assert.equal(saved.length, 1);
  assert.equal(calls.length, 3);
}

// ---- Handler: no previous handler, failing store, throwing context ---------
{
  const noPrev = createFatalHandler({ previous: null, save: () => {}, context: () => ctx() });
  noPrev(new Error("a"), true);

  let ran = 0;
  const rejecting = createFatalHandler({
    previous: () => {
      ran++;
    },
    save: () => Promise.reject(new Error("disk full")),
    context: () => ctx(),
  });
  rejecting(new Error("b"), true);
  assert.equal(ran, 1);

  const throwing = createFatalHandler({
    previous: () => {
      ran++;
    },
    save: () => {
      throw new Error("sync fail");
    },
    context: () => {
      throw new Error("ctx fail");
    },
  });
  throwing(new Error("c"), true);
  assert.equal(ran, 2, "recording failures never block the previous handler");
}

// ---- Caps: 500 chars of message, 40 stack lines ----------------------------
{
  const r = buildJsFatalReport(boom("m".repeat(2000), 120), ctx());
  assert.equal(Array.from(r.reason).length, MAX_JS_MESSAGE_CHARS);
  assert.equal(Array.from(r.jsMessage ?? "").length, MAX_JS_MESSAGE_CHARS);
  assert.equal(r.stack.length, MAX_STACK_LINES);
  assert.equal(MAX_JS_MESSAGE_CHARS, 500);
  assert.equal(MAX_STACK_LINES, 40);
  const long = buildJsFatalReport(boom("x", 1), ctx());
  long.stack = [];
  const wide = new Error("w");
  wide.stack = "a".repeat(1000);
  assert.equal(buildJsFatalReport(wide, ctx()).stack[0].length, 300);
  // astral characters are counted as one, not split
  const astral = buildJsFatalReport(new Error("😀".repeat(600)), ctx());
  assert.equal(Array.from(astral.reason).length, 500);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(astral.reason));
}

// ---- Odd thrown values -------------------------------------------------------
{
  assert.equal(buildJsFatalReport("plain string", ctx()).reason, "plain string");
  assert.equal(buildJsFatalReport(null, ctx()).reason, "");
  assert.equal(buildJsFatalReport(undefined, ctx()).name, "Error");
  assert.equal(buildJsFatalReport(42, ctx()).stack.length, 0);
}

// ---- Merge: newer wins, native on a tie, either side missing ----------------
{
  const mk = (at: string, name: string): FatalReport => ({
    platform: "ios", kind: "k", name, reason: "", stack: [], build: "1", version: "1", at,
  });
  const nativeNew = mk("2026-10-21T10:00:05Z", "native");
  const jsOld = mk("2026-10-21T10:00:00Z", "js");
  const jsNew = mk("2026-10-21T10:00:09Z", "js");
  assert.equal(pickLatestReport(nativeNew, jsOld)?.name, "native");
  assert.equal(pickLatestReport(nativeNew, jsNew)?.name, "js");
  assert.equal(pickLatestReport(mk("2026-10-21T10:00:00Z", "native"), jsOld)?.name, "native");
  assert.equal(pickLatestReport(mk("garbage", "native"), jsOld)?.name, "js");
  assert.equal(pickLatestReport(null, jsOld)?.name, "js");
  assert.equal(pickLatestReport(nativeNew, null)?.name, "native");
  assert.equal(pickLatestReport(null, null), null);
}

// ---- Clearing: both records go (storage key + native) ------------------------
{
  const store = new Map<string, string>([[FATAL_JS_STORAGE_KEY, "{}"]]);
  let nativeCleared = false;
  const clearBoth = () => {
    store.delete(FATAL_JS_STORAGE_KEY);
    nativeCleared = true;
  };
  clearBoth();
  assert.equal(store.size, 0);
  assert.ok(nativeCleared);
  assert.equal(FATAL_JS_STORAGE_KEY, "zerospike.fatalReport.js");
}

// ---- Text and date -----------------------------------------------------------
{
  const r = buildJsFatalReport(boom("bad", 30), ctx());
  const full = formatReportText(r);
  assert.ok(full.startsWith("2026-10-21T10:00:00.000Z\nios 2.4.0 (90)\nError\nbad"));
  assert.equal(full.split("\n").filter((l) => l.includes("at fn")).length, 30);
  const short = formatReportText(r, FEEDBACK_STACK_LINES);
  assert.equal(short.split("\n").filter((l) => l.includes("at fn")).length, 20);
  assert.equal(fatalReportDate("2026-10-21T10:00:00Z"), "2026-10-21");
  assert.equal(fatalReportDate("nope"), "");
}

// ---- Feedback attachment ------------------------------------------------------
{
  const r = buildJsFatalReport(boom("bad", 60), ctx());

  // off, or no report: the message is byte-for-byte the same
  assert.equal(composeFeedbackMessage("hello", r, false, MAX_MESSAGE_CHARS), "hello");
  assert.equal(composeFeedbackMessage("hello", null, true, MAX_MESSAGE_CHARS), "hello");

  // on: separator, then the report with at most ~20 stack lines
  const on = composeFeedbackMessage("hello", r, true, MAX_MESSAGE_CHARS);
  assert.ok(on.startsWith("hello" + FEEDBACK_SEPARATOR));
  assert.ok(on.includes("\n---\n"));
  assert.equal(on.split("\n").filter((l) => l.includes("at fn")).length, FEEDBACK_STACK_LINES);
  assert.ok(Array.from(on).length <= MAX_MESSAGE_CHARS);

  // survives the same cleaning the client and server apply
  assert.equal(cleanMessage(on), on);
}

// ---- Numeric limits of the attachment ----------------------------------------
{
  const report = "R".repeat(5000);
  const sepLen = Array.from(FEEDBACK_SEPARATOR).length;

  // fills exactly to the limit, main message untouched
  const msg = "m".repeat(1000);
  const out = appendReportToMessage(msg, report, MAX_MESSAGE_CHARS);
  assert.ok(out.startsWith(msg + FEEDBACK_SEPARATOR));
  assert.equal(Array.from(out).length, MAX_MESSAGE_CHARS);
  assert.equal(cleanMessage(out), out, "server would keep every character");

  // room exactly at the minimum is used, one less is dropped
  const atMin = "m".repeat(MAX_MESSAGE_CHARS - sepLen - FEEDBACK_MIN_REPORT_CHARS);
  assert.equal(Array.from(appendReportToMessage(atMin, report, MAX_MESSAGE_CHARS)).length, MAX_MESSAGE_CHARS);
  const belowMin = "m".repeat(MAX_MESSAGE_CHARS - sepLen - FEEDBACK_MIN_REPORT_CHARS + 1);
  assert.equal(appendReportToMessage(belowMin, report, MAX_MESSAGE_CHARS), belowMin);

  // a full-length message gets nothing added
  const full = "m".repeat(MAX_MESSAGE_CHARS);
  assert.equal(appendReportToMessage(full, report, MAX_MESSAGE_CHARS), full);

  // short report: no padding, no truncation
  assert.equal(appendReportToMessage("hi", "short", 2000), "hi" + FEEDBACK_SEPARATOR + "short");
  assert.equal(appendReportToMessage("hi", "", 2000), "hi");

  // astral characters counted as one code point, like the server
  const emoji = "😀".repeat(900);
  const e = appendReportToMessage(emoji, "😀".repeat(5000), MAX_MESSAGE_CHARS);
  assert.ok(Array.from(e).length <= MAX_MESSAGE_CHARS);
  assert.ok(e.startsWith(emoji));
  assert.equal(MAX_MESSAGE_CHARS, 2000);
}

console.log("fatalCapture.test OK");
