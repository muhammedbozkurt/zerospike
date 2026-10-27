/**
 * Nightscout connection and sync, with every dependency injected (storage,
 * secure store, the import door, fetch, clock) so plain Node tests drive it
 * against a mock server. lib/services/sourceSync.ts wires the real ones.
 *
 * Where things live:
 *  - URL and token: the secure store only, one JSON value per profile.
 *  - Everything else (connected, cursor, last sync, status, backoff): plain
 *    storage. None of it can identify the server.
 *
 * Nothing here logs, tracks or returns an error message. Failures are enums;
 * unexpected exceptions go to deps.onError(stage, err), and the wiring turns
 * them into a message-free error before logging (lib/nightscout/safeError.ts).
 */
import type { ImportedGlucoseRow } from "../db/healthImportSql";
import {
  fetchEntries,
  NS_REQUEST_TIMEOUT_MS,
  NS_TEST_TIMEOUT_MS,
  verifyAuth,
  type NsError,
} from "./client";
import { parseNightscoutEntries } from "./parse";
import { parseNightscoutUrl, validateNightscoutToken } from "./url";

export const NS_STATE_KEY = "zerospike.nightscoutState";
export const NS_SECRET_KEY = "zerospike.nightscout";
export const NS_FIRST_IMPORT_DAYS = 30;
export const NS_PAGE_SIZE = 2000;
/** 25 pages x 2000 covers 30 days of one reading a minute. */
export const NS_MAX_PAGES = 25;
/** Re-reads this much behind the cursor: late uploads land behind the newest reading. */
export const NS_LOOKBACK_MS = 10 * 60_000;
export const NS_BACKOFF_MINUTES = [5, 10, 20, 40, 60] as const;

const MIN = 60_000;
const DAY = 86_400_000;

