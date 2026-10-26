/**
 * Standalone harness for the analytics layer's pure parts: the v1 event schema
 * (and its server-side twin supabase/functions/_shared/event-schema.json), the
 * sanitizer, session rotation, batching, retry and response policy, and the
 * analytics_queue SQL. No jest; compile + run with node (run from the repo root):
 *
 *   npx tsc scripts/analyticsSchema.test.ts lib/analytics/eventSchema.ts \
 *     lib/analytics/session.ts lib/analytics/flush.ts lib/analytics/queue.ts \
 *     lib/db/v24Sql.ts --ignoreConfig \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution bundler --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/analyticsSchema.test.js
 *
 * The server comparison is skipped (not failed) while
 * supabase/functions/_shared/event-schema.json does not exist; once it does, any
 * difference in event names, field names or field types fails here.
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  EVENT_SCHEMA,
  LOG_KINDS,
  SCHEMA_VERSION,
  normalizeEventParams,
  normalizeLogKind,
  sanitizeEvent,
  type EventSpec,
  type FieldSpec,
} from "../lib/analytics/eventSchema";
import {
  SESSION_IDLE_MS,
  WARM_OPEN_MIN_BACKGROUND_MS,
  createSessionTracker,
} from "../lib/analytics/session";
import {
  BACKOFF_MAX_MS,
  FLUSH_BATCH_SIZE,
  MAX_BATCHES_PER_FLUSH,
  RETRY_AFTER_MAX_MS,
  backoffDelayMs,
  classifyResponse,
  createFlusher,
  nextBatch,
  parseRetryAfter,
  type FlushStore,
  type QueuedEvent,
  type SendResult,
} from "../lib/analytics/flush";
import { QUEUE_MAX_ROWS, createQueue, type QueueDb } from "../lib/analytics/queue";
import { V24_CREATE } from "../lib/db/v24Sql";

const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => any;
};

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const ROOT = (() => {
  const isRoot = (dir: string) =>
    fs.existsSync(nodePath.join(dir, "package.json")) &&
    fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (isRoot(dir)) return dir;
    dir = nodePath.dirname(dir);
  }
  if (isRoot(process.cwd())) return process.cwd();
  throw new Error("could not locate the repo root from " + __dirname);
})();

function src(rel: string): string {
  return fs.readFileSync(nodePath.join(ROOT, rel), "utf8");
}

const MIN = 60_000;
const SNAKE = /^[a-z][a-z0-9_]{0,39}$/;
const OK: SendResult = { status: "ok" };
const DROP: SendResult = { status: "drop" };
const RETRY: SendResult = { status: "retry" };
const specOf = (name: string): EventSpec => (EVENT_SCHEMA as Record<string, EventSpec>)[name];

/**
 * One canonical string per field type, shared by the TS and JSON sides. A
 * "logKind" field takes any identifier from the call site but only ever leaves
 * the device as a LOG_KINDS member, so on the wire (and in the server's JSON)
 * it is that enum.
 */
function canon(spec: FieldSpec): string {
  if (spec === "logKind") return "enum:" + [...LOG_KINDS].sort().join("|");
  return typeof spec === "string" ? spec : "enum:" + [...spec].sort().join("|");
}

type Canonical = Map<string, Map<string, string>>;

function canonicalSchema(): Canonical {
  const out: Canonical = new Map();
  for (const name of Object.keys(EVENT_SCHEMA)) {
    out.set(
      name,
      new Map(Object.entries(specOf(name)).map(([field, type]) => [field, canon(type)]))
    );
  }
  return out;
}

// The card's own text, parsed independently of eventSchema.ts. A field written
// without a type is a string.
function matchesContract(): void {
  section("A. schema v6 matches the written contract");
  const CONTRACT = [
    "app_open{cold:bool}",
    "onboarding_step{step:string,index:int}",
    "onboarding_done{}",
    "first_log{kind:glucose|meal|other}",
    "log_added{kind:glucose|meal|other}",
    "log_edited{kind:glucose|meal|other}",
    "paywall_view{source,context,trial_eligible:bool,variant:enum:default,paywall_version:int}",
    "paywall_tier_selected{tier:monthly|annual|lifetime,paywall_version:int}",
    "paywall_cta{tier:monthly|annual|lifetime,paywall_version:int}",
    "paywall_dismiss{source,paywall_version:int}",
    "purchase_completed{tier,source,paywall_version:int}",
    "purchase_result{result:success|cancelled|error,product:monthly|annual|lifetime|downsell_annual,reason:after_logs|direct|health|foods|profiles|feature|mealResponse|spike|insights|export|settings,variant:enum:default,trial:bool,detail:store_error|already_owned|none,paywall_version:int,source:paywall|apple_winback|downsell}",
    "trial_started{tier}",
    "pro_welcome_view{}",
    "pro_welcome_step{step:health|insights|reminders,done:bool}",
    "health_connected{platform:ios|android,imported:int}",
    "insights_view{range_days:int,during_trial:bool}",
    "export_pdf{during_trial:bool}",
    "trial_reminder_scheduled{days_before:int}",
    "trial_reminder_opened{}",
    "trial_day1_nudge_sent{}",
    "entitlement_lost{period_type:trial|normal|intro|unknown}",
    "winback_view{}",
    "winback_dismiss{}",
    "restore_result{result:success|empty|error|cancelled}",
    "downsell_view{trigger}",
    "downsell_accept{trigger}",
    "downsell_dismiss{trigger}",
    "downsell_skipped_no_discount{}",
    "spike_opened{}",
    "spike_message_sent{has_context:bool,tier:free|pro}",
    "spike_reply{latency_ms:int,filtered:bool,actions:int,streamed:bool}",
    "spike_feedback{value:up|down}",
    "spike_action_tap{action}",
    "spike_context_consent{granted:bool}",
    "carb_estimate_used{tier:free|pro,item_count:int,source:food_tab|meal_sheet}",
    "carb_estimate_blocked{reason:quota|filtered|error}",
    "meal_builder_opened{}",
    "carb_estimate_requested{tier:free|pro,source:food_tab|meal_sheet}",
    "carb_estimate_accepted{item_count:int}",
    "portion_chip_used{kind:measure|grams}",
    "analytics_opt_out{enabled:bool}",
    "store_review_prompt{trigger:log_saved|streak_7|weekly_insights_view|pdf_export_success}",
    "feedback_sent{kind:suggestion|bug|other|cancel_survey,reason_code:expensive|not_used|missing_feature|bug|other_app|other|none}",
  ];
  const expected: Canonical = new Map();
  for (const line of CONTRACT) {
    const m = /^(\w+)\{(.*)\}$/.exec(line);
    if (!m) throw new Error("bad contract line " + line);
    const fields = new Map<string, string>();
    for (const part of m[2] === "" ? [] : m[2].split(",")) {
      const [field, rawType] = part.split(":");
      if (rawType === undefined) fields.set(field, "string");
      else if (rawType === "enum") fields.set(field, "enum:" + (part.split(":")[2] ?? ""));
      else if (rawType.includes("|")) {
        fields.set(field, "enum:" + rawType.split("|").sort().join("|"));
      } else fields.set(field, rawType);
    }
    expected.set(m[1], fields);
  }

  const actual = canonicalSchema();
  eq("44 events in the contract", expected.size, 44);
  eq("schema version is 6", SCHEMA_VERSION, 6);
  eq("event count", actual.size, expected.size);
  for (const [name, fields] of expected) {
    const got = actual.get(name);
    ok(`${name} exists`, got !== undefined);
    if (!got) continue;
    eq(`${name} fields`, [...got.entries()].sort(), [...fields.entries()].sort());
  }
  for (const name of actual.keys()) {
    ok(`${name} is in the contract`, expected.has(name));
  }
}

