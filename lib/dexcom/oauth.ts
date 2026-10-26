import { DEXCOM_REDIRECT_URI, type DexcomRegion, isDexcomRegion } from "./config";

/** State omru: kullanici Dexcom girisini bu surede bitirmeli. */
export const STATE_TTL_MS = 10 * 60 * 1000;
export const PENDING_STATE_KEY = "zerospike.dexcom.pendingState";

/** Bekleyen state icin AsyncStorage biciminde saklama. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PendingState {
  state: string;
  region: DexcomRegion;
  createdAt: number;
}

const STATE_SHAPE = /^[0-9a-f]{32,128}$/;

export function isValidStateShape(state: unknown): state is string {
  return typeof state === "string" && STATE_SHAPE.test(state);
}

/** Yeni state uretir ve tek bekleyen yuvaya yazar; onceki bekleyen state gecersiz olur. */
export async function createPendingState(
  kv: KeyValueStore,
  region: DexcomRegion,
  now: number,
  randomHex: () => string
): Promise<PendingState> {
  const state = randomHex().toLowerCase();
  if (!isValidStateShape(state)) throw new Error("dexcom: weak state");
  const pending: PendingState = { state, region, createdAt: now };
  await kv.set(PENDING_STATE_KEY, JSON.stringify(pending));
  return pending;
}

export type StateCheck =
  | { ok: true; pending: PendingState }
  | { ok: false; reason: "no_pending" | "mismatch" | "expired" };

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readPending(raw: string | null): PendingState | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingState>;
    if (isValidStateShape(p.state) && isDexcomRegion(p.region) && typeof p.createdAt === "number") {
      return { state: p.state, region: p.region, createdAt: p.createdAt };
    }
  } catch {
    // bozuk kayit: bekleyen state yok sayilir
  }
  return null;
}

/**
 * Geri donen state'i dogrular. Eslesince ve suresi dolunca bekleyen kayit
 * silinir (tek kullanim); uyusmazlikta silinmez, yoksa baska bir uygulamanin
 * gonderdigi sahte bir baglanti devam eden gercek akisi bozabilirdi.
 */
export async function consumePendingState(
  kv: KeyValueStore,
  received: string | null | undefined,
  now: number
): Promise<StateCheck> {
  const pending = readPending(await kv.get(PENDING_STATE_KEY));
  if (!pending) return { ok: false, reason: "no_pending" };
  if (now - pending.createdAt > STATE_TTL_MS || now < pending.createdAt) {
    await kv.remove(PENDING_STATE_KEY);
    return { ok: false, reason: "expired" };
  }
  if (typeof received !== "string" || !sameString(received.toLowerCase(), pending.state)) {
    return { ok: false, reason: "mismatch" };
  }
  await kv.remove(PENDING_STATE_KEY);
  return { ok: true, pending };
}

/** Dexcom yetkilendirme adresi. Sunucu da ayni bicimi kurar; uygulama yalniz dogrular (isSafeAuthorizeUrl). */
export function buildAuthorizeUrl(p: { host: string; clientId: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: DEXCOM_REDIRECT_URI,
    response_type: "code",
    scope: "offline_access",
    state: p.state,
  });
  return `${p.host}/v3/oauth2/login?${q.toString()}`;
}

const ALLOWED_AUTHORIZE_HOSTS = new Set([
  "api.dexcom.com",
  "api.dexcom.eu",
  "api.dexcom.jp",
  "sandbox-api.dexcom.com",
]);

/** Sunucunun verdigi adres tarayicida acilmadan once: Dexcom hostu, bizim redirect_uri ve state. */
export function isSafeAuthorizeUrl(url: unknown, state: string): url is string {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    ALLOWED_AUTHORIZE_HOSTS.has(u.hostname) &&
    u.pathname === "/v3/oauth2/login" &&
    u.searchParams.get("state") === state &&
    u.searchParams.get("redirect_uri") === DEXCOM_REDIRECT_URI &&
    u.searchParams.get("response_type") === "code" &&
    u.searchParams.get("scope") === "offline_access"
  );
}

export type CallbackParams =
  | { kind: "code"; code: string; state: string }
  | { kind: "denied" }
  | { kind: "invalid" };

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : null;
}

/** zerospike://oauth/dexcom?code&state veya ?error= parametrelerini ayristirir. */
export function parseCallbackParams(params: Record<string, string | string[] | undefined>): CallbackParams {
  if (one(params.error)) return { kind: "denied" };
  const code = one(params.code);
  const state = one(params.state);
  if (!code || !state || code.length > 2048 || !/^[\x21-\x7e]+$/.test(code)) return { kind: "invalid" };
  return { kind: "code", code, state };
}