export interface NsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface NsSecure {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface NsDeps {
  storage: NsStorage;
  /** null when the device has no secure store: Nightscout is then unavailable. */
  secure: NsSecure | null;
  insert: (profileId: string, rows: ImportedGlucoseRow[]) => Promise<number>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  testTimeoutMs?: number;
  pageSize?: number;
  onError?: (stage: string, err: unknown) => void;
}

export type NsStatus = "ok" | "auth" | "network" | "invalid" | "reconnect";

export interface NsState {
  connected: boolean;
  /** Newest reading date seen (epoch ms). */
  cursorMs: number | null;
  /** Readings at or before this were cleared by the user and never return. */
  floorMs: number | null;
  lastSyncAt: number | null;
  status: NsStatus;
  failures: number;
  nextAttemptAt: number | null;
}

const EMPTY_STATE: NsState = {
  connected: false,
  cursorMs: null,
  floorMs: null,
  lastSyncAt: null,
  status: "ok",
  failures: 0,
  nextAttemptAt: null,
};

export function nightscoutStateKey(profileId: string): string {
  return `${NS_STATE_KEY}.${profileId}`;
}

export function nightscoutSecretKey(profileId: string): string {
  return `${NS_SECRET_KEY}.${profileId}`;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseState(raw: string | null): NsState {
  if (!raw) return { ...EMPTY_STATE };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const status = o.status;
    return {
      connected: o.connected === true,
      cursorMs: numOrNull(o.cursorMs),
      floorMs: numOrNull(o.floorMs),
      lastSyncAt: numOrNull(o.lastSyncAt),
      status:
        status === "auth" || status === "network" || status === "invalid" || status === "reconnect"
          ? status
          : "ok",
      failures: Math.max(0, Math.floor(numOrNull(o.failures) ?? 0)),
      nextAttemptAt: numOrNull(o.nextAttemptAt),
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function readNightscoutState(profileId: string, deps: NsDeps): Promise<NsState> {
  try {
    return parseState(await deps.storage.getItem(nightscoutStateKey(profileId)));
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(profileId: string, deps: NsDeps, state: NsState): Promise<void> {
  await deps.storage.setItem(nightscoutStateKey(profileId), JSON.stringify(state));
}

interface Credentials {
  url: string;
  token: string | null;
}

async function readCredentials(profileId: string, deps: NsDeps): Promise<Credentials | null> {
  if (!deps.secure) return null;
  try {
    const raw = await deps.secure.get(nightscoutSecretKey(profileId));
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.url !== "string" || !o.url.startsWith("https://")) return null;
    return { url: o.url, token: typeof o.token === "string" && o.token ? o.token : null };
  } catch {
    return null;
  }
}

// ── connection test ──────────────────────────────────────────────────────

export type NsTestResultKind = "ok" | "auth" | "network" | "invalid";

export type NsTestDetail =
  | "ok"
  | "empty"
  | "auth"
  | "network"
  | "timeout"
  | "rate_limited"
  | "invalid_url"
  | "insecure_url"
  | "credentials_url"
  | "api_secret"
  | "bad_token"
  | "write_token"
  | "not_nightscout"
  | "unavailable";

export interface NsTestResult {
  /** The only value that may reach analytics. */
  result: NsTestResultKind;
  detail: NsTestDetail;
  latestMs: number | null;
  /** A token that was pasted inside the address, for the token field. */
  token: string | null;
  /** Normalised base address (never logged, never tracked). */
  base: string | null;
  /** The token to store. */
  useToken: string | null;
}

function testFail(result: NsTestResultKind, detail: NsTestDetail, extra: Partial<NsTestResult> = {}): NsTestResult {
  return { result, detail, latestMs: null, token: null, base: null, useToken: null, ...extra };
}

function errorToTest(error: NsError, extra: Partial<NsTestResult>): NsTestResult {
  switch (error) {
    case "auth":
      return testFail("auth", "auth", extra);
    case "timeout":
      return testFail("network", "timeout", extra);
    case "rate_limited":
      return testFail("network", "rate_limited", extra);
    case "invalid":
      return testFail("invalid", "not_nightscout", extra);
    default:
      return testFail("network", "network", extra);
  }
}

export async function testConnection(
  input: { url: string; token: string },
  deps: NsDeps
): Promise<NsTestResult> {
  const url = parseNightscoutUrl(input.url);
  if (!url.ok) {
    const detail: NsTestDetail =
      url.error === "insecure"
        ? "insecure_url"
        : url.error === "credentials"
          ? "credentials_url"
          : "invalid_url";
    return testFail("invalid", detail);
  }
  const typed = input.token.trim();
  const tokenCheck = validateNightscoutToken(typed.length > 0 ? typed : (url.token ?? ""));
  if (!tokenCheck.ok) {
    return testFail("invalid", tokenCheck.error === "api_secret" ? "api_secret" : "bad_token");
  }
  const token = tokenCheck.token;
  const carried = url.token;
  const opts = { fetchImpl: deps.fetchImpl, timeoutMs: deps.testTimeoutMs ?? NS_TEST_TIMEOUT_MS };
  const now = (deps.now ?? Date.now)();
  const base = { base: url.base, token: carried, useToken: token };

  const latest = await fetchEntries(url.base, token, { count: 1, afterMs: 0 }, opts);
  if (!latest.ok) return errorToTest(latest.error, base);

  const parsed = parseNightscoutEntries(latest.entries, now);
  const verified = await verifyAuth(url.base, token, opts);
  if (!verified.ok) return errorToTest(verified.error, base);
  if (verified.canWrite) return testFail("invalid", "write_token", base);

  return {
    result: "ok",
    detail: latest.entries.length === 0 ? "empty" : "ok",
    latestMs: parsed.newestMs,
    ...base,
  };
}

// ── connect / disconnect ─────────────────────────────────────────────────

export type NsConnectResult =
  | { ok: true; latestMs: number | null; result: "ok"; detail: NsTestDetail }
  | { ok: false; result: NsTestResultKind; detail: NsTestDetail };

export async function connectNightscout(
  profileId: string,
  input: { url: string; token: string },
  deps: NsDeps
): Promise<NsConnectResult> {
  if (!deps.secure) return { ok: false, result: "invalid", detail: "unavailable" };
  const tested = await testConnection(input, deps);
  if (tested.result !== "ok" || tested.base == null) {
    return { ok: false, result: tested.result, detail: tested.detail };
  }
  try {
    await deps.secure.set(
      nightscoutSecretKey(profileId),
      JSON.stringify({ url: tested.base, token: tested.useToken })
    );
  } catch (err) {
    deps.onError?.("secureSet", err);
    return { ok: false, result: "invalid", detail: "unavailable" };
  }
  try {
    const previous = await readNightscoutState(profileId, deps);
    await writeState(profileId, deps, {
      ...EMPTY_STATE,
      connected: true,
      cursorMs: previous.cursorMs,
      floorMs: previous.floorMs,
      lastSyncAt: previous.lastSyncAt,
    });
  } catch (err) {
    deps.onError?.("stateWrite", err);
    try {
      await deps.secure.remove(nightscoutSecretKey(profileId));
    } catch {
      // nothing more to undo
    }
    return { ok: false, result: "invalid", detail: "unavailable" };
  }
  return { ok: true, result: "ok", latestMs: tested.latestMs, detail: tested.detail };
}

/** Stops polling and forgets the connection. Imported readings are removed
 *  separately (lib/nightscout/localData.ts), only when the user asks. */
export async function disconnectNightscout(profileId: string, deps: NsDeps): Promise<void> {
  try {
    await deps.secure?.remove(nightscoutSecretKey(profileId));
  } catch (err) {
    deps.onError?.("secureRemove", err);
  }
  try {
    await deps.storage.removeItem(nightscoutStateKey(profileId));
  } catch (err) {
    deps.onError?.("stateRemove", err);
  }
}

/** "Delete data": readings up to now never come back, and polling resumes from now. */
export async function resetNightscoutCursor(profileId: string, deps: NsDeps): Promise<void> {
  const state = await readNightscoutState(profileId, deps);
  if (!state.connected) return;
  const now = (deps.now ?? Date.now)();
  await writeState(profileId, deps, { ...state, cursorMs: now, floorMs: now });
}

// ── sync ─────────────────────────────────────────────────────────────────

export type NsSkipReason = "not_connected" | "not_entitled" | "halted" | "backoff" | "no_credentials" | "busy";

export type NsSyncOutcome =
  | { status: "ok"; inserted: number; read: number }
  | { status: "skipped"; reason: NsSkipReason }
  | { status: "error"; error: NsError | "storage" };

const running = new Set<string>();

function backoffMs(failures: number): number {
  const i = Math.min(Math.max(failures, 1), NS_BACKOFF_MINUTES.length) - 1;
  return NS_BACKOFF_MINUTES[i] * MIN;
}

export async function runNightscoutSync(
  profileId: string,
  deps: NsDeps,
  opts: { entitled: boolean }
): Promise<NsSyncOutcome> {
  if (running.has(profileId)) return { status: "skipped", reason: "busy" };
  running.add(profileId);
  try {
    return await runLocked(profileId, deps, opts);
  } finally {
    running.delete(profileId);
  }
}

async function runLocked(
  profileId: string,
  deps: NsDeps,
  opts: { entitled: boolean }
): Promise<NsSyncOutcome> {
  const now = (deps.now ?? Date.now)();
  const state = await readNightscoutState(profileId, deps);
  if (!state.connected) return { status: "skipped", reason: "not_connected" };
  if (!opts.entitled) return { status: "skipped", reason: "not_entitled" };
  if (state.status === "auth" || state.status === "reconnect") {
    return { status: "skipped", reason: "halted" };
  }
  if (state.nextAttemptAt != null && now < state.nextAttemptAt) {
    return { status: "skipped", reason: "backoff" };
  }
  const creds = await readCredentials(profileId, deps);
  if (!creds) {
    await safeWrite(profileId, deps, { ...state, status: "reconnect" });
    return { status: "skipped", reason: "no_credentials" };
  }

  const reqOpts = { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs ?? NS_REQUEST_TIMEOUT_MS };
  const pageSize = deps.pageSize ?? NS_PAGE_SIZE;
  const floor = state.floorMs ?? 0;
  const since = Math.max(
    state.cursorMs != null ? state.cursorMs - NS_LOOKBACK_MS : now - NS_FIRST_IMPORT_DAYS * DAY,
    floor
  );

  let beforeMs: number | undefined;
  let newest: number | null = null;
  let inserted = 0;
  let read = 0;
  try {
    for (let page = 0; page < NS_MAX_PAGES; page++) {
      const got = await fetchEntries(
        creds.url,
        creds.token,
        { count: pageSize, afterMs: since, beforeMs },
        reqOpts
      );
      if (!got.ok) return await failed(profileId, deps, state, now, got.error, got.retryAfterMs);
      const parsed = parseNightscoutEntries(got.entries, now, state.floorMs);
      read += parsed.rows.length;
      if (parsed.newestMs != null && (newest == null || parsed.newestMs > newest)) newest = parsed.newestMs;
      if (parsed.rows.length > 0) inserted += await deps.insert(profileId, parsed.rows);
      if (got.entries.length < pageSize || parsed.oldestMs == null) break;
      beforeMs = parsed.oldestMs;
    }
  } catch (err) {
    deps.onError?.("sync", err);
    return { status: "error", error: "storage" };
  }

  await safeWrite(profileId, deps, {
    ...state,
    cursorMs: newest != null ? Math.max(newest, state.cursorMs ?? 0) : state.cursorMs,
    lastSyncAt: now,
    status: "ok",
    failures: 0,
    nextAttemptAt: null,
  });
  return { status: "ok", inserted, read };
}

async function safeWrite(profileId: string, deps: NsDeps, state: NsState): Promise<void> {
  try {
    await writeState(profileId, deps, state);
  } catch (err) {
    deps.onError?.("stateWrite", err);
  }
}

async function failed(
  profileId: string,
  deps: NsDeps,
  state: NsState,
  now: number,
  error: NsError,
  retryAfterMs?: number
): Promise<NsSyncOutcome> {
  if (error === "auth") {
    await safeWrite(profileId, deps, { ...state, status: "auth", nextAttemptAt: null });
    return { status: "error", error };
  }
  const failures = state.failures + 1;
  const wait = Math.max(backoffMs(failures), error === "rate_limited" ? (retryAfterMs ?? 0) : 0);
  await safeWrite(profileId, deps, {
    ...state,
    status: error === "invalid" ? "invalid" : "network",
    failures,
    nextAttemptAt: now + wait,
  });
  return { status: "error", error: error === "timeout" ? "network" : error };
}
