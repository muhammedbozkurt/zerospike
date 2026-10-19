// Supabase Edge Function: feedback
//
// In-app feedback (suggestion, bug, other, cancel_survey). The app POSTs JSON with
// its anonymous per-install uuid as `x-device-id` (or `install_id` in the body, the
// header wins). Validation lives in ./validate.ts; one RPC, feedback_submit(), counts
// the request against the IP and install caps and stores the row in one transaction
// under the service role (RLS on, no policies).
//
// Deploy is a HUMAN step: `supabase functions deploy feedback`, after the feedback
// migration is pushed (without it every request is a 503). verify_jwt must stay false
// (config.toml): the app sends no JWT, same as track. No CORS headers: the only
// caller is the native app.
//
// PRIVACY: nothing the user wrote is logged, and no console output is produced at all.
// The counter table holds keyed, daily-rotating hashes of the IP and the install id.
//
// Responses: 200 {ok: true}; 400 bad_device_id / bad_request / bad_kind /
// bad_reason_code / bad_message / empty_feedback / bad_contact_email / bad_platform;
// 405; 413; 429 (hourly per-IP or per-install cap, see Retry-After); 500
// not_configured; 503 storage (database).

import {
  hashIp,
  json,
  noContent,
  readBody,
  resolveCallerIp,
  restPost,
  serve,
  type ServiceCreds,
  serviceCreds,
} from "../_shared/http.ts";
import { type CleanFeedback, installIdFrom, parseFeedback } from "./validate.ts";

const HOUR_MS = 60 * 60 * 1000;

// A person sends a few notes an hour at most. Install ids are chosen by the caller, so
// the per-IP ceiling is what a caller rotating ids still hits; it is generous because
// carrier NAT puts many phones behind one address.
const INSTALL_HOURLY_REQUESTS = 5;
const IP_HOURLY_REQUESTS = 30;

// The body is at most a 2000 character message plus a few short fields.
const MAX_FEEDBACK_BODY_BYTES = 32 * 1024;

const STORED = 1;
const RATE_LIMITED = -1;

/** STORED, RATE_LIMITED, or null when the database call failed. */
async function submit(
  creds: ServiceCreds,
  installId: string,
  ipBucket: string,
  installBucket: string,
  row: CleanFeedback,
): Promise<number | null> {
  try {
    const res = await restPost(creds, "rpc/feedback_submit", {
      p_install_id: installId,
      p_ip_bucket: ipBucket,
      p_install_bucket: installBucket,
      p_row: row,
      p_max_ip: IP_HOURLY_REQUESTS,
      p_max_install: INSTALL_HOURLY_REQUESTS,
    });
    return res.ok && typeof res.data === "number" && Number.isInteger(res.data) ? res.data : null;
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

  const creds = serviceCreds();
  if (!creds) return json({ error: "not_configured" }, 500);

  let body: unknown;
  try {
    const text = await readBody(req, MAX_FEEDBACK_BODY_BYTES);
    if (text === null) return json({ error: "payload_too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const installId = installIdFrom(req.headers.get("x-device-id"), body);
  if (!installId) return json({ error: "bad_device_id" }, 400);

  const parsed = parseFeedback(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const now = Date.now();
  const [installBucket, ipBucket] = await Promise.all([
    hashIp(installId, creds.key, now),
    hashIp(await resolveCallerIp(req), creds.key, now),
  ]);
  const result = await submit(creds, installId, ipBucket, installBucket, parsed.value);
  if (result === null) return json({ error: "storage" }, 503);
  if (result === RATE_LIMITED) return rateLimited(now);
  return json({ ok: result === STORED }, 200);
}

serve(handle);
