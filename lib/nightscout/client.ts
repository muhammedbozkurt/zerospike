/**
 * The Nightscout HTTP client. GET only, https only, read-only endpoints.
 *
 * Every failure leaves here as an enum: no error text, URL or token ever
 * travels with it, so callers cannot leak them into a log or an analytics call.
 */

export type NsError = "auth" | "network" | "timeout" | "invalid" | "rate_limited";

export interface NsRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type NsEntriesResult =
  | { ok: true; entries: unknown[] }
  | { ok: false; error: NsError; retryAfterMs?: number };

export type NsVerifyResult =
  | { ok: true; canWrite: boolean }
  | { ok: false; error: NsError };

export const NS_REQUEST_TIMEOUT_MS = 10_000;
export const NS_TEST_TIMEOUT_MS = 8_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;

export interface EntriesQuery {
  count: number;
  /** Only readings newer than this (epoch ms). */
  afterMs: number;
  /** Only readings older than this (epoch ms), for paging back. */
  beforeMs?: number;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function entriesUrl(base: string, token: string | null, q: EntriesQuery): string {
  const parts = [
    `count=${Math.max(1, Math.floor(q.count))}`,
    `${enc("find[date][$gt]")}=${Math.floor(q.afterMs)}`,
  ];
  if (q.beforeMs != null) parts.push(`${enc("find[date][$lt]")}=${Math.floor(q.beforeMs)}`);
  if (token) parts.push(`token=${enc(token)}`);
  return `${base}/api/v1/entries.json?${parts.join("&")}`;
}

export function verifyAuthUrl(base: string, token: string | null): string {
  return `${base}/api/v1/verifyauth${token ? `?token=${enc(token)}` : ""}`;
}

interface Raw {
  status: number;
  retryAfterMs?: number;
  body: string;
}

type RawResult = { ok: true; raw: Raw } | { ok: false; error: NsError };

async function getText(url: string, opts: NsRequestOptions): Promise<RawResult> {
  if (!url.startsWith("https://")) return { ok: false, error: "invalid" };
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? NS_REQUEST_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    // A redirect that ended on plain http would have carried the token there.
    const finalUrl = typeof res.url === "string" ? res.url : "";
    if (finalUrl !== "" && !finalUrl.startsWith("https://")) return { ok: false, error: "invalid" };
    const retryHeader = res.headers?.get?.("Retry-After") ?? null;
    const retrySeconds = retryHeader == null ? NaN : Number(retryHeader);
    const retryAfterMs = Number.isFinite(retrySeconds)
      ? Math.min(Math.max(0, retrySeconds * 1000), RETRY_AFTER_MAX_MS)
      : undefined;
    const body = await res.text();
    return { ok: true, raw: { status: res.status, retryAfterMs, body } };
  } catch {
    return { ok: false, error: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

function statusError(raw: Raw): NsEntriesResult | null {
  if (raw.status === 401 || raw.status === 403) return { ok: false, error: "auth" };
  if (raw.status === 429) return { ok: false, error: "rate_limited", retryAfterMs: raw.retryAfterMs };
  if (raw.status === 404) return { ok: false, error: "invalid" };
  if (raw.status < 200 || raw.status >= 300) return { ok: false, error: "network" };
  return null;
}

export async function fetchEntries(
  base: string,
  token: string | null,
  query: EntriesQuery,
  opts: NsRequestOptions = {}
): Promise<NsEntriesResult> {
  const got = await getText(entriesUrl(base, token, query), opts);
  if (!got.ok) return got;
  const bad = statusError(got.raw);
  if (bad) return bad;
  try {
    const parsed: unknown = JSON.parse(got.raw.body);
    if (!Array.isArray(parsed)) return { ok: false, error: "invalid" };
    return { ok: true, entries: parsed };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

/**
 * Asks the server what the credentials may do. Only an explicit "can write" or
 * "is admin" counts: a server without this endpoint (404) or with another
 * answer shape says nothing, and that must not block a read-only token.
 */
export async function verifyAuth(
  base: string,
  token: string | null,
  opts: NsRequestOptions = {}
): Promise<NsVerifyResult> {
  const got = await getText(verifyAuthUrl(base, token), opts);
  if (!got.ok) return got;
  if (got.raw.status === 401 || got.raw.status === 403) return { ok: false, error: "auth" };
  if (got.raw.status < 200 || got.raw.status >= 300) return { ok: true, canWrite: false };
  try {
    const parsed = JSON.parse(got.raw.body) as Record<string, unknown> | null;
    const inner = (parsed && typeof parsed.message === "object" ? parsed.message : parsed) as
      | Record<string, unknown>
      | null;
    const canWrite = inner?.canWrite === true || inner?.isAdmin === true;
    return { ok: true, canWrite };
  } catch {
    return { ok: true, canWrite: false };
  }
}
