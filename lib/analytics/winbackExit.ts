import type { AnalyticsEventName, AnalyticsParams } from "./index";

type Log = (name: AnalyticsEventName, params?: AnalyticsParams) => void;

/**
 * Every way out of the winback that is not a purchase (X, "not now", Android
 * back, iOS swipe down) is one dismissal, logged once and only when the offer
 * was actually shown. A purchase logs none.
 */
export function createWinbackExit(logEvent: Log) {
  let viewed = false;
  let purchased = false;
  let done = false;
  return {
    viewed(): void {
      viewed = true;
    },
    purchased(): void {
      purchased = true;
    },
    closed(): void {
      if (done || !viewed || purchased) return;
      done = true;
      logEvent("winback_dismiss");
      logEvent("downsell_dismiss", { trigger: "winback" });
    },
  };
}
