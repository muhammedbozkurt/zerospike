/**
 * Analytics event schema v5: the one list of event names and fields the
 * Supabase sink may send. The server (supabase/functions/_shared/event-schema.json)
 * drops anything outside it as well, and scripts/analyticsSchema.test.ts fails
 * when the two lists drift. Dependency-free on purpose so that test can run
 * under plain node.
 */

export const SCHEMA_VERSION = 5;

/**
 * Constant tag of the paywall layout generation (build 93 redesign), carried by
 * the funnel events so the old and the new layout can be compared. Never a user
 * attribute: every user on this build sends the same number.
 */
export const PAYWALL_VERSION = 2;

/**
 * What a log entry is, as far as analytics may know: a glucose reading, a meal,
 * or anything else (injections, basal doses, medication, Health imports). The
 * finer kinds would let a reader of the table tell who uses insulin or pills.
 */
export const LOG_KINDS = ["glucose", "meal", "other"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/**
 * "int" and "bool" are plain scalars. "string" is a short ASCII identifier, never
 * free text (see coerce below); an array is a closed enum. "logKind" is an
 * identifier that the call site may name as precisely as it likes: it leaves the
 * device only as one of LOG_KINDS (see normalizeLogKind), and on the wire it is
 * that enum.
 */
export type FieldSpec = "string" | "int" | "bool" | "logKind" | readonly string[];
export type EventSpec = Readonly<Record<string, FieldSpec>>;

/**
 * Where a paywall visit came from (the route's `reason` param), as a closed
 * set. "rotation" never leaves the device: it is folded into "feature".
 */
export const PAYWALL_REASONS = [
  "after_logs",
  "direct",
  "health",
  "foods",
  "profiles",
  "feature",
  "mealResponse",
  "spike",
  "insights",
  "export",
  "settings",
] as const;

export const EVENT_SCHEMA = {
  app_open: { cold: "bool" },
  onboarding_step: { step: "string", index: "int" },
  onboarding_done: {},
  first_log: { kind: LOG_KINDS },
  log_added: { kind: "logKind" },
  log_edited: { kind: "logKind" },
  paywall_view: {
    source: "string",
    context: "string",
    trial_eligible: "bool",
    variant: ["default"],
    paywall_version: "int",
  },
  paywall_tier_selected: { tier: ["monthly", "annual", "lifetime"], paywall_version: "int" },
  paywall_cta: { tier: ["monthly", "annual", "lifetime"], paywall_version: "int" },
  paywall_dismiss: { source: "string", paywall_version: "int" },
  purchase_completed: { tier: "string", source: "string", paywall_version: "int" },
  purchase_result: {
    result: ["success", "cancelled", "error"],
    product: ["monthly", "annual", "lifetime", "downsell_annual"],
    reason: PAYWALL_REASONS,
    variant: ["default"],
    trial: "bool",
    detail: ["store_error", "already_owned", "none"],
    paywall_version: "int",
  },
  trial_started: { tier: "string" },
  pro_welcome_view: {},
  pro_welcome_step: { step: ["health", "insights", "reminders"], done: "bool" },
  health_connected: { platform: ["ios", "android"], imported: "int" },
  insights_view: { range_days: "int", during_trial: "bool" },
  export_pdf: { during_trial: "bool" },
  trial_reminder_scheduled: { days_before: "int" },
  trial_reminder_opened: {},
  trial_day1_nudge_sent: {},
  entitlement_lost: { period_type: ["trial", "normal", "intro", "unknown"] },
  winback_view: {},
  downsell_view: { trigger: "string" },
  downsell_accept: { trigger: "string" },
  downsell_dismiss: { trigger: "string" },
  downsell_skipped_no_discount: {},
  spike_opened: {},
  spike_message_sent: { has_context: "bool", tier: ["free", "pro"] },
  spike_reply: {
    latency_ms: "int",
    filtered: "bool",
    actions: "int",
    streamed: "bool",
  },
  spike_feedback: { value: ["up", "down"] },
  spike_action_tap: { action: "string" },
  spike_context_consent: { granted: "bool" },
  carb_estimate_used: {
    tier: ["free", "pro"],
    item_count: "int",
    source: ["food_tab", "meal_sheet"],
  },
  carb_estimate_blocked: { reason: ["quota", "filtered", "error"] },
  meal_builder_opened: {},
  carb_estimate_requested: { tier: ["free", "pro"], source: ["food_tab", "meal_sheet"] },
  carb_estimate_accepted: { item_count: "int" },
  portion_chip_used: { kind: ["measure", "grams"] },
  analytics_opt_out: { enabled: "bool" },
  store_review_prompt: {
    trigger: ["log_saved", "streak_7", "weekly_insights_view", "pdf_export_success"],
  },
  feedback_sent: {
    kind: ["suggestion", "bug", "other", "cancel_survey"],
    reason_code: [
      "expensive",
      "not_used",
      "missing_feature",
      "bug",
      "other_app",
      "other",
      "none",
    ],
  },
} as const satisfies Record<string, EventSpec>;

export type SchemaEventName = keyof typeof EVENT_SCHEMA;

export type PropValue = string | number | boolean;

export type SanitizeResult =
  | { ok: true; props: Record<string, PropValue>; issues: string[] }
  | { ok: false; issues: string[] };

// What the server accepts as a "string" prop: a short ASCII identifier with at
// least one letter, so a bare number (a glucose value) or a sentence cannot pass
// as one. A longer or looser string is dropped here, never cut or cleaned up.
const IDENTIFIER = /^[A-Za-z0-9_.:\/-]{1,64}$/;
const HAS_LETTER = /[A-Za-z]/;

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Folds a log kind into LOG_KINDS: glucose and meal stay, every other
 * identifier (injection, basal, med, health_import, ...) becomes "other". A
 * value that is not an identifier (a number, a sentence) is not a kind at all
 * and comes back undefined, so it can never pass as one.
 */
export function normalizeLogKind(value: unknown): LogKind | undefined {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || !HAS_LETTER.test(value)) {
    return undefined;
  }
  return value === "glucose" || value === "meal" ? value : "other";
}

