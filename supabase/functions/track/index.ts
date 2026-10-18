// Supabase Edge Function: track
//
// First-party product analytics ingest. The app POSTs batches of up to 50 events
// with its anonymous per-install `x-device-id` (the same random uuid ai-ask-spike
// receives; never identity). Each batch is validated against
// _shared/event-schema.json, then rate-limited, de-duplicated and written to
// public.app_events by one RPC (track_ingest) under the service role (RLS on,
// no policies).
//
// Deploy is a HUMAN step: `supabase functions deploy track`. verify_jwt must stay
// false (config.toml): the app sends no JWT, same as ai-ask-spike. Optional
// secret TRACK_GLOBAL_DAILY_CAP overrides the global daily row ceiling.
//
// PRIVACY: no health values, no free text. sanitizeEvent() in
// _shared/event-schema.ts is the only path from request to row. Client IPs are
// only used as a keyed, daily-rotating hash for the per-IP limit.
//
// Responses: 202 {accepted, dropped}. Unknown events, unknown props and props of
// the wrong type are dropped, not errors. With a batch_id that was already
// stored for this device: 202 {accepted: 0, dropped: 0, duplicate: true} and
// nothing is written. 429 (hourly per-IP or per-device cap, or the global daily
// ceiling; see Retry-After) and 503 (database) mean "retry later with the same
// batch_id"; events over the device's daily budget are dropped and counted.

import {
  resolveCallerIp,
  env,
  hashIp,
  json,
  noContent,
  readBody,
  restPost,
  serve,
  type ServiceCreds,
  serviceCreds,
} from "../_shared/http.ts";
import {
  type CleanEvent,
  EVENT_SCHEMA,
  parseTrackBody,
  type TrackBatch,
  type TrackMeta,
  UUID,
} from "../_shared/event-schema.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Ceilings, all enforced atomically in Postgres by track_ingest() (see the
// app_events migration). A normal install sends a few requests an hour. Device
// ids are chosen by the caller, so the per-IP ceiling is what a caller rotating
// ids still hits; it is generous because carrier NAT puts many phones behind
// one address. The global ceiling bounds the table whatever else gets through.
const IP_HOURLY_REQUESTS = 600;
const DEVICE_HOURLY_REQUESTS = 60;
const DEVICE_DAILY_EVENTS = 2000;
const DEFAULT_GLOBAL_DAILY_EVENTS = 500_000;

// track_ingest() result codes; anything >= 0 is the number of rows stored.
const RATE_LIMITED = -1;
const DUPLICATE = -2;
const GLOBAL_CAP = -3;

function globalDailyCap(): number {
  const value = Number(env("TRACK_GLOBAL_DAILY_CAP"));
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_GLOBAL_DAILY_EVENTS;
}

/** 429 whose Retry-After points at the end of the current UTC hour or day. */
function rateLimited(now: number, windowMs: number): Response {
  const seconds = Math.ceil((windowMs - (now % windowMs)) / 1000);
  return json({ error: "rate_limited" }, 429, { "Retry-After": String(seconds) });
}

function toRow(meta: TrackMeta, event: CleanEvent) {
  return {
    session_id: meta.session_id,
    name: event.name,
    props: event.props,
    client_ts: event.ts,
    app_version: meta.app_version,
    build: meta.build,
    platform: meta.platform,
    os_version: meta.os_version,
    locale: meta.locale,
    is_pro: meta.is_pro,
    tz_offset: meta.tz_offset,
  };
}

/**
 * One RPC, one transaction: counts the request against the IP and device caps,
 * checks the global ceiling, claims batch_id, spends the budgets and inserts
 * the rows. Because the batch claim and the insert commit together, a failure
 * never leaves a claimed batch without its rows, so the client's retry is stored
 * rather than taken for a duplicate. Returns rows stored, RATE_LIMITED,
 * GLOBAL_CAP, DUPLICATE, or null when the database call failed.
 */
async function ingest(creds: ServiceCreds, deviceId: string, ipHash: string, batch: TrackBatch): Promise<number | null> {
  try {
    const res = await restPost(creds, "rpc/track_ingest", {
      p_device_id: deviceId,
      p_ip_hash: ipHash,
      p_batch_id: batch.batchId,
      p_rows: batch.events.map((event) => toRow(batch.meta, event)),
      p_max_ip_requests: IP_HOURLY_REQUESTS,
      p_max_requests: DEVICE_HOURLY_REQUESTS,
      p_max_events: DEVICE_DAILY_EVENTS,
      p_global_cap: globalDailyCap(),
    });
    return res.ok && typeof res.data === "number" && Number.isInteger(res.data) ? res.data : null;
  } catch {
    return null;
  }
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return noContent();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const deviceId = (req.headers.get("x-device-id") ?? "").trim().toLowerCase();
  if (!UUID.test(deviceId)) return json({ error: "bad_device_id" }, 400);

  const creds = serviceCreds();
  if (!creds) return json({ error: "not_configured" }, 500);

  let body: unknown;
  try {
    const text = await readBody(req);
    if (text === null) return json({ error: "payload_too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const batch = parseTrackBody(EVENT_SCHEMA, body, Date.now());
  if (!batch) return json({ error: "bad_request" }, 400);
  if (batch.events.length === 0) return json({ accepted: 0, dropped: batch.dropped }, 202);

  const ipHash = await hashIp(await resolveCallerIp(req), creds.key, Date.now());
  const stored = await ingest(creds, deviceId, ipHash, batch);
  // 503 so the client keeps the batch and retries it later.
  if (stored === null) return json({ error: "storage" }, 503);
  if (stored === RATE_LIMITED) return rateLimited(Date.now(), HOUR_MS);
  if (stored === GLOBAL_CAP) return rateLimited(Date.now(), DAY_MS);
  if (stored === DUPLICATE) return json({ accepted: 0, dropped: 0, duplicate: true }, 202);
  return json({ accepted: stored, dropped: batch.dropped + (batch.events.length - stored) }, 202);
}

serve(handle);
