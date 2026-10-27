/**
 * Nightscout connection and sync, with every dependency injected (storage,
 * secure store, the import door, fetch, clock) so plain Node tests drive it
 * against a mock server. lib/services/sourceSync.ts wires the real ones.
 *
 * Where things live:
 *  - URL and token: the secure store only, one JSON value per profile.
 *  - Everything else (connected, cursor, last sync, status, backoff): plain
 *    storage. None of it can identify the server.
 *  - The "Delete data" floor lives under its own profile-scoped key, so a
 *    disconnect (which wipes the state) cannot hand the deleted readings back.
 *
 * Races: every state change that matters (disconnect, connect, "Delete data",
 * the end of a sync) goes through a per-profile lock and bumps or checks a
 * generation counter. A sync remembers the generation it started under and
 * writes nothing once it has changed.
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
/** Per-profile: readings at or before this were cleared by the user. */
export const NS_FLOOR_KEY = "zerospike.nightscoutFloor";
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
  /** Bumped by connect, disconnect and "Delete data": a running sync that started
   *  under another value must not write anything. Survives a disconnect. */
  generation: number;
  /** A range a sync could not finish within its page budget: (from, to] still
   *  has to be read. Both null when nothing is pending. */
  backfillFromMs: number | null;
  backfillToMs: number | null;
}

const EMPTY_STATE: NsState = {
  connected: false,
  cursorMs: null,
  floorMs: null,
  lastSyncAt: null,
  status: "ok",
  failures: 0,
  nextAttemptAt: null,
  generation: 0,
  backfillFromMs: null,
  backfillToMs: null,
};

export function nightscoutStateKey(profileId: string): string {
  return `${NS_STATE_KEY}.${profileId}`;
}

export function nightscoutFloorKey(profileId: string): string {
  return `${NS_FLOOR_KEY}.${profileId}`;
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
      generation: Math.max(0, Math.floor(numOrNull(o.generation) ?? 0)),
      backfillFromMs: numOrNull(o.backfillFromMs),
      backfillToMs: numOrNull(o.backfillToMs),
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function readNightscoutState(profileId: string, deps: NsDeps): Promise<NsState> {
  let state: NsState;
  try {
    state = parseState(await deps.storage.getItem(nightscoutStateKey(profileId)));
  } catch {
    state = { ...EMPTY_STATE };
  }
  try {
    const floor = numOrNull(Number(await deps.storage.getItem(nightscoutFloorKey(profileId))));
    // An older build kept the floor inside the state: the larger one wins.
    if (floor != null && floor > 0) state.floorMs = Math.max(state.floorMs ?? 0, floor);
  } catch {
    // the state's own copy (if any) is all there is
  }
  return state;
}

async function writeFloor(profileId: string, deps: NsDeps, floorMs: number): Promise<void> {
  const key = nightscoutFloorKey(profileId);
  const current = Number(await deps.storage.getItem(key));
  // Never lowers: a stale writer cannot bring deleted readings back.
  if (Number.isFinite(current) && current >= floorMs) return;
  await deps.storage.setItem(key, String(floorMs));
}

async function writeState(profileId: string, deps: NsDeps, state: NsState): Promise<void> {
  const { floorMs, ...rest } = state;
  if (floorMs != null) await writeFloor(profileId, deps, floorMs);
  await deps.storage.setItem(nightscoutStateKey(profileId), JSON.stringify(rest));
}

const locks = new Map<string, Promise<unknown>>();

/** Serialises the read-check-write steps on one profile's state. */
function withLock<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(profileId) ?? Promise.resolve()).then(fn);
  locks.set(profileId, next.catch(() => undefined));
  return next;
}

interface Credentials {
  url: string;
  token: string | null;
}

type CredentialsRead = { kind: "ok"; creds: Credentials } | { kind: "missing" } | { kind: "error" };

/** "error" is a store that failed to answer (try again later); "missing" is a
 *  secret that is really gone or unusable (the person has to reconnect). */
