/**
 * Nightscout sync races, secure store failures, client hardening and paging
 * (OPUS-6b findings). In-memory deps, no network.
 *
 * Run: npx tsx scripts/nightscoutRace.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  connectNightscout,
  disconnectNightscout,
  readNightscoutState,
  resetNightscoutCursor,
  runNightscoutSync,
  NS_MAX_PAGES,
  type NsDeps,
} from "../lib/nightscout/sync";
import { fetchEntries, verifyAuth } from "../lib/nightscout/client";
import { PAYWALL_REASONS, normalizeEventParams } from "../lib/analytics/eventSchema";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const MIN = 60_000;
const TOKEN = "reader-0123456789abcdef";
const BASE = "https://ns.example.com";

function mkStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}
function mkSecure() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
  };
}
function resp(body: unknown, status = 200, url = "", headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    url,
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => text,
  } as unknown as Response;
}
type Entry = { _id: string; type: string; sgv: number; date: number };

/** A tiny server honouring count, $gt, $lt and $lte. */
function serverFetch(data: Entry[], gate?: () => Promise<void>) {
  let calls = 0;
  const f = (async (u: string) => {
    if (u.includes("verifyauth")) {
      return resp({ status: 200, message: { canRead: true, canWrite: false, isAdmin: false } });
    }
    calls++;
    if (gate) await gate();
    const q = new URL(u).searchParams;
    const count = Number(q.get("count") ?? "10");
    let list = [...data].sort((a, b) => b.date - a.date);
    const gt = q.get("find[date][$gt]");
    const lt = q.get("find[date][$lt]");
    const lte = q.get("find[date][$lte]");
    if (gt != null) list = list.filter((e) => e.date > Number(gt));
    if (lt != null) list = list.filter((e) => e.date < Number(lt));
    if (lte != null) list = list.filter((e) => e.date <= Number(lte));
    return resp(list.slice(0, count));
  }) as unknown as typeof fetch;
  return { f, calls: () => calls };
}
const mk = (n: number, startMin = 1): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ _id: `id${i}`, type: "sgv", sgv: 100 + (i % 50), date: NOW - MIN * (i + startMin) }));

async function setup(data: Entry[], opts: { gate?: () => Promise<void>; pageSize?: number } = {}) {
  const storage = mkStorage();
  const secure = mkSecure();
  const db = new Map<string, string>();
  const srv = serverFetch(data, opts.gate);
  let clock = NOW;
  const deps: NsDeps = {
    storage,
    secure,
    fetchImpl: srv.f,
    now: () => clock,
    pageSize: opts.pageSize,
    insert: async (_p, rows) => {
      let n = 0;
      for (const r of rows) {
        const k = r.externalId ?? r.at;
        if (!db.has(k)) {
          db.set(k, r.at);
          n++;
        }
      }
      return n;
    },
  };
  const c = await connectNightscout("p1", { url: BASE, token: TOKEN }, deps);
  if (!c.ok) throw new Error("connect failed " + c.detail);
  return { storage, secure, db, deps, srv, setClock: (t: number) => (clock = t) };
}

