/**
 * Shape of the last fatal report the native uncaught-exception hook writes
 * (modules/zerospike-live-activity: iOS NSSetUncaughtExceptionHandler, Android
 * Thread.setDefaultUncaughtExceptionHandler). Stays on the device; nothing in
 * this file sends it anywhere. Pure so scripts/fatalReport.test.ts runs it
 * under plain Node.
 */
export interface FatalReport {
  platform: "ios" | "android";
  /** iOS "NSException"; Android the Throwable class name. */
  kind: string;
  /** iOS NSException name, e.g. "RCTFatalException: Unhandled JS Exception: ...". */
  name: string;
  reason: string;
  /** Untruncated JS message and stack when the crash was a fatal JS error. */
  jsMessage?: string;
  stack: string[];
  build: string;
  version: string;
  /** ISO 8601 UTC. Native writes epoch ms (cheaper in the crash path); an ISO
   *  string from an earlier build is kept as is. "" when unknown. */
  at: string;
  thread?: string;
  cause?: string;
}

/** Same cap the native writers use. */
export const FATAL_JS_MESSAGE_LIMIT = 2000;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isoAt(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

/** Native JSON string to a report; null for empty, malformed or foreign input. */
export function parseFatalReport(raw: string | null | undefined): FatalReport | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.platform !== "ios" && o.platform !== "android") return null;
  const report: FatalReport = {
    platform: o.platform,
    kind: str(o.kind),
    name: str(o.name),
    reason: str(o.reason),
    stack: Array.isArray(o.stack) ? o.stack.filter((s): s is string => typeof s === "string") : [],
    build: str(o.build),
    version: str(o.version),
    at: isoAt(o.at),
  };
  if (typeof o.jsMessage === "string" && o.jsMessage.length > 0) {
    report.jsMessage = o.jsMessage.slice(0, FATAL_JS_MESSAGE_LIMIT);
  }
  if (typeof o.thread === "string") report.thread = o.thread;
  if (typeof o.cause === "string") report.cause = o.cause;
  return report;
}

/** True when the native crash was React Native turning a JS error into a fatal. */
export function isFatalJsError(report: FatalReport): boolean {
  return (
    report.jsMessage != null ||
    report.name.startsWith("RCTFatalException") ||
    report.kind.endsWith("JavascriptException")
  );
}

// ---------------------------------------------------------------------------
// JS side: the report the global handler writes before React Native turns a
// fatal JS error into a native crash, merging with the native one, and the
// optional text that rides along with a feedback message.
// ---------------------------------------------------------------------------

/** Error text can quote user input, so only this much of it is ever kept. */
export const MAX_JS_MESSAGE_CHARS = 500;
export const MAX_STACK_LINES = 40;
const MAX_STACK_LINE_CHARS = 300;
/** Stack lines that ride along with a feedback message. */
export const FEEDBACK_STACK_LINES = 20;
export const FEEDBACK_SEPARATOR = "\n\n---\n";
/** Below this much room left the report part is dropped instead of cut to a stub. */
export const FEEDBACK_MIN_REPORT_CHARS = 60;

export const FATAL_JS_STORAGE_KEY = "zerospike.fatalReport.js";

function clip(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
}

export interface FatalContext {
  platform: "ios" | "android";
  build: string;
  version: string;
  now: () => Date;
}

/** Error-like value (or anything thrown) to a stored report: text and stack only, both capped. */
export function buildJsFatalReport(error: unknown, ctx: FatalContext): FatalReport {
  const e = (error != null && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const name = typeof e.name === "string" && e.name ? e.name : "Error";
  const message =
    typeof e.message === "string" ? e.message : typeof error === "string" ? error : "";
  const stackRaw = typeof e.stack === "string" ? e.stack : "";
  const stack = stackRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_STACK_LINES)
    .map((l) => clip(l, MAX_STACK_LINE_CHARS));
  const reason = clip(message, MAX_JS_MESSAGE_CHARS);
  return {
    platform: ctx.platform,
    kind: "JSError",
    name: clip(name, 100),
    reason,
    jsMessage: reason,
    stack,
    build: ctx.build,
    version: ctx.version,
    at: ctx.now().toISOString(),
  };
}

export interface FatalHandlerDeps {
  /** The handler that was installed before ours (null when there is none). */
  previous: ((error: unknown, isFatal?: boolean) => void) | null;
  /** Fire-and-forget store write; may reject, never awaited here. */
  save: (report: FatalReport) => Promise<unknown> | void;
  context: () => FatalContext;
}

/**
 * Wraps the existing global error handler. A fatal error is recorded first, then
 * the previous handler runs exactly as it would have: nothing here changes what
 * React Native does with the error, and nothing here may throw.
 */
export function createFatalHandler(deps: FatalHandlerDeps): (error: unknown, isFatal?: boolean) => void {
  return (error, isFatal) => {
    if (isFatal) {
      try {
        const pending = deps.save(buildJsFatalReport(error, deps.context()));
        if (pending && typeof (pending as Promise<unknown>).catch === "function") {
          (pending as Promise<unknown>).catch(() => {});
        }
      } catch {
        // recording must never get in the way of the real handler
      }
    }
    deps.previous?.(error, isFatal);
  };
}

function atMs(report: FatalReport): number {
  const t = Date.parse(report.at);
  return Number.isNaN(t) ? -Infinity : t;
}

/** The newer of the native and the JS report; on a tie or unreadable dates the native one (it sees every crash). */
export function pickLatestReport(
  native: FatalReport | null,
  js: FatalReport | null
): FatalReport | null {
  if (!native) return js;
  if (!js) return native;
  return atMs(js) > atMs(native) ? js : native;
}

/** Calendar date of a report for the settings row (ISO date part, language-neutral); "" when unreadable. */
export function fatalReportDate(at: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : "";
}

/** Plain text of a report for the detail sheet, sharing and feedback. */
export function formatReportText(report: FatalReport, maxStackLines: number = MAX_STACK_LINES): string {
  const lines: string[] = [];
  if (report.at) lines.push(report.at);
  const ver = [report.version, report.build ? `(${report.build})` : ""].filter(Boolean).join(" ");
  lines.push(`${report.platform}${ver ? ` ${ver}` : ""}`);
  if (report.name) lines.push(report.name);
  if (report.reason && report.reason !== report.name) lines.push(report.reason);
  if (report.stack.length > 0) lines.push("", ...report.stack.slice(0, maxStackLines));
  return lines.join("\n");
}

/**
 * Appends the report under a "---" line without letting the whole message pass
 * `maxChars` (code points, the server's counting). The typed message is never
 * touched; the report part is cut to what is left, or dropped when too little is.
 */
export function appendReportToMessage(
  message: string,
  reportText: string,
  maxChars: number
): string {
  const room = maxChars - Array.from(message).length - Array.from(FEEDBACK_SEPARATOR).length;
  if (!reportText || room < FEEDBACK_MIN_REPORT_CHARS) return message;
  return message + FEEDBACK_SEPARATOR + clip(reportText, room).trimEnd();
}

/** The message that is sent: unchanged unless the user ticked the box and a report exists. */
export function composeFeedbackMessage(
  message: string,
  report: FatalReport | null,
  attach: boolean,
  maxChars: number
): string {
  if (!attach || !report) return message;
  return appendReportToMessage(message, formatReportText(report, FEEDBACK_STACK_LINES), maxChars);
}