/** Events whose `kind` is folded into LOG_KINDS before it reaches any sink. */
export const LOG_KIND_EVENTS = ["first_log", "log_added", "log_edited"] as const;

type LooseParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Field values that only one kind of user can produce, replaced by a neutral
 * one before any sink sees them: "rotation" is the paywall entry of the
 * injection tab, and open_injection_map is the Spike button for that same tab.
 * Left as they are, both would tell the table who uses insulin.
 */
const FOLDED_VALUES: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = {
  paywall_view: { source: { rotation: "feature" }, context: { rotation: "feature" } },
  paywall_dismiss: { source: { rotation: "feature" } },
  purchase_completed: { source: { rotation: "feature" } },
  purchase_result: { reason: { rotation: "feature" } },
  spike_action_tap: { action: { open_injection_map: "open_feature" } },
};

/**
 * The one place a call site's own wording is reduced to what analytics may
 * carry. logEvent runs it before any sink sees the event, so the
 * Supabase outbox gets the folded values: a log `kind` becomes glucose,
 * meal or other (and is removed when it is not an identifier), and the values
 * in FOLDED_VALUES become their neutral name. Other events and fields pass
 * through untouched.
 */
export function normalizeEventParams(name: string, params: LooseParams | undefined): LooseParams | undefined {
  if (!params) return params;
  let out = params;
  if ((LOG_KIND_EVENTS as readonly string[]).includes(name) && hasOwn(out, "kind")) {
    const { kind, ...rest } = out;
    const folded = normalizeLogKind(kind);
    out = folded === undefined ? rest : { ...rest, kind: folded };
  }
  const folds = hasOwn(FOLDED_VALUES, name) ? FOLDED_VALUES[name] : undefined;
  if (folds) {
    for (const [field, neutral] of Object.entries(folds)) {
      const value = out[field];
      if (typeof value === "string" && hasOwn(neutral, value)) {
        out = { ...out, [field]: neutral[value] };
      }
    }
  }
  return out;
}

function coerce(spec: FieldSpec, value: unknown): PropValue | undefined {
  if (spec === "string") {
    return typeof value === "string" && IDENTIFIER.test(value) && HAS_LETTER.test(value)
      ? value
      : undefined;
  }
  if (spec === "logKind") return normalizeLogKind(value);
  if (spec === "int") {
    // A fractional measurement (a latency in ms) is rounded rather than lost.
    const rounded = typeof value === "number" ? Math.round(value) : Number.NaN;
    return Number.isSafeInteger(rounded) ? rounded : undefined;
  }
  if (spec === "bool") return typeof value === "boolean" ? value : undefined;
  return typeof value === "string" && spec.includes(value) ? value : undefined;
}

function describeSpec(spec: FieldSpec): string {
  if (spec === "string") {
    return "an ASCII identifier (letters, digits and _ . : / -, one letter at least, no spaces, 64 chars at most)";
  }
  if (spec === "int") return "a number";
  if (spec === "bool") return "a boolean";
  if (spec === "logKind") {
    return `an ASCII identifier (sent as one of ${LOG_KINDS.join("|")})`;
  }
  return `one of ${spec.join("|")}`;
}

/**
 * Checks one event against the schema. An unknown name is rejected outright.
 * An unknown or wrongly typed field is stripped and reported, a missing field
 * is only reported: the event still goes out and the server decides what to do
 * with it, so a call site that lags behind the schema never loses its event
 * on the client side.
 */
export function sanitizeEvent(
  name: string,
  params?: Readonly<Record<string, unknown>>
): SanitizeResult {
  if (!hasOwn(EVENT_SCHEMA, name)) {
    return { ok: false, issues: [`not in event schema v${SCHEMA_VERSION}`] };
  }
  const spec: EventSpec = EVENT_SCHEMA[name as SchemaEventName];
  const props: Record<string, PropValue> = {};
  const issues: string[] = [];
  const reported = new Set<string>();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    if (!hasOwn(spec, key)) {
      issues.push(`unknown field "${key}" (dropped)`);
      reported.add(key);
      continue;
    }
    const coerced = coerce(spec[key], value);
    if (coerced === undefined) {
      issues.push(`field "${key}" must be ${describeSpec(spec[key])} (dropped)`);
      reported.add(key);
      continue;
    }
    props[key] = coerced;
  }

  for (const key of Object.keys(spec)) {
    if (!hasOwn(props, key) && !reported.has(key)) {
      issues.push(`missing field "${key}"`);
    }
  }
  return { ok: true, props, issues };
}
