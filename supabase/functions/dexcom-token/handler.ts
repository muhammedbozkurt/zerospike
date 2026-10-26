// Supabase Edge Function: dexcom-token (2.5.0, DEPLOY EDILMEZ; bayrak kapali).
//
// Dexcom resmi API'si icin sunucu tarafi: code -> token takasi, yenileme ve egvs vekili.
// Dexcom, mobil cihazda token tutulmamasini ve client_secret gerektigini soyler; bu yuzden
// uygulama yalniz bu function ile konusur. Tek uc nokta, POST + JSON govde {action}:
//
//   start    {state, region}     state kaydi (10 dk, tek kullanim) + Dexcom giris adresi
//   exchange {code, state}       state'i tuketir, kodu token ile takas eder, baglanti sirri doner
//   egvs     {startDate,endDate} x-dexcom-link ister; Dexcom v3 egvs'e vekil (<= 30 gun)
//   unlink   {}                  x-dexcom-link ister; baglantiyi siler
//
// Basliklar: x-device-id (anonim kurulum uuid'si, zorunlu), x-dexcom-link (256 bit sir, hex;
// egvs ve unlink). Sirlar yalniz Deno.env: DEXCOM_CLIENT_ID, DEXCOM_CLIENT_SECRET,
// DEXCOM_TOKEN_KEY (64 hex, AES-256-GCM), istege bagli DEXCOM_SANDBOX=1. Eksikse 503
// {error:"not_configured"}. Token'lar sifreli saklanir, loglanmaz, cevapta donmez; egvs
// cevabi yalniz recordId, systemTime, value, unit icerir. CORS yok (yalniz mobil uygulama).
//
// Cevaplar: 200; 400 bad_*, state_invalid, code_rejected; 401 unauthorized, link_expired;
// 405; 409 busy (yenileme baska istekte, tekrar deneyin); 429; 502 upstream; 503 storage,
// not_configured.

import { hashIp, isRecord, json, noContent, readBody } from "../_shared/http.ts";
import { decryptToken, encryptToken, randomHex, sameHex, sha256Hex, validTokenKey } from "./crypto.ts";
import type { LinkRow, Region, Store } from "./store.ts";

export const REDIRECT_URI = "https://greeneyeapp.com/zerospike/oauth/dexcom";
export const HOSTS: Record<Region, string> = {
  us: "https://api.dexcom.com",
  ous: "https://api.dexcom.eu",
  jp: "https://api.dexcom.jp",
};
export const SANDBOX_HOST = "https://sandbox-api.dexcom.com";

export const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_MS = 30 * 1000;
const ACCESS_SKEW_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024;
// Cihaz basina saatlik tavan: 15 dakikalik eslestirme 4 istek, ilk 90 gunluk cekim 3 pencere.
// IP tavani yuksektir; operator NAT'i arkasinda cok telefon olabilir.
export const DEVICE_HOURLY = 60;
export const IP_HOURLY = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATE = /^[0-9a-f]{32,128}$/;
const LINK_SECRET = /^[0-9a-f]{64}$/;
const QUERY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export interface Deps {
  /** Depolama; yapilandirma eksikse null. */
  store: Store | null;
  env(name: string): string | undefined;
  fetch: typeof fetch;
  now(): number;
  /** Oran siniri kovalarinin anahtari (service role anahtari). */
  bucketKey: string | undefined;
  callerIp(req: Request): Promise<string>;
}

interface Cfg {
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  sandbox: boolean;
  store: Store;
  bucketKey: string;
}

function config(deps: Deps): Cfg | null {
  const clientId = deps.env("DEXCOM_CLIENT_ID");
  const clientSecret = deps.env("DEXCOM_CLIENT_SECRET");
  const tokenKey = deps.env("DEXCOM_TOKEN_KEY");
  if (!clientId || !clientSecret || !validTokenKey(tokenKey) || !deps.store || !deps.bucketKey) return null;
  return {
    clientId,
    clientSecret,
    tokenKey,
    sandbox: deps.env("DEXCOM_SANDBOX") === "1",
    store: deps.store,
    bucketKey: deps.bucketKey,
  };
}

