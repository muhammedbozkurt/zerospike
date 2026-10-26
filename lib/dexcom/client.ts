import { mmolToMgdl } from "../glucose";
import type { DexcomConfig, DexcomRegion } from "./config";
import { isSafeAuthorizeUrl } from "./oauth";

/**
 * dexcom-token edge function istemcisi. Token ve uygulama sirri cihazda yoktur:
 * uygulama function'a kurulum kimligi (x-device-id) ve baglanti sirri
 * (x-dexcom-link) ile gider, function Dexcom'a gider. Saf modul: fetch ve saat
 * disaridan verilir, ag testte sahtedir. Yapilandirma null ise (bayrak kapali)
 * hicbir fonksiyon fetch cagirmaz.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Dexcom v3: bir sorgu en fazla 30 gun, baslangic dahil bitis haric. */
export const MAX_WINDOW_MS = 30 * DAY_MS;
export const REQUEST_TIMEOUT_MS = 20_000;

export type DexcomFailure =
  | "disabled"
  | "no_device"
  | "no_link"
  | "bad_range"
  | "network"
  | "timeout"
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "upstream"
  | "server"
  | "bad_response"
  | "unsafe_url";

export interface Failure {
  ok: false;
  reason: DexcomFailure;
  /** Sunucunun `error` kodu, varsa. Kullaniciya gosterilmez. */
  detail?: string;
  retryAfterSec?: number;
}

export interface ClientDeps {
  config: DexcomConfig | null;
  /** Anonim kurulum uuid'si (lib/identity/deviceId). */
  deviceId: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export interface DexcomReading {
  /** Dexcom recordId; ayni kayit iki kez yazilmaz. */
  externalId: string;
  /** systemTime, UTC epoch ms (displayTime kullanilmaz). */
  ts: number;
  /** mg/dL tamsayi. */
  mgdl: number;
}

export function statusToReason(status: number): DexcomFailure {
  if (status === 400 || status === 404 || status === 405 || status === 413) return "bad_request";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 409 || status === 502 || status === 503 || status === 504) return "upstream";
  return "server";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function call(
  deps: ClientDeps,
  body: Record<string, unknown>,
  linkSecret: string | null
): Promise<{ ok: true; data: Record<string, unknown> } | Failure> {
  if (!deps.config) return { ok: false, reason: "disabled" };
  const deviceId = deps.deviceId.trim().toLowerCase();
  if (!UUID.test(deviceId)) return { ok: false, reason: "no_device" };
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-device-id": deviceId };
  if (linkSecret) headers["x-dexcom-link"] = linkSecret;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await deps.fetch(deps.config.tokenFnUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const obj = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    if (!res.ok) {
      const retry = Number(res.headers?.get?.("Retry-After"));
      return {
        ok: false,
        reason: statusToReason(res.status),
        detail: typeof obj?.error === "string" ? obj.error : undefined,
        ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}),
      };
    }
    if (!obj) return { ok: false, reason: "bad_response" };
    return { ok: true, data: obj };
  } catch (e) {
    const aborted = (e as { name?: string } | null)?.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Sunucuya state'i kaydettirir ve Dexcom giris adresini alir. Adres acilmadan once dogrulanir. */
export async function startAuthorization(
  deps: ClientDeps,
  p: { state: string; region: DexcomRegion }
): Promise<{ ok: true; authorizeUrl: string } | Failure> {
  const r = await call(deps, { action: "start", state: p.state, region: p.region }, null);
  if (!r.ok) return r;
  const url = r.data.authorizeUrl;
  if (!isSafeAuthorizeUrl(url, p.state)) return { ok: false, reason: "unsafe_url" };
  return { ok: true, authorizeUrl: url };
}

/** code + state -> sunucu Dexcom ile takas eder; cihaza yalniz baglanti sirri doner. */
export async function exchangeCode(
  deps: ClientDeps,
  p: { code: string; state: string }
): Promise<{ ok: true; linkSecret: string } | Failure> {
  const r = await call(deps, { action: "exchange", code: p.code, state: p.state }, null);
  if (!r.ok) return r;
  const secret = r.data.linkSecret;
  if (typeof secret !== "string" || !/^[0-9a-f]{64}$/.test(secret)) return { ok: false, reason: "bad_response" };
  return { ok: true, linkSecret: secret };
}

export async function unlinkDexcom(deps: ClientDeps, linkSecret: string): Promise<{ ok: true } | Failure> {
  const r = await call(deps, { action: "unlink" }, linkSecret);
  return r.ok ? { ok: true } : r;
}

/** [start, end) araligini en fazla maxMs'lik, ust uste binmeyen pencerelere boler. */
export function splitWindows(startMs: number, endMs: number, maxMs: number = MAX_WINDOW_MS): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return out;
  for (let from = startMs; from < endMs; from += maxMs) {
    out.push([from, Math.min(from + maxMs, endMs)]);
  }
  return out;
}

