// Shared plumbing for the track and rc-webhook functions, in the same style as
// ai-ask-spike: Deno is reached through globalThis, and Postgres is written via
// PostgREST over plain fetch with the service-role key the platform injects into
// every Edge Function (no supabase-js dependency). No CORS headers: both callers
// are native (the app, RevenueCat's servers), never a browser.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Answer to OPTIONS: empty 204, no CORS headers. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const value = (globalThis as any).Deno?.env?.get?.(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function serve(handler: (req: Request) => Promise<Response>): void {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.serve?.(handler);
}

export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Reads the body as text, or returns null when it is larger than maxBytes. A
 * declared Content-Length over the limit is refused up front; without one (a
 * chunked upload) the stream is counted as it arrives and abandoned at the
 * limit, so nothing larger than maxBytes is ever buffered.
 */
export async function readBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Client IP for rate limiting. cf-connecting-ip first: where the platform is
 * fronted by Cloudflare that header is overwritten at the edge, so the client
 * cannot choose it. Otherwise the LAST X-Forwarded-For entry, the one the
 * platform's own proxy appended; earlier entries are whatever the client sent.
 */
export function callerIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((hop) => hop.trim()).filter((hop) => hop);
  return hops.at(-1) ?? "unknown";
}

/** Compares SHA-256 digests so timing does not reveal how much of the secret matched. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
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

function validIp(ip: string): boolean {
  if (ip.length > 45) return false;
  if (/^[0-9.]+$/.test(ip)) {
    const parts = ip.split(".");
    return parts.length === 4 && parts.every((n) => /^(0|[1-9]\d{0,2})$/.test(n) && Number(n) <= 255);
  }
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return false;
  const halves = ip.split("::");
  if (halves.length > 2) return false;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const all = halves.flatMap(groups);
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? all.length <= 7 : all.length === 8;
}

/**
 * Caller IP behind the legacy forwarders: they send the real client address in
 * X-Zs-Client-Ip together with X-Zs-Forwarder (the gateway rewrites
 * X-Forwarded-For, so it cannot carry the address). The address is believed
 * only when X-Zs-Forwarder equals FORWARDER_SECRET; otherwise (or with no
 * secret configured) the connection IP from callerIp() applies.
 */
export async function resolveCallerIp(req: Request): Promise<string> {
  const secret = env("FORWARDER_SECRET");
  const given = req.headers.get("x-zs-forwarder");
  if (secret && given && (await sameSecret(given, secret))) {
    const given_ip = req.headers.get("x-zs-client-ip")?.trim();
    if (given_ip && validIp(given_ip)) return given_ip;
  }
  return callerIp(req);
}

/**
 * Keyed hash of an IP that changes every UTC day: the rate-limit table never
 * holds an IP, and a hash can be neither reversed without the key nor linked
 * across days.
 */
export async function hashIp(ip: string, key: string, now: number): Promise<string> {
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const day = new Date(now).toISOString().slice(0, 10);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(`${day}|${ip}`)));
  return Array.from(mac.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ServiceCreds {
  url: string;
  key: string;
}

export function serviceCreds(): ServiceCreds | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url, key } : null;
}

export interface RestResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * POST to PostgREST (`path` is relative to /rest/v1/) as the service role. The
 * response body is always read, so no fetch resource is left dangling. Throws
 * only on a network failure; callers decide what a non-ok status means.
 */
export async function restPost(
  creds: ServiceCreds,
  path: string,
  body: unknown,
  prefer?: string,
): Promise<RestResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: creds.key,
    Authorization: `Bearer ${creds.key}`,
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${creds.url}/rest/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