async function readCredentials(profileId: string, deps: NsDeps): Promise<CredentialsRead> {
  if (!deps.secure) return { kind: "missing" };
  let raw: string | null;
  try {
    raw = await deps.secure.get(nightscoutSecretKey(profileId));
  } catch (err) {
    deps.onError?.("secureGet", err);
    return { kind: "error" };
  }
  if (!raw) return { kind: "missing" };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.url !== "string" || !o.url.startsWith("https://")) return { kind: "missing" };
    return {
      kind: "ok",
      creds: { url: o.url, token: typeof o.token === "string" && o.token ? o.token : null },
    };
  } catch {
    return { kind: "missing" };
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
    await withLock(profileId, async () => {
      const previous = await readNightscoutState(profileId, deps);
      await writeState(profileId, deps, {
        ...EMPTY_STATE,
        connected: true,
        cursorMs: previous.cursorMs,
        floorMs: previous.floorMs,
        lastSyncAt: previous.lastSyncAt,
        generation: previous.generation + 1,
        backfillFromMs: previous.backfillFromMs,
        backfillToMs: previous.backfillToMs,
      });
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
 *  separately (lib/nightscout/localData.ts), only when the user asks. The
 *  state is kept as a disconnected tombstone so the generation keeps counting
 *  (a sync still in flight must see the change); the "Delete data" floor is
 *  not touched. */
export async function disconnectNightscout(profileId: string, deps: NsDeps): Promise<void> {
  try {
    await deps.secure?.remove(nightscoutSecretKey(profileId));
  } catch (err) {
    deps.onError?.("secureRemove", err);
  }
  try {
    await withLock(profileId, async () => {
      const previous = await readNightscoutState(profileId, deps);
      await writeState(profileId, deps, {
        ...EMPTY_STATE,
        floorMs: previous.floorMs,
        generation: previous.generation + 1,
      });
    });
  } catch (err) {
    deps.onError?.("stateRemove", err);
  }
}

/** "Delete data": readings up to now never come back, and polling resumes from now. */
export async function resetNightscoutCursor(profileId: string, deps: NsDeps): Promise<void> {
  await withLock(profileId, async () => {
    const state = await readNightscoutState(profileId, deps);
    const now = (deps.now ?? Date.now)();
    if (!state.connected) {
      // Not connected now: a later reconnect must still not bring them back.
      await writeFloor(profileId, deps, now);
      return;
    }
    await writeState(profileId, deps, {
      ...state,
      cursorMs: now,
      floorMs: now,
      generation: state.generation + 1,
      backfillFromMs: null,
      backfillToMs: null,
    });
  });
}

// ── sync ─────────────────────────────────────────────────────────────────

export type NsSkipReason =
  | "not_connected"
  | "not_entitled"
  | "halted"
  | "backoff"
  | "no_credentials"
  | "busy"
  | "superseded";

export type NsSyncOutcome =
  | { status: "ok"; inserted: number; read: number }
  | { status: "skipped"; reason: NsSkipReason }
  | { status: "error"; error: NsError | "storage" };

const running = new Map<string, Promise<unknown>>();

/** Resolves once no sync is running for the profile (used before deleting the
 *  readings a sync might still be inserting). */
export async function awaitNightscoutIdle(profileId: string): Promise<void> {
  const current = running.get(profileId);
  if (current) await current.catch(() => undefined);
}

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
  const job = runLocked(profileId, deps, opts);
  running.set(profileId, job);
  try {
    return await job;
  } finally {
    running.delete(profileId);
  }
}

const SUPERSEDED: NsSyncOutcome = { status: "skipped", reason: "superseded" };

/** The current state when the connection is still the one this sync started under. */
async function stillCurrent(profileId: string, deps: NsDeps, generation: number): Promise<NsState | null> {
  const fresh = await readNightscoutState(profileId, deps);
  return fresh.connected && fresh.generation === generation ? fresh : null;
}

/** Re-reads the state under the lock and writes `build(fresh)`; false (and no
 *  write) when the connection changed since the sync started. */
async function commit(
  profileId: string,
  deps: NsDeps,
  generation: number,
  build: (fresh: NsState) => NsState
): Promise<boolean> {
  return withLock(profileId, async () => {
    const fresh = await stillCurrent(profileId, deps, generation);
    if (!fresh) return false;
    try {
      await writeState(profileId, deps, build(fresh));
    } catch (err) {
      deps.onError?.("stateWrite", err);
    }
    return true;
  });
}

type Pull =
  | { kind: "done"; newest: number | null; oldest: number | null; inserted: number; read: number; complete: boolean }
  | { kind: "stop"; outcome: NsSyncOutcome };

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
  const gen = state.generation;
  const read0 = await readCredentials(profileId, deps);
  if (read0.kind === "missing") {
    await commit(profileId, deps, gen, (fresh) => ({ ...fresh, status: "reconnect" }));
    return { status: "skipped", reason: "no_credentials" };
  }
  if (read0.kind === "error") {
    const failures = state.failures + 1;
    await commit(profileId, deps, gen, (fresh) => ({
      ...fresh,
      status: "network",
      failures,
      nextAttemptAt: now + backoffMs(failures),
    }));
    return { status: "error", error: "storage" };
  }
  const creds = read0.creds;

  const reqOpts = { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs ?? NS_REQUEST_TIMEOUT_MS };
  const pageSize = deps.pageSize ?? NS_PAGE_SIZE;
  const since = Math.max(
    state.cursorMs != null ? state.cursorMs - NS_LOOKBACK_MS : now - NS_FIRST_IMPORT_DAYS * DAY,
    state.floorMs ?? 0
  );

  /** Newest-first pages over (afterMs, startBefore]; stops at the page budget. */
  async function pull(afterMs: number, startBefore: number | undefined): Promise<Pull> {
    let beforeMs = startBefore;
    let newest: number | null = null;
    let oldest: number | null = null;
    let inserted = 0;
    let read = 0;
    for (let page = 0; page < NS_MAX_PAGES; page++) {
      const got = await fetchEntries(creds.url, creds.token, { count: pageSize, afterMs, beforeMs }, reqOpts);
      if (!got.ok) {
        return { kind: "stop", outcome: await failed(profileId, deps, gen, now, got.error, got.retryAfterMs) };
      }
      // Re-read before touching the database: a disconnect or "Delete data"
      // that happened while the request was out must win.
      const fresh = await stillCurrent(profileId, deps, gen);
      if (!fresh) return { kind: "stop", outcome: SUPERSEDED };
      const parsed = parseNightscoutEntries(got.entries, now, fresh.floorMs);
      read += parsed.rows.length;
      if (parsed.newestMs != null && (newest == null || parsed.newestMs > newest)) newest = parsed.newestMs;
      if (parsed.rows.length > 0) inserted += await deps.insert(profileId, parsed.rows);
      if (parsed.oldestMs != null) oldest = oldest == null ? parsed.oldestMs : Math.min(oldest, parsed.oldestMs);
      if (got.entries.length < pageSize || parsed.oldestMs == null) {
        return { kind: "done", newest, oldest, inserted, read, complete: true };
      }
      // The boundary is inclusive, so a run of rows sharing one date is not cut
      // in half. A whole page on one date cannot move on: leave it.
      if (parsed.oldestMs === beforeMs) return { kind: "done", newest, oldest, inserted, read, complete: true };
      beforeMs = parsed.oldestMs;
    }
    return { kind: "done", newest, oldest, inserted, read, complete: false };
  }

  let newest: number | null = null;
  let inserted = 0;
  let read = 0;
  let backfillFrom = state.backfillFromMs;
  let backfillTo = state.backfillToMs;
  try {
    const forward = await pull(since, undefined);
    if (forward.kind === "stop") return forward.outcome;
    newest = forward.newest;
    inserted += forward.inserted;
    read += forward.read;
    if (!forward.complete && forward.oldest != null) {
      // More than the page budget is waiting: the cursor still moves to the
      // newest reading, and the older range is left for the next pull.
      backfillFrom = backfillFrom == null ? since : Math.min(backfillFrom, since);
      backfillTo = backfillTo == null ? forward.oldest : Math.max(backfillTo, forward.oldest);
    } else if (backfillFrom != null && backfillTo != null) {
      const back = await pull(backfillFrom, backfillTo);
      if (back.kind === "stop") return back.outcome;
      inserted += back.inserted;
      read += back.read;
      if (back.complete || back.oldest == null) {
        backfillFrom = null;
        backfillTo = null;
      } else {
        backfillTo = back.oldest;
      }
    }
  } catch (err) {
    deps.onError?.("sync", err);
    return { status: "error", error: "storage" };
  }

  const wrote = await commit(profileId, deps, gen, (fresh) => ({
    ...fresh,
    cursorMs: newest != null ? Math.max(newest, fresh.cursorMs ?? 0) : fresh.cursorMs,
    lastSyncAt: now,
    status: "ok",
    failures: 0,
    nextAttemptAt: null,
    backfillFromMs: backfillFrom,
    backfillToMs: backfillTo,
  }));
  if (!wrote) return SUPERSEDED;
  return { status: "ok", inserted, read };
}

async function failed(
  profileId: string,
  deps: NsDeps,
  generation: number,
  now: number,
  error: NsError,
  retryAfterMs?: number
): Promise<NsSyncOutcome> {
  if (error === "auth") {
    const wrote = await commit(profileId, deps, generation, (fresh) => ({
      ...fresh,
      status: "auth",
      nextAttemptAt: null,
    }));
    return wrote ? { status: "error", error } : SUPERSEDED;
  }
  let wait = 0;
  const wrote = await commit(profileId, deps, generation, (fresh) => {
    const failures = fresh.failures + 1;
    wait = Math.max(backoffMs(failures), error === "rate_limited" ? (retryAfterMs ?? 0) : 0);
    return {
      ...fresh,
      status: error === "invalid" ? "invalid" : "network",
      failures,
      nextAttemptAt: now + wait,
    };
  });
  if (!wrote) return SUPERSEDED;
  return { status: "error", error: error === "timeout" ? "network" : error };
}
