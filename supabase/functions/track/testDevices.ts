// Test-device check for `track`: installs listed in public.test_devices have
// their batches accepted and dropped. Fail-open: when the lookup fails (table
// missing, network) the batch is written as usual and the failure is logged.
// A short in-memory cache keeps a busy device from costing a query per request.

import type { ServiceCreds } from "../_shared/http.ts";

export const TEST_DEVICE_TTL_MS = 60_000;
/** A failed lookup is remembered briefly so an outage does not add a query (and a timeout) to every request. */
export const LOOKUP_FAILURE_TTL_MS = 15_000;
const LOOKUP_TIMEOUT_MS = 2_000;
const MAX_ENTRIES = 2_000;

export type Lookup = (deviceId: string) => Promise<boolean>;

export interface TestDeviceChecker {
  isTestDevice(deviceId: string): Promise<boolean>;
}

export function createTestDeviceChecker(
  lookup: Lookup,
  now: () => number = Date.now,
  log: (message: string) => void = (message) => console.warn(message),
): TestDeviceChecker {
  const cache = new Map<string, { value: boolean; expires: number }>();
  return {
    async isTestDevice(deviceId) {
      const t = now();
      const hit = cache.get(deviceId);
      if (hit && hit.expires > t) return hit.value;
      let value = false;
      let ttl = TEST_DEVICE_TTL_MS;
      try {
        value = await lookup(deviceId);
      } catch (err) {
        ttl = LOOKUP_FAILURE_TTL_MS;
        log(`track: test_devices lookup failed, writing anyway (${err instanceof Error ? err.message : "error"})`);
      }
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(deviceId, { value, expires: t + ttl });
      return value;
    },
  };
}

/** PostgREST read of public.test_devices as the service role. Throws on a non-ok answer or a network failure. */
export function restLookup(creds: ServiceCreds, fetchFn: typeof fetch = fetch): Lookup {
  return async (deviceId) => {
    const url = `${creds.url}/rest/v1/test_devices?select=device_id&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`;
    const res = await fetchFn(url, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("unexpected answer");
    return data.length > 0;
  };
}
