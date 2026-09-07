/**
 * Analytics facade. Event emission is decoupled from the provider: the app doses
 * typed events through logEvent, and a sink (Firebase, wired in
 * lib/analytics/firebaseSink.ts) is attached at bootstrap. Dev builds also print
 * every event to the console. Analytics must NEVER break a user flow, so every
 * call is wrapped and swallows its own errors.
 *
 * Firebase reserved event names are avoided on purpose (e.g. no app_open,
 * screen_view, session_start, first_open, purchase, ad_*).
 */

export type AnalyticsEventName =
  | "onboarding_step"
  | "onboarding_done"
  | "log_added"
  | "log_edited"
  | "paywall_view"
  | "paywall_dismiss"
  | "paywall_tier_selected"
  | "downsell_view"
  | "downsell_accept"
  | "downsell_dismiss"
  | "downsell_skipped_no_discount"
  | "winback_view"
  | "trial_started"
  | "trial_reminder_opened"
  | "purchase_completed"
  | "tokluk_timer_started"
  | "sos_opened"
  | "sos_action"
  | "report_generated"
  | "insights_view"
  | "review_prompted"
  | "spike_opened"
  | "offerings_fallback_shown";

export type AnalyticsParams = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Known paywall_view sources (the route's `reason` param, echoed into
 * params.source). Not enforced at every entry screen - each already passes
 * its own literal - the trailing branded string keeps those compiling while
 * still giving the values this task cares about a real type. 2.3.4 dropped
 * "onboarding" as a paywall entry point (the reveal screen goes straight to
 * the dashboard now) and added "after_logs": the dashboard's own log-count
 * trigger, see lib/afterLogsPaywall.ts.
 */
export type PaywallViewSource =
  | "after_logs"
  | "direct"
  | "health"
  | "foods"
  | "profiles"
  | "rotation"
  | "mealResponse"
  | "spike"
  | "insights"
  | "export"
  | "settings"
  | (string & {});

type AnalyticsSink = (name: string, params?: AnalyticsParams) => void;
type CrashSink = (error: unknown, context?: AnalyticsParams) => void;

let analyticsSink: AnalyticsSink | null = null;
let crashSink: CrashSink | null = null;

/** Registers the real analytics provider (Firebase). Pass null to detach. */
export function setAnalyticsSink(sink: AnalyticsSink | null): void {
  analyticsSink = sink;
}

/** Registers the real crash reporter (Crashlytics). Pass null to detach. */
export function setCrashSink(sink: CrashSink | null): void {
  crashSink = sink;
}

// Firebase rejects undefined param values, so strip them before forwarding.
function clean(params?: AnalyticsParams): AnalyticsParams | undefined {
  if (!params) return undefined;
  const out: AnalyticsParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function logEvent(name: AnalyticsEventName, params?: AnalyticsParams): void {
  try {
    const cleaned = clean(params);
    // Dev always mirrors to the console so the event stream stays inspectable
    // even once the real Firebase sink is attached in production builds.
    if (__DEV__) console.log(`[analytics] ${name}`, cleaned ?? {});
    if (analyticsSink) analyticsSink(name, cleaned);
  } catch {
    // never let analytics break a user flow
  }
}

export function logCrash(error: unknown, context?: AnalyticsParams): void {
  try {
    if (__DEV__) console.warn("[analytics:crash]", error, context ?? {});
    if (crashSink) crashSink(error, clean(context));
  } catch {
    // never let crash reporting break a user flow
  }
}
