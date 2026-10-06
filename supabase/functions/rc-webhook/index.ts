// Supabase Edge Function: rc-webhook
//
// RevenueCat webhook (v1) sink: one row per RevenueCat event in
// public.subscription_events, keyed by the RevenueCat event id so redeliveries
// are no-ops. Unknown event types are stored like any other.
//
// RevenueCat sends the Authorization value configured in its dashboard; it must
// equal the RC_WEBHOOK_SECRET secret exactly, otherwise 401 (also when the
// secret is not set, so an unauthenticated caller learns nothing about the
// configuration). verify_jwt is false (config.toml) because that value is not a
// Supabase JWT.
//
// Deploy is a HUMAN step: `supabase secrets set RC_WEBHOOK_SECRET=...` then
// `supabase functions deploy rc-webhook`.
//
// The row is written before answering (a single insert, well inside
// RevenueCat's timeout). A storage failure returns 500 on purpose: RevenueCat
// retries non-2xx deliveries, so the event is not lost.

import { env, json, noContent, readBody, restPost, serve, serviceCreds } from "../_shared/http.ts";
import { toSubscriptionRow } from "../_shared/rc-event.ts";

/** Compares SHA-256 digests so timing does not reveal how much of the secret matched. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return noContent();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = env("RC_WEBHOOK_SECRET");
  if (!secret || !(await sameSecret(req.headers.get("authorization") ?? "", secret))) {
    return json({ error: "unauthorized" }, 401);
  }
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
  const row = toSubscriptionRow(body);
  if (!row) return json({ error: "bad_request" }, 400);

  try {
    const res = await restPost(
      creds,
      "subscription_events?on_conflict=rc_event_id",
      row,
      "resolution=ignore-duplicates,return=minimal",
    );
    if (!res.ok) return json({ error: "storage" }, 500);
  } catch {
    return json({ error: "storage" }, 500);
  }
  return json({ ok: true }, 200);
}

serve(handle);
