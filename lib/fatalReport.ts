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
  /** ISO 8601, UTC on Android. */
  at: string;
  thread?: string;
  cause?: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
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
    at: str(o.at),
  };
  if (typeof o.jsMessage === "string" && o.jsMessage.length > 0) report.jsMessage = o.jsMessage;
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