function schemaHygiene(): void {
  section("B. schema hygiene");
  const names = Object.keys(EVENT_SCHEMA);
  // 40 chars, snake_case.
  ok(
    "event and field names are snake_case and at most 40 chars",
    names.every(
      (n) => SNAKE.test(n) && Object.keys(specOf(n)).every((f) => SNAKE.test(f))
    )
  );
  ok(
    "every enum is non-empty and duplicate free",
    names.every((n) =>
      Object.values(specOf(n)).every(
        (spec) =>
          typeof spec === "string" || (spec.length > 0 && new Set(spec).size === spec.length)
      )
    )
  );
  // The data boundary: no schema field may carry a health value.
  const HEALTH_FIELD = /glucose|mgdl|mmol|carb|insulin|dose|unit|weight|bmi|a1c|reading/;
  const offenders: string[] = [];
  for (const name of names) {
    for (const field of Object.keys(specOf(name))) {
      if (HEALTH_FIELD.test(field)) offenders.push(`${name}.${field}`);
    }
  }
  eq("no field named after a health value", offenders, []);

  // What the table may know about the onboarding path and about a log entry:
  // not which treatment someone uses, and not whether they log insulin or pills.
  eq("onboarding_done carries no field: neither a path nor a screen count that gives it away", Object.keys(specOf("onboarding_done")), []);
  eq("LOG_KINDS", [...LOG_KINDS], ["glucose", "meal", "other"]);
  for (const name of ["first_log", "log_added", "log_edited"]) {
    eq(`${name}.kind is the three log kinds on the wire`, canon(specOf(name).kind), "enum:glucose|meal|other");
  }
  const FINE_KIND = /injection|basal|bolus|insulin|\bmed\b|pill|health_import/;
  const fine: string[] = [];
  for (const name of names) {
    for (const [field, spec] of Object.entries(specOf(name))) {
      if (typeof spec !== "string" && spec.some((v) => FINE_KIND.test(v))) fine.push(`${name}.${field}`);
    }
  }
  eq("no enum value names an insulin, injection or medication kind", fine, []);
  ok(
    "the retired names are gone",
    !["report_generated", "review_prompted"].some((n) => n in EVENT_SCHEMA)
  );
}