function hostFor(cfg: Cfg, region: Region): string {
  return cfg.sandbox ? SANDBOX_HOST : HOSTS[region];
}

function isRegion(v: unknown): v is Region {
  return v === "us" || v === "ous" || v === "jp";
}

function authorizeUrl(cfg: Cfg, region: Region, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "offline_access",
    state,
  });
  return `${hostFor(cfg, region)}/v3/oauth2/login?${q.toString()}`;
}

type TokenResult =
  | { ok: true; access: string; refresh: string; expiresInSec: number }
  | { ok: false; kind: "rejected" | "upstream" };

async function tokenRequest(
  deps: Deps,
  cfg: Cfg,
  region: Region,
  form: Record<string, string>,
): Promise<TokenResult> {
  try {
    const res = await deps.fetch(`${hostFor(cfg, region)}/v3/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...form }).toString(),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.status === 400 || res.status === 401) return { ok: false, kind: "rejected" };
    if (!res.ok) return { ok: false, kind: "upstream" };
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, kind: "upstream" };
    }
    if (!isRecord(data) || typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
      return { ok: false, kind: "upstream" };
    }
    const exp = typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 7200;
    return {
      ok: true,
      access: data.access_token,
      refresh: data.refresh_token,
      expiresInSec: Math.min(Math.max(Math.floor(exp), 60), 86_400),
    };
  } catch {
    return { ok: false, kind: "upstream" };
  }
}

function rateLimited(now: number): Response {
  const seconds = Math.ceil((3_600_000 - (now % 3_600_000)) / 1000);
  return json({ error: "rate_limited" }, 429, { "Retry-After": String(seconds) });
}

async function handleStart(deps: Deps, cfg: Cfg, deviceId: string, body: Record<string, unknown>): Promise<Response> {
  const state = typeof body.state === "string" ? body.state.toLowerCase() : "";
  if (!STATE.test(state) || !isRegion(body.region)) return json({ error: "bad_request" }, 400);
  await cfg.store.saveState(await sha256Hex(state), deviceId, body.region, new Date(deps.now()).toISOString());
  return json({ authorizeUrl: authorizeUrl(cfg, body.region, state) }, 200);
}

async function handleExchange(deps: Deps, cfg: Cfg, deviceId: string, body: Record<string, unknown>): Promise<Response> {
  const state = typeof body.state === "string" ? body.state.toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!STATE.test(state)) return json({ error: "state_invalid" }, 400);
  if (!/^[\x21-\x7e]{1,2048}$/.test(code)) return json({ error: "bad_request" }, 400);

  const now = deps.now();
  const region = await cfg.store.consumeState(
    await sha256Hex(state),
    deviceId,
    new Date(now - STATE_TTL_MS).toISOString(),
    new Date(now).toISOString(),
  );
  if (!region) return json({ error: "state_invalid" }, 400);

  const tr = await tokenRequest(deps, cfg, region, {
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  if (!tr.ok) return tr.kind === "rejected" ? json({ error: "code_rejected" }, 400) : json({ error: "upstream" }, 502);

  const linkSecret = randomHex(32);
  await cfg.store.upsertLink({
    device_id: deviceId,
    link_secret_hash: await sha256Hex(linkSecret),
    region,
    refresh_enc: await encryptToken(cfg.tokenKey, deviceId, tr.refresh),
    access_enc: await encryptToken(cfg.tokenKey, deviceId, tr.access),
    access_expires_at: new Date(now + tr.expiresInSec * 1000).toISOString(),
  });
  return json({ linkSecret, region }, 200);
}

async function authLink(req: Request, cfg: Cfg, deviceId: string): Promise<LinkRow | null> {
  const given = (req.headers.get("x-dexcom-link") ?? "").trim().toLowerCase();
  if (!LINK_SECRET.test(given)) return null;
  const link = await cfg.store.getLink(deviceId);
  if (!link) return null;
  return sameHex(await sha256Hex(given), link.link_secret_hash) ? link : null;
}

type Access = { ok: true; token: string } | { ok: false; response: Response };

function validAccess(link: LinkRow, now: number): boolean {
  return !!link.access_enc && !!link.access_expires_at && Date.parse(link.access_expires_at) - now > ACCESS_SKEW_MS;
}

/**
 * Gecerli access token. Suresi dolduysa (ya da force) refresh token harcanir: tek
 * kullanimlik oldugu icin yenileme kilitle (lease) seri yapilir, kilidi alan once satiri
 * tekrar okur (baska istek az once yenilemis olabilir) ve yeni refresh token'i
 * Dexcom'dan donunce hemen yazar.
 */
async function accessToken(deps: Deps, cfg: Cfg, link: LinkRow, force: boolean): Promise<Access> {
  const now = deps.now();
  if (!force && validAccess(link, now)) {
    const cached = await decryptToken(cfg.tokenKey, link.device_id, link.access_enc!);
    if (cached) return { ok: true, token: cached };
  }
  if (!(await cfg.store.claimRefresh(link.link_id, new Date(now).toISOString(), new Date(now + LEASE_MS).toISOString()))) {
    return { ok: false, response: json({ error: "busy" }, 409, { "Retry-After": "2" }) };
  }
  const fresh = await cfg.store.getLink(link.device_id);
  if (!fresh) return { ok: false, response: json({ error: "link_expired" }, 401) };
  if (!force && validAccess(fresh, deps.now())) {
    const cached = await decryptToken(cfg.tokenKey, fresh.device_id, fresh.access_enc!);
    if (cached) {
      await cfg.store.releaseLease(fresh.link_id);
      return { ok: true, token: cached };
    }
  }
  const refresh = await decryptToken(cfg.tokenKey, fresh.device_id, fresh.refresh_enc);
  if (!refresh) {
    await cfg.store.deleteLink(fresh.device_id);
    return { ok: false, response: json({ error: "link_expired" }, 401) };
  }
  const tr = await tokenRequest(deps, cfg, fresh.region, { refresh_token: refresh, grant_type: "refresh_token" });
  if (!tr.ok) {
    if (tr.kind === "rejected") {
      await cfg.store.deleteLink(fresh.device_id);
      return { ok: false, response: json({ error: "link_expired" }, 401) };
    }
    await cfg.store.releaseLease(fresh.link_id);
    return { ok: false, response: json({ error: "upstream" }, 502) };
  }
  const t = deps.now();
  await cfg.store.saveTokens(
    fresh.link_id,
    {
      refresh_enc: await encryptToken(cfg.tokenKey, fresh.device_id, tr.refresh),
      access_enc: await encryptToken(cfg.tokenKey, fresh.device_id, tr.access),
      access_expires_at: new Date(t + tr.expiresInSec * 1000).toISOString(),
    },
    new Date(t).toISOString(),
  );
  return { ok: true, token: tr.access };
}

function parseQueryTime(v: unknown): number | null {
  if (typeof v !== "string" || !QUERY_TIME.test(v)) return null;
  const ms = Date.parse(`${v}Z`);
  return Number.isFinite(ms) ? ms : null;
}

interface Egvs {
  status: number;
  records: unknown[];
}

async function fetchEgvs(deps: Deps, cfg: Cfg, link: LinkRow, token: string, start: string, end: string): Promise<Egvs | null> {
  try {
    const url = `${hostFor(cfg, link.region)}/v3/users/self/egvs?startDate=${start}&endDate=${end}`;
    const res = await deps.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return { status: res.status, records: [] };
    const data = JSON.parse(text);
    const records = isRecord(data) && Array.isArray(data.records) ? data.records : null;
    return records ? { status: 200, records } : null;
  } catch {
    return null;
  }
}

/** Yalniz uygulamanin ihtiyac duydugu alanlar; displayTime, trend, cihaz bilgisi gecmez. */
function minimize(records: unknown[]): Array<{ recordId: string; systemTime: string; value: number; unit: string }> {
  const out: Array<{ recordId: string; systemTime: string; value: number; unit: string }> = [];
  for (const r of records) {
    if (!isRecord(r)) continue;
    const { recordId, systemTime, value } = r;
    if (typeof recordId !== "string" || typeof systemTime !== "string" || typeof value !== "number") continue;
    out.push({ recordId, systemTime, value, unit: typeof r.unit === "string" ? r.unit : "mg/dL" });
  }
  return out;
}

async function handleEgvs(
  deps: Deps,
  cfg: Cfg,
  link: LinkRow,
  body: Record<string, unknown>,
): Promise<Response> {
  const from = parseQueryTime(body.startDate);
  const to = parseQueryTime(body.endDate);
  if (from === null || to === null || to <= from || to - from > MAX_WINDOW_MS) {
    return json({ error: "bad_range" }, 400);
  }
  const start = body.startDate as string;
  const end = body.endDate as string;

  let access = await accessToken(deps, cfg, link, false);
  if (!access.ok) return access.response;
  let result = await fetchEgvs(deps, cfg, link, access.token, start, end);
  if (result && result.status === 401) {
    // Erken iptal ya da onbellekteki token gecersiz: bir kez zorla yenile.
    access = await accessToken(deps, cfg, link, true);
    if (!access.ok) return access.response;
    result = await fetchEgvs(deps, cfg, link, access.token, start, end);
  }
  if (!result) return json({ error: "upstream" }, 502);
  if (result.status === 429) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  if (result.status === 400) return json({ error: "bad_range" }, 400);
  if (result.status === 401) return json({ error: "link_expired" }, 401);
  if (result.status !== 200) return json({ error: "upstream" }, 502);
  return json({ records: minimize(result.records) }, 200);
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return noContent();
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const deviceId = (req.headers.get("x-device-id") ?? "").trim().toLowerCase();
    if (!UUID.test(deviceId)) return json({ error: "bad_device_id" }, 400);

    const cfg = config(deps);
    if (!cfg) return json({ error: "not_configured" }, 503);

    const text = await readBody(req, MAX_BODY_BYTES);
    if (text === null) return json({ error: "too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_json" }, 400);
    }
    if (!isRecord(body)) return json({ error: "bad_json" }, 400);
    const action = body.action;
    if (action !== "start" && action !== "exchange" && action !== "egvs" && action !== "unlink") {
      return json({ error: "bad_action" }, 400);
    }

    try {
      const now = deps.now();
      const [deviceBucket, ipBucket] = await Promise.all([
        hashIp(deviceId, cfg.bucketKey, now),
        deps.callerIp(req).then((ip) => hashIp(ip, cfg.bucketKey, now)),
      ]);
      if (!(await cfg.store.allowed(deviceBucket, ipBucket, DEVICE_HOURLY, IP_HOURLY))) return rateLimited(now);

      if (action === "start") return await handleStart(deps, cfg, deviceId, body);
      if (action === "exchange") return await handleExchange(deps, cfg, deviceId, body);

      const link = await authLink(req, cfg, deviceId);
      if (!link) return json({ error: "unauthorized" }, 401);
      if (action === "unlink") {
        await cfg.store.deleteLink(deviceId);
        return json({ ok: true }, 200);
      }
      return await handleEgvs(deps, cfg, link, body);
    } catch {
      // Depolama hatasi: ayrinti (token, govde) hicbir yere yazilmaz.
      return json({ error: "storage" }, 503);
    }
  };
}