/** Dexcom sorgu zamani: UTC, ofsetsiz, saniye hassasiyeti (YYYY-MM-DDTHH:mm:ss). */
export function formatQueryTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** systemTime UTC'dir; ofset yoksa Z eklenir (displayTime asla kullanilmaz). */
export function parseSystemTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  const ms = Date.parse(hasZone ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : null;
}

const MAX_MGDL = 1000;

/** Bir egvs kaydini mg/dL tamsayiya cevirir; taninmayan birim ya da bozuk kayit null. */
export function parseReading(raw: unknown): DexcomReading | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const ts = parseSystemTime(r.systemTime);
  const id = typeof r.recordId === "string" ? r.recordId : typeof r.recordId === "number" ? String(r.recordId) : "";
  const value = r.value;
  if (ts === null || id === "" || id.length > 128 || typeof value !== "number" || !Number.isFinite(value)) return null;
  const unit = r.unit === undefined || r.unit === null ? "mg/dL" : r.unit;
  let mgdl: number;
  if (unit === "mg/dL") mgdl = Math.round(value);
  else if (unit === "mmol/L") mgdl = Math.round(mmolToMgdl(value));
  else return null;
  if (mgdl <= 0 || mgdl > MAX_MGDL) return null;
  return { externalId: id, ts, mgdl };
}

export function parseEgvsRecords(data: unknown): DexcomReading[] | null {
  const records = typeof data === "object" && data !== null ? (data as Record<string, unknown>).records : undefined;
  if (!Array.isArray(records)) return null;
  const out: DexcomReading[] = [];
  for (const rec of records) {
    const parsed = parseReading(rec);
    if (parsed) out.push(parsed);
  }
  return out;
}

export type EgvsResult = { ok: true; readings: DexcomReading[] } | (Failure & { readings: DexcomReading[] });

/**
 * [startMs, endMs) araligindaki okumalar, 30 gunluk pencerelerle ve sirayla.
 * Bir pencere hata verirse o ana kadar toplananlar `readings` ile birlikte
 * hata doner. Sonuc zamana gore artan, recordId'ye gore tekil.
 */
export async function fetchEgvs(
  deps: ClientDeps,
  linkSecret: string | null,
  startMs: number,
  endMs: number
): Promise<EgvsResult> {
  if (!deps.config) return { ok: false, reason: "disabled", readings: [] };
  if (!linkSecret) return { ok: false, reason: "no_link", readings: [] };
  const start = Math.floor(startMs / 1000) * 1000;
  const end = Math.floor(endMs / 1000) * 1000;
  const windows = splitWindows(start, end);
  if (windows.length === 0) return { ok: false, reason: "bad_range", readings: [] };
  const seen = new Map<string, DexcomReading>();
  const sorted = () => [...seen.values()].sort((a, b) => a.ts - b.ts);
  for (const [from, to] of windows) {
    const r = await call(deps, { action: "egvs", startDate: formatQueryTime(from), endDate: formatQueryTime(to) }, linkSecret);
    if (!r.ok) return { ...r, readings: sorted() };
    const parsed = parseEgvsRecords(r.data);
    if (!parsed) return { ok: false, reason: "bad_response", readings: sorted() };
    for (const reading of parsed) {
      if (reading.ts >= from && reading.ts < to && !seen.has(reading.externalId)) seen.set(reading.externalId, reading);
    }
  }
  return { ok: true, readings: sorted() };
}