function sanitizer(): void {
  section("C. sanitizeEvent");
  const good = sanitizeEvent("spike_reply", {
    latency_ms: 812,
    filtered: false,
    actions: 2,
    streamed: true,
  });
  ok("valid event is ok", good.ok);
  if (good.ok) {
    eq("props pass through", good.props, {
      latency_ms: 812,
      filtered: false,
      actions: 2,
      streamed: true,
    });
    eq("no issues", good.issues, []);
  }

  ok("unknown name is rejected", !sanitizeEvent("not_an_event", { a: 1 }).ok);
  for (const proto of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    ok(`prototype key ${proto} is not an event`, !sanitizeEvent(proto, {}).ok);
  }

  const legacy = sanitizeEvent("log_added", { source: "template" });
  ok("a legacy call site still yields an event", legacy.ok);
  if (legacy.ok) {
    eq("the unknown field is stripped", legacy.props, {});
    ok("and reported", legacy.issues.some((i) => i.includes('unknown field "source"')));
    ok(
      "and the missing kind is reported",
      legacy.issues.some((i) => i.includes('missing field "kind"'))
    );
  }

  const health = sanitizeEvent("log_added", { kind: "glucose", value: 142, glucose: 142 });
  ok("health values never pass", health.ok);
  if (health.ok) eq("only the kind survives", health.props, { kind: "glucose" });

  for (const result of ["success", "empty", "error", "cancelled"]) {
    const restored = sanitizeEvent("restore_result", { result });
    ok(`restore_result ${result} passes`, restored.ok && restored.props.result === result);
  }
  const badRestore = sanitizeEvent("restore_result", { result: "none" });
  ok("restore_result outside the enum keeps no result", badRestore.ok && !("result" in badRestore.props));
  const dismissed = sanitizeEvent("winback_dismiss", { reason: "x" });
  ok("winback_dismiss carries no fields", dismissed.ok && Object.keys(dismissed.props).length === 0);

  const badEnum = sanitizeEvent("paywall_tier_selected", { tier: "weekly", paywall_version: 2 });
  ok("enum violation is stripped", badEnum.ok && Object.keys(badEnum.props).length === 1 && badEnum.props.paywall_version === 2);
  if (badEnum.ok) {
    ok(
      "and reported once as wrong, not as missing",
      badEnum.issues.length === 1 && badEnum.issues[0].includes("one of")
    );
  }

  const sale = normalizeEventParams("purchase_result", {
    result: "error",
    product: "annual",
    reason: "rotation",
    variant: "default",
    trial: true,
    detail: "store_error",
    paywall_version: 2,
    source: "paywall",
  });
  const saleOut = sanitizeEvent("purchase_result", sale);
  ok("purchase_result carries only its eight closed fields", saleOut.ok && saleOut.issues.length === 0);
  if (saleOut.ok) {
    eq("the insulin-only paywall entry leaves as feature", saleOut.props.reason, "feature");
    eq("eight fields, no free text, no identity or price", Object.keys(saleOut.props).sort(), ["detail", "paywall_version", "product", "reason", "result", "source", "trial", "variant"]);
  }
  const winbackSale = sanitizeEvent("purchase_result", {
    result: "success",
    product: "downsell_annual",
    reason: "direct",
    variant: "default",
    trial: false,
    detail: "none",
    paywall_version: 2,
    source: "apple_winback",
  });
  ok("purchase_result carries the winback source", winbackSale.ok && winbackSale.issues.length === 0 && winbackSale.props.source === "apple_winback");
  const badSource = sanitizeEvent("purchase_result", { result: "success", source: "my own words" });
  ok("an unknown purchase source is dropped", badSource.ok && !("source" in badSource.props));
  const badSale = sanitizeEvent("purchase_result", {
    result: "error",
    product: "annual",
    reason: "my own words here",
    variant: "default",
    trial: false,
    detail: "boom",
  });
  ok("an unknown reason and detail are dropped, not carried", badSale.ok && !("reason" in badSale.props) && !("detail" in badSale.props));
  const badVariant = sanitizeEvent("paywall_view", { source: "direct", context: "inapp", trial_eligible: true, variant: "two words" });
  ok("a variant with a space is dropped", badVariant.ok && !("variant" in badVariant.props));

  // String props are ASCII identifiers: a letter, no spaces, 64 chars at most.
  const idents: [string, boolean][] = [
    ["direct", true],
    ["after_logs", true],
    ["mealResponse", true],
    ["a.b:c/d-e_f9", true],
    ["x".repeat(64), true],
    ["x".repeat(65), false],
    ["has space", false],
    ["tab\tseparated", false],
    ["142", false],
    ["1.5", false],
    ["-_-", false],
    ["", false],
    ["Öğün", false],
    ["café", false],
    ["emoji😀", false],
    ["new\nline", false],
    ["glucose 142 mg/dL", false],
  ];
  for (const [value, valid] of idents) {
    const res = sanitizeEvent("paywall_dismiss", { source: value });
    const kept = res.ok && res.props.source === value;
    eq(`source ${JSON.stringify(value.length > 20 ? value.slice(0, 12) + "..." : value)} is ${valid ? "kept" : "dropped"}`, kept, valid);
  }
  const smuggled = sanitizeEvent("log_added", { kind: "142" });
  ok("a bare number in a string prop is dropped", smuggled.ok && Object.keys(smuggled.props).length === 0);

  // Whatever the call site calls a log entry, only glucose, meal or other goes out.
  const folds: [string, string][] = [
    ["glucose", "glucose"],
    ["meal", "meal"],
    ["injection", "other"],
    ["basal", "other"],
    ["med", "other"],
    ["health_import", "other"],
    ["other", "other"],
  ];
  for (const name of ["log_added", "log_edited"]) {
    for (const [given, sent] of folds) {
      const res = sanitizeEvent(name, { kind: given });
      eq(`${name} kind ${given} goes out as ${sent}`, res.ok ? res.props.kind : null, sent);
      ok(`${name} kind ${given} is not a reported problem`, res.ok && res.issues.length === 0);
    }
    const sentence = sanitizeEvent(name, { kind: "two words" });
    ok(`${name}: a sentence is no kind at all`, sentence.ok && !("kind" in sentence.props));
  }
  const strictFirst = sanitizeEvent("first_log", { kind: "injection" });
  ok(
    "first_log stays a strict enum: a fine kind is dropped and reported",
    strictFirst.ok &&
      !("kind" in strictFirst.props) &&
      strictFirst.issues.some((i) => i.includes("one of glucose|meal|other"))
  );
  eq("first_log other is fine", (() => { const r = sanitizeEvent("first_log", { kind: "other" }); return r.ok ? r.props.kind : null; })(), "other");
  eq("normalizeLogKind folds an identifier", normalizeLogKind("basal"), "other");
  eq("normalizeLogKind keeps glucose", normalizeLogKind("glucose"), "glucose");
  eq("normalizeLogKind refuses a number", normalizeLogKind(142), undefined);
  eq("normalizeLogKind refuses a numeric string", normalizeLogKind("142"), undefined);
  const enumNotIdent = sanitizeEvent("health_connected", { platform: "ios", imported: 12 });
  ok("enums and ints are untouched by the identifier rule", enumNotIdent.ok && enumNotIdent.props.platform === "ios" && enumNotIdent.props.imported === 12);

  const badTypes = sanitizeEvent("insights_view", { range_days: "30", during_trial: "true" });
  ok(
    "string where number or bool belong is stripped",
    badTypes.ok && Object.keys(badTypes.props).length === 0
  );

  const nums = sanitizeEvent("spike_reply", {
    latency_ms: 812.6,
    filtered: false,
    actions: Number.NaN,
    streamed: true,
  });
  ok("spike_reply with a NaN field stays an event", nums.ok);
  if (nums.ok) {
    eq("ints are rounded", nums.props.latency_ms, 813);
    ok("NaN is stripped", !("actions" in nums.props));
  }
  const inf = sanitizeEvent("trial_reminder_scheduled", { days_before: Infinity });
  ok("Infinity is stripped", inf.ok && !("days_before" in inf.props));
  const huge = sanitizeEvent("trial_reminder_scheduled", { days_before: 2 ** 60 });
  ok("a number beyond the safe integers is stripped", huge.ok && !("days_before" in huge.props));

  const nulls = sanitizeEvent("paywall_dismiss", { source: null });
  ok("null counts as absent", nulls.ok && !("source" in nulls.props));

  const empty = sanitizeEvent("winback_view", undefined);
  ok("no params for a no-field event", empty.ok && empty.issues.length === 0);
}

