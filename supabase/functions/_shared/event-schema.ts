// What the track function is allowed to store. event-schema.json is the single
// contract shared with the app: an event or prop that is not listed there never
// reaches the database. sanitizeEvent() below is the ONLY path from request to
// row, so the privacy rules live in one readable place:
//   - unknown event name          -> event dropped
//   - prop not listed for event   -> prop dropped
//   - prop of the wrong type      -> prop dropped (the event is kept)
//   - string props are short identifiers (source, step, trigger...), never free
//     text or a number: anything else is dropped
// The schema has no health fields and a string prop cannot carry a number (see
// the string rule below). An int prop accepts any integer by design, so keeping
// health values out of int props is the client's job (lib/analytics).

import rawSchema from "./event-schema.json" with { type: "json" };
import { isRecord } from "./http.ts";

export type PropValue = boolean | number | string;

export type FieldSpec =
  | { type: "bool" }
  | { type: "int" }
  | { type: "string" }
  | { type: "enum"; values: readonly string[] };

export type EventSchema = ReadonlyMap<string, ReadonlyMap<string, FieldSpec>>;

/**
 * Turns the JSON contract into typed field specs. Throws on anything it does not
 * understand, so a bad schema edit fails at boot instead of silently letting
 * props through (or dropping all of them).
 */
export function compileSchema(raw: unknown): EventSchema {
  const events = isRecord(raw) ? raw.events : undefined;
  if (!isRecord(events)) throw new Error("event-schema: missing events");
  const schema = new Map<string, Map<string, FieldSpec>>();
  for (const [name, fields] of Object.entries(events)) {
    if (!isRecord(fields)) throw new Error(`event-schema: ${name} must be an object`);
    const specs = new Map<string, FieldSpec>();
    for (const [field, spec] of Object.entries(fields)) {
      specs.set(field, parseFieldSpec(spec, `${name}.${field}`));
    }
    schema.set(name, specs);
  }
  return schema;
}

function parseFieldSpec(spec: unknown, where: string): FieldSpec {
  if (spec === "bool" || spec === "int" || spec === "string") return { type: spec };
  if (
    Array.isArray(spec) && spec[0] === "enum" && spec.length > 1 &&
    spec.every((v) => typeof v === "string")
  ) {
    return { type: "enum", values: spec.slice(1) };
  }
  throw new Error(`event-schema: unsupported type at ${where}`);
}

export const EVENT_SCHEMA: EventSchema = compileSchema(rawSchema);

// ASCII identifier, at most 64 chars, at least one letter, and never two digits
// in a row, not even across a decimal point (12, 7.8). So neither a sentence nor
// a reading such as a glucose value can pass as a "string" prop; single digits
// as in "day7" still do.
const IDENTIFIER = /^[A-Za-z0-9_.:\/-]{1,64}$/;
const HAS_LETTER = /[A-Za-z]/;
const DIGIT_RUN = /\d\.?\d/;

function accepts(spec: FieldSpec, value: unknown): value is PropValue {
  switch (spec.type) {
    case "bool":
      return typeof value === "boolean";
    case "int":
      return Number.isSafeInteger(value);
    case "string":
      return typeof value === "string" && IDENTIFIER.test(value) && HAS_LETTER.test(value) &&
        !DIGIT_RUN.test(value);
    case "enum":
      return typeof value === "string" && spec.values.includes(value);
  }
}

// Offline queues replay late and device clocks drift. A timestamp outside this
// window keeps the event but loses client_ts (received_at still dates it).
const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

function normalizeTs(value: unknown, nowMs: number): string | null {
  if (typeof value !== "string" || !ISO_8601.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < nowMs - MAX_PAST_MS || ms > nowMs + MAX_FUTURE_MS) return null;
  return new Date(ms).toISOString();
}

export interface CleanEvent {
  name: string;
  props: Record<string, PropValue>;
  ts: string | null;
}

/**
 * The privacy boundary. Returns null when the whole event must be dropped.
 * Props are rebuilt from the schema side (never by copying the input), so a key
 * the schema does not list cannot reach storage, whatever the client sent.
 */
export function sanitizeEvent(schema: EventSchema, input: unknown, nowMs: number): CleanEvent | null {
  if (!isRecord(input) || typeof input.name !== "string") return null;
  const fields = schema.get(input.name);
  if (!fields) return null;
  const given = isRecord(input.props) ? input.props : {};
  const props: Record<string, PropValue> = {};
  for (const [key, spec] of fields) {
    const value = Object.hasOwn(given, key) ? given[key] : undefined;
    if (accepts(spec, value)) props[key] = value;
  }
  return { name: input.name, props, ts: normalizeTs(input.ts, nowMs) };
}

export const MAX_EVENTS_PER_BATCH = 50;

/** Canonical lowercase uuid (lowercase the input first). Used for x-device-id and batch_id. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Optional, and the same value on every retry of one batch. A malformed id is
// ignored (the batch is stored as if it had none) rather than failing a batch
// the client would then never stop retrying.
function parseBatchId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

export interface TrackMeta {
  app_version: string | null;
  build: string | null;
  platform: "ios" | "android" | null;
  os_version: string | null;
  locale: string | null;
  session_id: string | null;
  is_pro: boolean | null;
  tz_offset: number | null;
}

export interface TrackBatch {
  meta: TrackMeta;
  batchId: string | null;
  events: CleanEvent[];
  dropped: number;
}

/**
 * Validates a POST /track body. Returns null only when it is not a batch at all
 * (not an object, or `events` is not an array). Events past the first 50 and
 * events sanitizeEvent() rejects are counted in `dropped`; a malformed envelope
 * field becomes null instead of failing the batch.
 */
export function parseTrackBody(schema: EventSchema, body: unknown, nowMs: number): TrackBatch | null {
  if (!isRecord(body) || !Array.isArray(body.events)) return null;
  const events: CleanEvent[] = [];
  for (const raw of body.events.slice(0, MAX_EVENTS_PER_BATCH)) {
    const clean = sanitizeEvent(schema, raw, nowMs);
    if (clean) events.push(clean);
  }
  return {
    meta: parseMeta(body),
    batchId: parseBatchId(body.batch_id),
    events,
    dropped: body.events.length - events.length,
  };
}

function parseMeta(body: Record<string, unknown>): TrackMeta {
  const tz = body.tz_offset;
  return {
    app_version: shortText(body.app_version, 32),
    build: shortText(body.build, 32),
    platform: body.platform === "ios" || body.platform === "android" ? body.platform : null,
    os_version: shortText(body.os_version, 32),
    locale: shortText(body.locale, 35),
    session_id: shortText(body.session_id, 64),
    is_pro: typeof body.is_pro === "boolean" ? body.is_pro : null,
    // Minutes; UTC-12..UTC+14 in either sign convention.
    tz_offset: typeof tz === "number" && Number.isSafeInteger(tz) && Math.abs(tz) <= 840 ? tz : null,
  };
}

// Envelope values are app constants (version, build, locale...), not user input:
// printable ASCII and a length cap are enough to keep junk out.
function shortText(value: unknown, max: number): string | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || text.length === 0 || text.length > max) return null;
  return /^[\x20-\x7e]+$/.test(text) ? text : null;
}
