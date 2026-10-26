import { json } from "../_shared/http.ts";

export const DB_TIMEOUT_MS = 5000;

export interface Creds {
  url: string;
  key: string;
}

/** Calls a Postgres function through PostgREST as the service role. Throws on any
 *  failure (network, timeout, non-2xx): every caller decides what that means. */
export async function rpc(creds: Creds, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${creds.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: creds.key, Authorization: `Bearer ${creds.key}` },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
  return text ? JSON.parse(text) : null;
}

/** Gives the device and global slots back (the address count stays: it meters requests). */
export async function releaseSlot(creds: Creds, deviceId: string, day: string, countDevice: boolean): Promise<void> {
  try {
    await rpc(creds, "spike_release", { p_device_id: deviceId, p_day: day, p_count_device: countDevice });
  } catch {
    // a missed release only under-counts: it never blocks anyone
  }
}

/** Counts one model failure (502 upstream) in spike_reject_usage, no identifier. Swallows every
 *  error: the function may be deployed before the migration that adds this RPC, and a counter must
 *  never change what the user gets. */
export async function countUpstream(creds: Creds): Promise<void> {
  try {
    await rpc(creds, "spike_count_upstream", {});
  } catch {
    // counter only
  }
}

/** The model failed and the user got nothing: the slot goes back, the failure is counted, and the
 *  answer is the 502 upstream body whatever the two database calls did. */
export async function upstreamFailure(creds: Creds, deviceId: string, day: string, countDevice: boolean): Promise<Response> {
  await Promise.all([releaseSlot(creds, deviceId, day, countDevice), countUpstream(creds)]);
  return json({ error: "upstream" }, 502);
}