function sessions(): void {
  section("D. session");
  let n = 0;
  const t = createSessionTracker(() => `s${++n}`);
  eq("a session exists from the start", t.id(), "s1");

  eq("foreground without a background is a no-op", t.onForeground(5_000), {
    rotated: false,
    warmOpen: false,
  });

  t.onBackground(1_000);
  eq(
    "a quick blip is not an app_open",
    t.onForeground(1_000 + WARM_OPEN_MIN_BACKGROUND_MS - 1),
    { rotated: false, warmOpen: false }
  );
  eq("and keeps the session", t.id(), "s1");

  t.onBackground(2_000);
  eq("a real return is an app_open", t.onForeground(2_000 + WARM_OPEN_MIN_BACKGROUND_MS), {
    rotated: false,
    warmOpen: true,
  });
  eq("in the same session", t.id(), "s1");

  t.onBackground(10_000);
  t.onBackground(99_999_999);
  eq(
    "a second background keeps the first timestamp",
    t.onForeground(10_000 + SESSION_IDLE_MS - 1).rotated,
    false
  );
  t.onBackground(10_000);
  eq("30 minutes away rotates", t.onForeground(10_000 + SESSION_IDLE_MS), {
    rotated: true,
    warmOpen: true,
  });
  eq("with a new id", t.id(), "s2");
  eq("SESSION_IDLE_MS is 30 minutes", SESSION_IDLE_MS, 30 * 60 * 1000);

  t.onBackground(50_000);
  eq("a clock that went backwards never rotates", t.onForeground(40_000), {
    rotated: false,
    warmOpen: false,
  });
}

function ev(id: number, sessionId = "s1", isPro = false, batchId: string | null = null): QueuedEvent {
  return {
    id,
    name: "log_added",
    props: { kind: "meal" },
    ts: "2026-01-01T00:00:00.000Z",
    sessionId,
    isPro,
    batchId,
  };
}

function arrayStore(rows: QueuedEvent[]): FlushStore & { rows: QueuedEvent[] } {
  return {
    rows,
    async peek(limit) {
      return rows.slice(0, limit).map((row) => ({ ...row }));
    },
    async tag(ids, batchId) {
      for (const row of rows) if (ids.includes(row.id)) row.batchId = batchId;
    },
    async remove(ids) {
      const gone = new Set(ids);
      for (let i = rows.length - 1; i >= 0; i--) if (gone.has(rows[i].id)) rows.splice(i, 1);
    },
  };
}

