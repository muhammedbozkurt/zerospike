import { normalizeEventParams, sanitizeEvent, type SchemaEventName } from "./eventSchema";

/**
 * Analytics facade. Event emission is decoupled from the provider: the app doses
 * typed events through logEvent, and the sink (Supabase, lib/analytics/supabaseSink.ts)
 * is attached at bootstrap. Dev builds also print every event to the console. Analytics must NEVER break a user flow,
 * so every call is wrapped and swallows its own errors.
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
  Exclude<SchemaEventName, "app_open" | "analytics_opt_out">;

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
  | "nightscout"
  | "carbEstimate"
  | "cgmHistory"
  | (string & {});

type AnalyticsSink = (name: string, params?: AnalyticsParams) => void;

const analyticsSinks = new Map<string, AnalyticsSink>();

/**
 * Registers an analytics provider under a slot name; every registered sink gets
 * every event.
 * Pass null to detach the slot.
 */
export function setAnalyticsSink(
  sink: AnalyticsSink | null,
  slot: string = "default"
): void {
  if (sink) analyticsSinks.set(slot, sink);
  else analyticsSinks.delete(slot);
}

// Undefined param values are stripped before forwarding.
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
    // Dev mirrors every event to the console so the event stream stays inspectable.
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

/** Local error log only: console output, nothing is sent over the network or to an SDK. */
export function logCrash(error: unknown, context?: AnalyticsParams): void {
  try {
    const detail = error instanceof Error ? (error.stack ?? String(error)) : error;
    const log = __DEV__ ? console.warn : console.error;
    log("[crash]", detail, clean(context) ?? {});
  } catch {
    // never let error logging break a user flow
  }
}
