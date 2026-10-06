import {
  isFirebaseOnlyEvent,
  normalizeEventParams,
  sanitizeEvent,
  type FirebaseOnlyEventName,
  type SchemaEventName,
} from "./eventSchema";

/**
 * Analytics facade. Event emission is decoupled from the provider: the app doses
 * typed events through logEvent, and sinks (Firebase in lib/analytics/firebaseSink.ts,
 * Supabase in lib/analytics/supabaseSink.ts) are attached at bootstrap. Dev builds
 * also print every event to the console. Analytics must NEVER break a user flow,
 * so every call is wrapped and swallows its own errors.
 *
 * Firebase reserved event names are avoided on purpose (e.g. no app_open,
 * screen_view, session_start, first_open, purchase, ad_*).
 *
 * The Supabase sink only accepts the names and fields of schema v1
 * (./eventSchema). app_open and analytics_opt_out are produced by that sink
 * itself, so they are not part of the public name list.
 *
 * Call sites name a log kind as precisely as they like (injection, med, basal,
 * health_import ...); logEvent folds it into glucose, meal or other before any
 * sink sees it (normalizeEventParams). The few values only an insulin user can
 * produce (the "rotation" paywall source, the Spike open_injection_map action)
 * are folded the same way, so no sink can tell who uses insulin.
 * Consent is not checked here: every sink enforces it itself (./optOut), and
 * until the user opts in none of them collects or sends anything.
 */

export type AnalyticsEventName =
  | FirebaseOnlyEventName
  | Exclude<SchemaEventName, "app_open" | "analytics_opt_out">;

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
 * trigger, see lib/afterLogsPaywall.ts. "rotation" is the insulin-only tab: it
 * leaves the device as "feature" (normalizeEventParams).
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

const analyticsSinks = new Map<string, AnalyticsSink>();
let crashSink: CrashSink | null = null;

/**
 * Registers an analytics provider under a slot name; every registered sink gets
 * every event. Firebase keeps the default slot, so its call shape is unchanged.
 * Pass null to detach the slot.
 */
export function setAnalyticsSink(
  sink: AnalyticsSink | null,
  slot: string = "default"
): void {
  if (sink) analyticsSinks.set(slot, sink);
  else analyticsSinks.delete(slot);
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

const warnedSchemaIssues = new Set<string>();

// Dev only, once per distinct problem: the Supabase sink drops these silently in
// production, so this is the only place a stale call site gets noticed.
function warnSchemaIssues(name: string, params?: AnalyticsParams): void {
  if (isFirebaseOnlyEvent(name)) return;
  for (const issue of sanitizeEvent(name, params).issues) {
    const key = `${name}|${issue}`;
    if (warnedSchemaIssues.has(key)) continue;
    warnedSchemaIssues.add(key);
    console.warn(`[analytics] ${name}: ${issue}`);
  }
}

export function logEvent(name: AnalyticsEventName, params?: AnalyticsParams): void {
  try {
    const cleaned = normalizeEventParams(name, clean(params));
    // Dev always mirrors to the console so the event stream stays inspectable
    // even once the real Firebase sink is attached in production builds.
    if (__DEV__) {
      console.log(`[analytics] ${name}`, cleaned ?? {});
      warnSchemaIssues(name, cleaned);
    }
    for (const sink of analyticsSinks.values()) {
      try {
        sink(name, cleaned);
      } catch {
        // one failing sink must not starve the others
      }
    }
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
