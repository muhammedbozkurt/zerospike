import { logCrash } from "./analytics";

type ErrorUtilsLike = { reportFatalError?: (error: unknown) => void };

/**
 * Runs a synchronous module load (usually `() => require("some-native-pkg")`)
 * and turns a throwing module factory into null, logged, instead of a crash.
 *
 * A plain try/catch is NOT enough. When a module is first required outside the
 * initial bundle evaluation (any async path, e.g. an effect or `await import`),
 * Metro's guardedLoadModule hands the factory's error to
 * ErrorUtils.reportFatalError, which in a release build ends in RCTFatal, and
 * only afterwards returns undefined to the caller. Build 90 died exactly so:
 * `await import("react-native")` enumerated every lazy getter of the RN index,
 * PushNotificationIOS's factory threw (no native module linked) and the app
 * was killed although the call sat in a try/catch. For the duration of `load`
 * the fatal reporter is swapped for a collector, so the error surfaces here.
 */
export function safeRequire<T>(load: () => T, op: string): T | null {
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const original = utils?.reportFatalError;
  let reported = false;
  let reportedError: unknown;
  if (utils && original) {
    utils.reportFatalError = (error: unknown) => {
      reported = true;
      reportedError = error;
    };
  }
  try {
    const value = load();
    if (reported) throw reportedError;
    return value ?? null;
  } catch (err) {
    logCrash(err, { screen: "native", op });
    return null;
  } finally {
    if (utils && original) utils.reportFatalError = original;
  }
}

/** A native call whose failure must only switch the feature off. */
export function tryNative<T>(fn: () => T, fallback: T, op: string): T {
  const value = safeRequire(fn, op);
  return value === null ? fallback : value;
}
