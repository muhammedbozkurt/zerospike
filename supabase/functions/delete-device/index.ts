// Supabase Edge Function: delete-device
//
// "Delete my usage data". The app POSTs with its anonymous per-install
// `x-device-id` (the random uuid track and ai-ask-spike receive; never identity),
// optionally its RevenueCat app user id as `x-rc-app-user-id`, and no body. One
// RPC, delete_device_data_v2(), removes that device's rows from every
// server-side store under the service role (RLS on, no policies) and returns the
// rows removed per table. The app keeps its install id on purpose: a new one
// would hand out a fresh daily Spike allowance.
//
// Deploy is a HUMAN step: `supabase functions deploy delete-device`, after the
// delete_device_data_v2 migration is pushed (without it every request is a 503).
// verify_jwt must stay false (config.toml): the app sends no JWT, same as track.
// No CORS headers: the only caller is the native app.
//
// PRIVACY: the request counters (delete_usage) hold keyed, daily-rotating hashes
// of the device id and the client IP, never the raw values, so nothing keyed by
// the device id outlives the deletion. subscription_events is matched on its
// device_id column and, when the app sends it, on the RevenueCat app user id
// (app_user_id or original_app_user_id): the device id only rides on the events
// RevenueCat reported while usage analytics was on.
//
// Responses: 200 {deleted: {table: rows}} (all zeros when nothing was stored);
// 400 bad_device_id or bad_app_user_id; 405; 429 (hourly per-device or per-IP
// cap, see Retry-After); 500 not_configured; 503 storage (database).

import {
  resolveCallerIp,
  hashIp,
  isRecord,
  json,
  noContent,
  restPost,
  serve,
  type ServiceCreds,
  serviceCreds,
} from "../_shared/http.ts";

const HOUR_MS = 60 * 60 * 1000;

// Canonical lowercase uuid, as in _shared/event-schema.ts (not imported: that
// module carries the whole analytics schema).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Visible ASCII, no spaces, 128 characters at most; RevenueCat's anonymous ids
// ("$RCAnonymousID:" and 32 hex digits) are well inside it. The same pattern as
// lib/analytics/deleteDevice.ts, which leaves a value out that does not fit.
const APP_USER_ID = /^[\x21-\x7e]{1,128}$/;

// A person taps "delete my data" once or twice. Device ids are chosen by the
// caller, so the per-IP ceiling is what a caller rotating ids still hits; it is
// generous because carrier NAT puts many phones behind one address. Both are
// enforced atomically in Postgres by delete_request_allowed().
const DEVICE_HOURLY_REQUESTS = 5;
const IP_HOURLY_REQUESTS = 30;

/** True when the request may proceed, false when a cap is hit, null when the database call failed. */
async function allowed(creds: ServiceCreds, deviceBucket: string, ipBucket: string): Promise<boolean | null> {
  try {
    const res = await restPost(creds, "rpc/delete_request_allowed", {
      p_device_bucket: deviceBucket,
      p_ip_bucket: ipBucket,
      p_max_device: DEVICE_HOURLY_REQUESTS,
      p_max_ip: IP_HOURLY_REQUESTS,
    });
    return res.ok && typeof res.data === "boolean" ? res.data : null;
  } catch {
    return null;
  }
}

/** Rows removed per table, or null when the database call failed. */
async function deleteDeviceData(
  creds: ServiceCreds,
  deviceId: string,
  appUserId: string | null
): Promise<Record<string, unknown> | null> {
  try {
    const res = await restPost(creds, "rpc/delete_device_data_v2", {
      p_device_id: deviceId,
      p_app_user_id: appUserId,
    });
    return res.ok && isRecord(res.data) ? res.data : null;
  } catch {
    return null;
  }
}

/** 429 whose Retry-After points at the end of the current UTC hour. */
function rateLimited(now: number): Response {
  const seconds = Math.ceil((HOUR_MS - (now % HOUR_MS)) / 1000);
  return json({ error: "rate_limited" }, 429, { "Retry-After": String(seconds) });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return noContent();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const deviceId = (req.headers.get("x-device-id") ?? "").trim().toLowerCase();
  if (!UUID.test(deviceId)) return json({ error: "bad_device_id" }, 400);

  const appUserId = (req.headers.get("x-rc-app-user-id") ?? "").trim() || null;
  if (appUserId !== null && !APP_USER_ID.test(appUserId)) {
    return json({ error: "bad_app_user_id" }, 400);
  }

  const creds = serviceCreds();
  if (!creds) return json({ error: "not_configured" }, 500);

  // The device id gets the same keyed daily hash as the IP: the counter table
  // must not keep the id the caller asked to be forgotten.
  const now = Date.now();
  const [deviceBucket, ipBucket] = await Promise.all([
    hashIp(deviceId, creds.key, now),
    hashIp(await resolveCallerIp(req), creds.key, now),
  ]);
  const ok = await allowed(creds, deviceBucket, ipBucket);
  if (ok === null) return json({ error: "storage" }, 503);
  if (!ok) return rateLimited(now);

  const deleted = await deleteDeviceData(creds, deviceId, appUserId);
  if (deleted === null) return json({ error: "storage" }, 503);
  return json({ deleted }, 200);
}

serve(handle);