function holdable() {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  let armed = false;
  let first = true;
  return {
    arm: () => (armed = true),
    release: () => release(),
    gate: async () => {
      if (!armed) return;
      if (first) {
        first = false;
        await p;
      }
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  section("2a. Delete data while a sync is in flight");
  {
    const h = holdable();
    const { db, deps } = await setup(mk(10), { gate: h.gate });
    h.arm();
    const sync = runNightscoutSync("p1", deps, { entitled: true });
    await tick();
    db.clear();
    await resetNightscoutCursor("p1", deps);
    h.release();
    await sync;
    const st = await readNightscoutState("p1", deps);
    eq("deleted readings stay deleted", db.size, 0);
    eq("floor survives the in-flight sync", st.floorMs, NOW);
    eq("cursor not rewritten by the stale sync", st.cursorMs, NOW);
  }

  section("2b. Disconnect + delete while the first import is in flight");
  {
    const h = holdable();
    const { db, deps, secure } = await setup(mk(10), { gate: h.gate });
    h.arm();
    const sync = runNightscoutSync("p1", deps, { entitled: true });
    await tick();
    await disconnectNightscout("p1", deps);
    db.clear();
    h.release();
    const out = await sync;
    const st = await readNightscoutState("p1", deps);
    eq("state stays disconnected", st.connected, false);
    eq("no rows after the delete", db.size, 0);
    ok("the superseded sync reports a skip", out.status === "skipped", JSON.stringify(out));
    ok("secret stays gone", secure.m.size === 0);
  }

  section("3. A transient secure store failure does not halt the sync for good");
  {
    const { deps, secure, setClock } = await setup(mk(5));
    const realGet = secure.get;
    let boom = true;
    deps.secure = { ...secure, get: async (k: string) => (boom ? Promise.reject(new Error("busy")) : realGet(k)) };
    const a = await runNightscoutSync("p1", deps, { entitled: true });
    eq("first run reports an error, not reconnect", a.status, "error");
    const s1 = await readNightscoutState("p1", deps);
    ok("status is not reconnect", s1.status !== "reconnect", s1.status);
    ok("backoff applied", s1.nextAttemptAt != null && s1.failures === 1);
    boom = false;
    const early = await runNightscoutSync("p1", deps, { entitled: true });
    ok("still inside backoff", early.status === "skipped" && early.reason === "backoff", JSON.stringify(early));
    setClock(NOW + 6 * MIN);
    const b = await runNightscoutSync("p1", deps, { entitled: true });
    eq("recovers after the backoff", b.status, "ok");
  }
  {
    const { deps, secure } = await setup(mk(5));
    secure.m.clear();
    const out = await runNightscoutSync("p1", deps, { entitled: true });
    ok("a really missing secret still asks to reconnect", out.status === "skipped" && out.reason === "no_credentials");
    eq("status reconnect", (await readNightscoutState("p1", deps)).status, "reconnect");
  }

  section("4. Disconnect keeps the Delete-data floor");
  {
    const { deps, setClock } = await setup(mk(5));
    await resetNightscoutCursor("p1", deps);
    eq("floor set", (await readNightscoutState("p1", deps)).floorMs, NOW);
    await disconnectNightscout("p1", deps);
    setClock(NOW + MIN);
    const c = await connectNightscout("p1", { url: BASE, token: TOKEN }, deps);
    ok("reconnect ok", c.ok);
    eq("floor survived disconnect + reconnect", (await readNightscoutState("p1", deps)).floorMs, NOW);
  }
  {
    const { db, deps } = await setup(mk(5));
    await resetNightscoutCursor("p1", deps);
    await disconnectNightscout("p1", deps);
    await connectNightscout("p1", { url: BASE, token: TOKEN }, deps);
    await runNightscoutSync("p1", deps, { entitled: true });
    eq("cleared readings do not return after reconnect", db.size, 0);
  }

  section("5a. verifyauth: any write-capable permission is refused");
  {
    const v = async (message: unknown) => {
      const f = (async () => resp({ status: 200, message })) as unknown as typeof fetch;
      const r = await verifyAuth(BASE, TOKEN, { fetchImpl: f });
      return r.ok && r.canWrite;
    };
    const base = { canRead: true, canWrite: false, isAdmin: false };
    eq("api:treatments:create", await v({ ...base, permissions: "api:treatments:create" }), true);
    eq("array with :update", await v({ ...base, permissions: ["api:entries:read", "api:profile:update"] }), true);
    eq(":delete", await v({ ...base, permissions: "api:entries:delete" }), true);
    eq("star", await v({ ...base, permissions: "*" }), true);
    eq("api:*:*", await v({ ...base, permissions: "api:*:*" }), true);
    eq("api:*:read is read only", await v({ ...base, permissions: "api:*:read" }), false);
    eq("api:entries:read", await v({ ...base, permissions: ["api:entries:read"] }), false);
    eq("role name", await v({ ...base, permissions: "readable" }), false);
    eq("canWrite still refused", await v({ ...base, canWrite: true }), true);
  }

  section("5b. response size cap");
  {
    const huge = "x".repeat(8 * 1024 * 1024 + 1);
    const f1 = (async () => resp(huge)) as unknown as typeof fetch;
    const r1 = await fetchEntries(BASE, TOKEN, { count: 1, afterMs: 0 }, { fetchImpl: f1 });
    ok("oversized body -> invalid", !r1.ok && r1.error === "invalid", JSON.stringify(r1).slice(0, 80));
    const f2 = (async () => resp("[]", 200, "", { "content-length": String(9 * 1024 * 1024) })) as unknown as typeof fetch;
    const r2 = await fetchEntries(BASE, TOKEN, { count: 1, afterMs: 0 }, { fetchImpl: f2 });
    ok("oversized content-length -> invalid", !r2.ok && r2.error === "invalid");
    const f3 = (async () => resp("[]")) as unknown as typeof fetch;
    const r3 = await fetchEntries(BASE, TOKEN, { count: 1, afterMs: 0 }, { fetchImpl: f3 });
    ok("small body fine", r3.ok);
  }

  section("5c. redirects are checked before the request is sent on");
  {
    const seen: { url: string; redirect?: string }[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      seen.push({ url: u, redirect: init?.redirect });
      return resp("", 302, u, { Location: "http://ns.example.com/api/v1/entries.json" });
    }) as unknown as typeof fetch;
    const r = await fetchEntries(BASE, TOKEN, { count: 1, afterMs: 0 }, { fetchImpl: f });
    ok("redirect to http refused", !r.ok && r.error === "invalid");
    eq("only one request went out", seen.length, 1);
    eq("fetch asked for manual redirects", seen[0]?.redirect, "manual");

    const seen2: string[] = [];
    const g = (async (u: string) => {
      seen2.push(u);
      if (seen2.length === 1) return resp("", 301, u, { Location: "https://www.ns.example.com/api/v1/entries.json?x=1" });
      return resp([], 200, u);
    }) as unknown as typeof fetch;
    const r2 = await fetchEntries(BASE, TOKEN, { count: 1, afterMs: 0 }, { fetchImpl: g });
    ok("https redirect followed", r2.ok && seen2.length === 2, JSON.stringify(r2));
    const loop = (async (u: string) => resp("", 302, u, { Location: "https://ns.example.com/a" })) as unknown as typeof fetch;
    const r3 = await fetchEntries(BASE, TOKEN, { count: 1, afterMs: 0 }, { fetchImpl: loop });
    ok("redirect loop ends", !r3.ok);
  }

  section("5d. paging: same-date rows at the boundary, and the page cap");
  {
    const data: Entry[] = Array.from({ length: 9 }, (_, i) => ({
      _id: `d${i}`,
      type: "sgv",
      sgv: 120 + i,
      date: NOW - 5 * MIN - Math.floor(i / 3) * MIN,
    }));
    const { db, deps } = await setup(data, { pageSize: 4 });
    const out = await runNightscoutSync("p1", deps, { entitled: true });
    eq("sync ok", out.status, "ok");
    eq("rows sharing a date across a page edge are all kept", db.size, 9);
  }
  {
    const pageSize = 2;
    const total = NS_MAX_PAGES * pageSize + 20;
    const { db, deps, setClock } = await setup(mk(total), { pageSize });
    const a = await runNightscoutSync("p1", deps, { entitled: true });
    eq("first pull ok", a.status, "ok");
    ok("first pull stops at the page cap", db.size < total, `size=${db.size}`);
    const st = await readNightscoutState("p1", deps);
    ok("the unread range is remembered", st.backfillToMs != null && st.backfillFromMs != null);
    let rounds = 0;
    while (db.size < total && rounds < 10) {
      rounds++;
      setClock(NOW + rounds * MIN);
      await runNightscoutSync("p1", deps, { entitled: true });
    }
    eq("the following pulls bring in the rest", db.size, total);
    const st2 = await readNightscoutState("p1", deps);
    ok("backfill marker cleared", st2.backfillToMs == null && st2.backfillFromMs == null, JSON.stringify(st2));
  }

  section("6. onboarding paywall reason is in the closed set");
  {
    const src = readFileSync(join(import.meta.dirname, "..", "app/onboarding.tsx"), "utf8");
    const reasons = [...src.matchAll(/pathname: "\/paywall", params: \{ reason: "([a-zA-Z_]+)"/g)].map((m) => m[1]);
    ok("onboarding pushes paywall reasons", reasons.length > 0);
    // The reason the server sees is the one the funnel folds it to (nightscout -> health).
    for (const r of reasons) {
      const sent = String((normalizeEventParams("purchase_result", { reason: r }) as { reason: string }).reason);
      ok(`reason "${r}" is allowed`, (PAYWALL_REASONS as readonly string[]).includes(sent));
    }
  }

  console.log(`\nnightscout race: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