function counter(prefix = "b"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function backoffAndStatus(): void {
  section("E. backoff, Retry-After and response policy");
  eq(
    "1, 2, 4, 8, 16 then capped at 30 minutes",
    [1, 2, 3, 4, 5, 6, 7, 40].map((n) => backoffDelayMs(n) / MIN),
    [1, 2, 4, 8, 16, 30, 30, 30]
  );
  eq("BACKOFF_MAX_MS is 30 minutes", BACKOFF_MAX_MS, 30 * MIN);
  eq("zero failures still waits a minute", backoffDelayMs(0), MIN);

  const T0 = Date.parse("2026-10-06T10:00:00Z");
  eq("Retry-After in seconds", parseRetryAfter("1800", T0), 1_800_000);
  eq("Retry-After with padding", parseRetryAfter(" 60 ", T0), 60_000);
  eq("Retry-After of zero", parseRetryAfter("0", T0), 0);
  eq(
    "Retry-After as an HTTP date",
    parseRetryAfter(new Date(T0 + 90_000).toUTCString(), T0),
    90_000
  );
  eq("a date in the past waits nothing", parseRetryAfter(new Date(T0 - 5_000).toUTCString(), T0), 0);
  eq("an absurd Retry-After is capped", parseRetryAfter("99999999", T0), RETRY_AFTER_MAX_MS);
  eq("a missing header", parseRetryAfter(null, T0), undefined);
  eq("an empty header", parseRetryAfter("  ", T0), undefined);
  eq("an unreadable header", parseRetryAfter("soon", T0), undefined);
  eq("a negative number is unreadable", parseRetryAfter("-5", T0), undefined);

  const cases: [string, number, string | null, unknown, SendResult][] = [
    ["202 accepted", 202, null, { accepted: 3, dropped: 0 }, OK],
    ["202 with events dropped is still done", 202, null, { accepted: 1, dropped: 4 }, OK],
    ["202 duplicate", 202, null, { accepted: 0, dropped: 0, duplicate: true }, OK],
    ["200 without a body", 200, null, null, OK],
    ["duplicate on any status is done", 409, null, { duplicate: true }, OK],
    ["duplicate must be exactly true", 503, null, { duplicate: "true" }, RETRY],
    [
      "429 waits Retry-After",
      429,
      "1800",
      { error: "rate_limited" },
      { status: "retry", retryAfterMs: 1_800_000 },
    ],
    [
      "429 with an HTTP date",
      429,
      new Date(T0 + 90_000).toUTCString(),
      null,
      { status: "retry", retryAfterMs: 90_000 },
    ],
    ["429 without a header falls back to backoff", 429, null, null, RETRY],
    ["429 with an unreadable header falls back too", 429, "soon", null, RETRY],
    [
      "429 with a huge header is capped",
      429,
      "99999999",
      null,
      { status: "retry", retryAfterMs: RETRY_AFTER_MAX_MS },
    ],
    ["503 retries", 503, null, { error: "storage" }, RETRY],
    ["500 retries", 500, null, { error: "not_configured" }, RETRY],
    ["502 retries", 502, null, null, RETRY],
    ["401 retries", 401, null, null, RETRY],
    ["404 retries", 404, null, null, RETRY],
    ["408 retries", 408, null, null, RETRY],
    ["400 drops the batch", 400, null, { error: "bad_request" }, DROP],
    ["413 drops the batch", 413, null, null, DROP],
    ["422 drops the batch", 422, null, null, DROP],
  ];
  for (const [name, status, header, body, want] of cases) {
    eq(name, classifyResponse(status, header, body, T0), want);
  }

  eq(
    "a new batch stops at the first session or Pro change",
    nextBatch([ev(1, "a"), ev(2, "a"), ev(3, "b"), ev(4, "a")]).map((r) => r.id),
    [1, 2]
  );
  eq(
    "a new batch splits on is_pro",
    nextBatch([ev(1, "a", false), ev(2, "a", true)]).map((r) => r.id),
    [1]
  );
  eq(
    "a tagged batch is exactly its own rows",
    nextBatch([ev(1, "a", false, "x"), ev(2, "a", false, "x"), ev(3, "a"), ev(4, "a", false, "y")]).map((r) => r.id),
    [1, 2]
  );
  eq(
    "untagged rows do not join a tagged batch behind them",
    nextBatch([ev(1, "a"), ev(2, "a", false, "x")]).map((r) => r.id),
    [1]
  );
  eq("no rows, no batch", nextBatch([]), []);
}

async function flusherBehaviour(): Promise<void> {
  section("F. flusher");
  const MIN_CLOCK = { now: () => 0 };

  // Batches of 50, in order, until the queue is empty; every batch has its own id.
  {
    const store = arrayStore(Array.from({ length: 120 }, (_, i) => ev(i + 1)));
    const sent: { size: number; id: string; taggedBeforeSend: boolean }[] = [];
    const flusher = createFlusher({
      store,
      send: async (batch, batchId) => {
        sent.push({
          size: batch.length,
          id: batchId,
          taggedBeforeSend: store.rows
            .filter((row) => batch.some((b) => b.id === row.id))
            .every((row) => row.batchId === batchId),
        });
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq("120 events go out as 50 + 50 + 20", sent.map((s) => s.size), [50, 50, 20]);
    eq("each batch has a fresh id", sent.map((s) => s.id), ["b1", "b2", "b3"]);
    ok("rows are tagged before the request leaves", sent.every((s) => s.taggedBeforeSend));
    eq("a successful send deletes the rows", store.rows.length, 0);
    eq("FLUSH_BATCH_SIZE is 50", FLUSH_BATCH_SIZE, 50);
  }

  // One request carries one session and one Pro state.
  {
    const store = arrayStore([ev(1, "a"), ev(2, "a"), ev(3, "b"), ev(4, "b"), ev(5, "a")]);
    const seen: string[] = [];
    const flusher = createFlusher({
      store,
      send: async (batch, batchId) => {
        seen.push(`${batchId}:${batch[0].sessionId}x${batch.length}`);
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq("mixed sessions are sent apart, in order", seen, ["b1:ax2", "b2:bx2", "b3:ax1"]);
  }

  // A network error keeps the rows and the batch id, and backs off 1, 2, 4, 8, 16, 30, 30 minutes.
  {
    const store = arrayStore([ev(1)]);
    let clock = 1_000_000;
    const ids: string[] = [];
    let minted = 0;
    const flusher = createFlusher({
      store,
      send: async (_batch, batchId) => {
        ids.push(batchId);
        return RETRY;
      },
      newBatchId: () => `b${++minted}`,
      now: () => clock,
      canSend: () => true,
    });
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      await flusher.flush();
      delays.push((flusher.retryAt() - clock) / MIN);
      clock = flusher.retryAt();
    }
    eq("backoff walks 1, 2, 4, 8, 16, 30, 30", delays, [1, 2, 4, 8, 16, 30, 30]);
    eq("every attempt reached the network once", ids.length, 7);
    eq("and every retry reused the first batch id", [...new Set(ids)], ["b1"]);
    eq("one id was ever minted", minted, 1);
    eq("the rows are still queued", store.rows.length, 1);
  }

  // Inside the backoff window nothing is sent.
  {
    const store = arrayStore([ev(1)]);
    let clock = 0;
    let calls = 0;
    let result: SendResult = RETRY;
    const flusher = createFlusher({
      store,
      send: async () => {
        calls++;
        return result;
      },
      newBatchId: counter(),
      now: () => clock,
      canSend: () => true,
    });
    await flusher.flush();
    clock = MIN - 1;
    await flusher.flush();
    eq("a trigger inside the window is ignored", calls, 1);
    clock = MIN;
    result = OK;
    await flusher.flush();
    eq("and the next one after it sends", calls, 2);
    eq("success empties the queue", store.rows.length, 0);
    eq("and clears the backoff", flusher.retryAt(), 0);
  }

  // A retried batch is exactly what it was, however much was queued meanwhile.
  {
    const store = arrayStore([ev(1), ev(2)]);
    let clock = 0;
    let result: SendResult = RETRY;
    const seen: string[] = [];
    const flusher = createFlusher({
      store,
      send: async (batch, batchId) => {
        seen.push(`${batchId}:${batch.map((r) => r.id).join(",")}`);
        return result;
      },
      newBatchId: counter(),
      now: () => clock,
      canSend: () => true,
    });
    await flusher.flush();
    store.rows.push(ev(3), ev(4));
    clock = MIN;
    result = OK;
    await flusher.flush();
    eq(
      "the retry resends rows 1,2 under b1, then the newcomers get a new id",
      seen,
      ["b1:1,2", "b1:1,2", "b2:3,4"]
    );
    eq("everything is delivered", store.rows.length, 0);
  }

  // The same holds across a restart: the tag lives in the table, not in memory.
  {
    const store = arrayStore([ev(1, "a", false, "x"), ev(2, "a", false, "x"), ev(3, "a")]);
    const seen: string[] = [];
    let minted = 0;
    const flusher = createFlusher({
      store,
      send: async (batch, batchId) => {
        seen.push(`${batchId}:${batch.map((r) => r.id).join(",")}`);
        return OK;
      },
      newBatchId: () => `n${++minted}`,
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq("a tagged batch keeps its id in a fresh process", seen, ["x:1,2", "n1:3"]);
  }

  // Rows trimmed out of a tagged batch only make it smaller.
  {
    const store = arrayStore([ev(5, "a", false, "x"), ev(6, "a", false, "x")]);
    const seen: string[] = [];
    const flusher = createFlusher({
      store,
      send: async (batch, batchId) => {
        seen.push(`${batchId}:${batch.length}`);
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq("a trimmed batch is resent smaller under the same id", seen, ["x:2"]);
  }

  // A 429 waits exactly as long as the server said, and is not a backoff step.
  {
    const store = arrayStore([ev(1)]);
    let clock = 5_000;
    const results: SendResult[] = [
      { status: "retry", retryAfterMs: 1_800_000 },
      RETRY,
    ];
    const flusher = createFlusher({
      store,
      send: async () => results.shift() ?? OK,
      newBatchId: counter(),
      now: () => clock,
      canSend: () => true,
    });
    await flusher.flush();
    eq("Retry-After sets the wait", flusher.retryAt() - clock, 1_800_000);
    clock = flusher.retryAt() - 1;
    await flusher.flush();
    eq("nothing is sent a millisecond early", results.length, 1);
    clock = flusher.retryAt();
    await flusher.flush();
    eq("an ordinary failure afterwards starts the backoff at one minute", (flusher.retryAt() - clock) / MIN, 1);
  }

  // One success forgets earlier failures.
  {
    const store = arrayStore([ev(1), ev(2, "b")]);
    let clock = 0;
    const results: SendResult[] = [RETRY, RETRY, OK, RETRY];
    const flusher = createFlusher({
      store,
      send: async () => results.shift() ?? OK,
      newBatchId: counter(),
      now: () => clock,
      canSend: () => true,
    });
    await flusher.flush();
    clock = flusher.retryAt();
    await flusher.flush();
    clock = flusher.retryAt();
    await flusher.flush();
    eq(
      "a failure after a success starts again at one minute",
      (flusher.retryAt() - clock) / MIN,
      1
    );
  }

  // A permanently rejected batch must not block the queue.
  {
    const store = arrayStore([ev(1, "a"), ev(2, "b")]);
    const results: SendResult[] = [DROP, OK];
    const flusher = createFlusher({
      store,
      send: async () => results.shift() ?? OK,
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq("drop deletes and carries on", store.rows.length, 0);
    eq("without a backoff", flusher.retryAt(), 0);
  }

  // Opted out or not ready: no network, no read.
  {
    const store = arrayStore([ev(1)]);
    let calls = 0;
    const flusher = createFlusher({
      store,
      send: async () => {
        calls++;
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => false,
    });
    await flusher.flush();
    eq("canSend false sends nothing", calls, 0);
    eq("and keeps the rows untagged", [store.rows.length, store.rows[0].batchId], [1, null]);
  }

  // Opting out while the read is in flight.
  {
    const rows = [ev(1)];
    let allowed = true;
    let calls = 0;
    const flusher = createFlusher({
      store: {
        async peek(limit) {
          const out = rows.slice(0, limit);
          allowed = false;
          return out;
        },
        async tag() {},
        async remove() {},
      },
      send: async () => {
        calls++;
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => allowed,
    });
    await flusher.flush();
    eq("a switch-off during peek stops the send", calls, 0);
  }

  // Two triggers at once share one run.
  {
    const store = arrayStore([ev(1)]);
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flusher = createFlusher({
      store,
      send: async () => {
        calls++;
        await gate;
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    const a = flusher.flush();
    const b = flusher.flush();
    release();
    await Promise.all([a, b]);
    eq("overlapping flushes send once", calls, 1);
  }

  // A big backlog drains over several triggers.
  {
    const store = arrayStore(
      Array.from({ length: FLUSH_BATCH_SIZE * (MAX_BATCHES_PER_FLUSH + 2) }, (_, i) => ev(i + 1))
    );
    const flusher = createFlusher({
      store,
      send: async () => OK,
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq(
      "one flush sends at most MAX_BATCHES_PER_FLUSH batches",
      store.rows.length,
      FLUSH_BATCH_SIZE * 2
    );
    await flusher.flush();
    eq("the next one finishes", store.rows.length, 0);
  }

  // A broken store is a failure, not a crash or a hot loop.
  {
    let reads = 0;
    const flusher = createFlusher({
      store: {
        async peek() {
          reads++;
          throw new Error("no such table: analytics_queue");
        },
        async tag() {},
        async remove() {},
      },
      send: async () => OK,
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    await flusher.flush();
    eq("a store error backs off", reads, 1);
    eq("for a minute", flusher.retryAt(), MIN);
  }

  // Failing to tag means nothing was sent.
  {
    let sends = 0;
    const flusher = createFlusher({
      store: {
        async peek() {
          return [ev(1)];
        },
        async tag() {
          throw new Error("database is locked");
        },
        async remove() {},
      },
      send: async () => {
        sends++;
        return OK;
      },
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    eq("an untaggable batch is not sent", sends, 0);
    eq("and backs off", flusher.retryAt(), MIN);
  }

  // reset() forgets the backoff (analytics switched back on).
  {
    const flusher = createFlusher({
      store: arrayStore([ev(1)]),
      send: async () => RETRY,
      newBatchId: counter(),
      ...MIN_CLOCK,
      canSend: () => true,
    });
    await flusher.flush();
    ok("backing off", flusher.retryAt() > 0);
    flusher.reset();
    eq("reset clears it", flusher.retryAt(), 0);
  }
}

async function queueSql(): Promise<void> {
  section("G. analytics_queue SQL (the real v24 DDL)");
  const sqlite = new DatabaseSync(":memory:");
  const db: QueueDb = {
    async runAsync(sql, params = []) {
      return sqlite.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: (string | number | null)[] = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
  };
  for (const statement of V24_CREATE) sqlite.exec(statement);
  for (const statement of V24_CREATE) sqlite.exec(statement);
  ok("the DDL can run twice", true);
  const cols = (
    sqlite.prepare("PRAGMA table_info(analytics_queue);").all() as { name: string }[]
  ).map((c) => c.name);
  eq("columns", cols, ["id", "name", "props", "ts", "session_id", "is_pro", "batch_id"]);

  const queue = createQueue(db);
  const base = { ts: "2026-01-01T00:00:00.000Z", sessionId: "s1", isPro: false };
  await queue.insert([
    { ...base, name: "log_added", props: { kind: "meal" } },
    {
      ...base,
      name: "paywall_view",
      props: { source: "direct", trial_eligible: true },
      isPro: true,
    },
  ]);
  const rows = await queue.peek(10);
  eq("rows come back oldest first", rows.map((r) => r.name), ["log_added", "paywall_view"]);
  eq("props survive the JSON round trip", rows[1].props, {
    source: "direct",
    trial_eligible: true,
  });
  eq("is_pro maps to a boolean", rows.map((r) => r.isPro), [false, true]);
  eq("session and ts survive", [rows[0].sessionId, rows[0].ts], ["s1", base.ts]);
  eq("a new row has no batch id", rows.map((r) => r.batchId), [null, null]);
  eq("peek honours its limit", (await queue.peek(1)).length, 1);

  const batchId = "0b1f6a52-3c1e-4e0e-9a0e-2f7b2f2a9d11";
  await queue.tag([rows[0].id], batchId);
  await queue.tag([], "ignored");
  eq(
    "tag stamps just those rows",
    (await queue.peek(10)).map((r) => r.batchId),
    [batchId, null]
  );
  const nextRows = await queue.peek(10);
  eq("and nextBatch then sees the tagged row alone", nextBatch(nextRows).map((r) => r.id), [rows[0].id]);

  await queue.remove([rows[0].id]);
  eq("remove deletes just those ids", (await queue.peek(10)).map((r) => r.name), [
    "paywall_view",
  ]);
  await queue.remove([]);
  eq("remove of nothing is a no-op", await queue.count(), 1);

  await queue.clear();
  eq("clear empties it", await queue.count(), 0);

  await queue.insert([{ ...base, name: "log_added", props: {} }]);
  const next = (await queue.peek(1))[0];
  ok("ids never repeat after deletes", next.id > rows[1].id);
  sqlite.prepare("UPDATE analytics_queue SET props = ? WHERE id = ?;").run("{not json", next.id);
  eq("an unreadable props cell becomes an empty object", (await queue.peek(1))[0].props, {});
  await queue.clear();

  const many = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      ...base,
      name: "log_added",
      props: { kind: "med", index: from + i },
    }));
  await queue.insert(many(1, QUEUE_MAX_ROWS));
  eq("QUEUE_MAX_ROWS is 5000", QUEUE_MAX_ROWS, 5000);
  eq("exactly at the cap nothing is deleted", await queue.count(), QUEUE_MAX_ROWS);

  await queue.insert(many(QUEUE_MAX_ROWS + 1, QUEUE_MAX_ROWS + 1));
  eq("one past the cap drops one", await queue.count(), QUEUE_MAX_ROWS);
  eq("and it is the oldest", (await queue.peek(1))[0].props.index, 2);

  await queue.insert(many(QUEUE_MAX_ROWS + 2, QUEUE_MAX_ROWS + 11));
  eq("ten more drop ten more", await queue.count(), QUEUE_MAX_ROWS);
  eq("the oldest survivor moved up by ten", (await queue.peek(1))[0].props.index, 12);
  const all = await queue.peek(QUEUE_MAX_ROWS + 1);
  eq("the newest event is kept", all[all.length - 1].props.index, QUEUE_MAX_ROWS + 11);
  sqlite.close();
}

/**
 * Reads event-schema.json in the shape the server compiles it:
 * { version, events: { name: { field: "bool" | "int" | "string" | ["enum", ...values] } } }.
 * Returns a message when it finds anything else.
 */
function parseServerSchema(doc: unknown): { version: unknown; events: Canonical } | string {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(doc) || !isObj(doc.events)) return "expected { version, events: { ... } }";
  const events: Canonical = new Map();
  for (const [name, fields] of Object.entries(doc.events)) {
    if (!isObj(fields)) return `${name} is not an object`;
    const parsed = new Map<string, string>();
    for (const [field, spec] of Object.entries(fields)) {
      if (spec === "string" || spec === "int" || spec === "bool") {
        parsed.set(field, spec);
      } else if (
        Array.isArray(spec) &&
        spec[0] === "enum" &&
        spec.length > 1 &&
        spec.every((v) => typeof v === "string")
      ) {
        parsed.set(field, "enum:" + (spec.slice(1) as string[]).sort().join("|"));
      } else {
        return `${name}.${field} has a type this test does not know`;
      }
    }
    events.set(name, parsed);
  }
  return { version: doc.version, events };
}

function serverSchemaFile(): void {
  section("H. server schema file");
  const rel = "supabase/functions/_shared/event-schema.json";
  if (!fs.existsSync(nodePath.join(ROOT, rel))) {
    skipped++;
    console.log(`  SKIP ${rel} does not exist yet (written by the server work)`);
    return;
  }
  const parsed = parseServerSchema(JSON.parse(src(rel)));
  if (typeof parsed === "string") {
    ok("event-schema.json has a shape this test understands", false, parsed);
    return;
  }
  eq("schema version", parsed.version, SCHEMA_VERSION);
  const mine = canonicalSchema();
  eq("event names match", [...parsed.events.keys()].sort(), [...mine.keys()].sort());
  for (const [name, fields] of mine) {
    const theirs = parsed.events.get(name);
    if (!theirs) continue;
    eq(`${name} field names match`, [...theirs.keys()].sort(), [...fields.keys()].sort());
    for (const [field, type] of fields) {
      const other = theirs.get(field);
      if (other !== undefined) eq(`${name}.${field} type matches`, other, type);
    }
  }

  // The identifier rule and the batch cap are written twice (here and in the
  // server's validator); the text of each must stay the same.
  const serverTs = "supabase/functions/_shared/event-schema.ts";
  if (fs.existsSync(nodePath.join(ROOT, serverTs))) {
    const server = src(serverTs);
    const client = src("lib/analytics/eventSchema.ts");
    const grab = (text: string, name: string) =>
      new RegExp(`const ${name} = (/.*/);`).exec(text)?.[1] ?? null;
    ok("the identifier regex is the server's", grab(client, "IDENTIFIER") !== null && grab(client, "IDENTIFIER") === grab(server, "IDENTIFIER"));
    ok("the has-a-letter regex is the server's", grab(client, "HAS_LETTER") !== null && grab(client, "HAS_LETTER") === grab(server, "HAS_LETTER"));
    const cap = /MAX_EVENTS_PER_BATCH = (\d+)/.exec(server);
    eq("the batch size is the server's cap", Number(cap?.[1]), FLUSH_BATCH_SIZE);
  }
}

/** settings.analytics, in the order every locale file keeps them. */
const ANALYTICS_KEYS = [
  "section",
  "title",
  "hint",
  "installId",
  "installIdHint",
  "installIdShare",
  "deleteRow",
  "deleteSub",
  "deleteConfirmTitle",
  "deleteConfirmBody",
  "deleteDone",
  "deleteFailed",
  "sheetTitle",
  "sheetAccept",
  "sheetDecline",
];

function wiringAndCopy(): void {
  section("I. wiring and copy");
  const app = JSON.parse(src("app.json")) as { expo: { extra: Record<string, string> } };
  eq(
    "app.json carries trackFnUrl",
    app.expo.extra.trackFnUrl,
    "https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/track"
  );
  ok("and still spikeFnUrl", typeof app.expo.extra.spikeFnUrl === "string");
  eq(
    "and the delete-device URL behind the Privacy button",
    app.expo.extra.deleteDeviceFnUrl,
    "https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/delete-device"
  );

  const layout = src("app/_layout.tsx");
  ok("the root layout starts the Supabase sink", /^initSupabaseSink\(\);$/m.test(layout));
  ok("and no other sink is started", !/initAnalyticsSink/.test(layout));
  ok(
    "and hands it the entitlement once ready",
    /if \(ready\) setAnalyticsIsPro\(isProUser\);/.test(layout)
  );

  // The envelope is built where React Native is, so it is pinned by its source.
  const transport = src("lib/analytics/transport.ts");
  ok("the envelope carries the batch id", /batch_id: batchId,/.test(transport));
  ok(
    "tz_offset is minutes east of UTC",
    /tz_offset: -new Date\(\)\.getTimezoneOffset\(\),/.test(transport)
  );
  ok("the device id travels as x-device-id", /"x-device-id": id/.test(transport));
  ok("a rejected batch warns in dev", /__DEV__ && result\.status === "drop"/.test(transport));

  const dbIndex = src("lib/db/index.ts");
  ok("SCHEMA_VERSION is 28", /const SCHEMA_VERSION = 28;/.test(dbIndex));
  ok(
    "the v23 -> v24 step runs the real migration",
    /currentVersion < 24\)\s*\{\s*await migrateToV24\(db\);/.test(dbIndex)
  );
  ok("a fresh install creates the outbox", /for \(const statement of V24_CREATE\)/.test(dbIndex));

  const data = src("app/settings/data.tsx");
  ok(
    "Settings > Data has the switch and its hint",
    data.includes('t("settings.analytics.title")') && data.includes('t("settings.analytics.hint")')
  );

  const banned: Record<string, RegExp> = {
    en: /alarm|alert|warn|diagnos|treat|dose|dosage/i,
    tr: /uyar|alarm|tanı|tedavi|doz/i,
    de: /alarm|warn|diagnos|behandl|dosis|dosier/i,
    fr: /alarme|alerte|avertit|diagnos|traite|dose/i,
    es: /alarma|alerta|avisa|diagnos|trata|dosis/i,
    it: /allarme|avvis|diagnos|tratta|dose/i,
    pt: /alarme|alerta|avisa|diagnos|trata|dose/i,
    ar: /تنبيه|إنذار|ينبه|يحذر|يشخص|يعالج|جرعة/,
    ja: /アラーム|警報|警告|診断|治療|用量/,
  };
  for (const lang of Object.keys(banned)) {
    const block = /\n {4}analytics: \{([\s\S]*?)\n {4}\},/.exec(src(`lib/i18n/locales/${lang}.ts`));
    ok(`${lang} has settings.analytics`, block !== null);
    if (!block) continue;
    const entries: [string, string][] = [];
    const entryRe = /\n {6}(\w+): "([^"]+)"/g;
    for (let m = entryRe.exec(block[1]); m; m = entryRe.exec(block[1])) entries.push([m[1], m[2]]);
    eq(`${lang} keys`, entries.map((e) => e[0]), ANALYTICS_KEYS);
    for (const [key, text] of entries) {
      ok(`${lang}.${key} is not empty`, text.trim().length > 0);
      ok(`${lang}.${key} has no en or em dash`, !/[–—]/.test(text));
      ok(`${lang}.${key} avoids regulated wording`, !banned[lang].test(text), text);
    }
  }
  const trHint = /analytics: \{[\s\S]*?hint: "([^"]+)"/.exec(src("lib/i18n/locales/tr.ts"));
  ok(
    "Turkish copy keeps its diacritics",
    !!trHint && /[ığşüöç]/.test(trHint[1])
  );
}

async function main(): Promise<void> {
  console.log("zerospike analytics schema test");
  matchesContract();
  schemaHygiene();
  sanitizer();
  sessions();
  backoffAndStatus();
  await flusherBehaviour();
  await queueSql();
  serverSchemaFile();
  wiringAndCopy();
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.log("test crashed:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
