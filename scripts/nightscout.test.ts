/**
 * CGM-E: Nightscout client, parser and sync against a mock Nightscout server
 * (node:http on 127.0.0.1, random port). The app only ever speaks https, so the
 * injected fetch maps the fake https origin onto the mock server and hands the
 * original https URL back as `res.url`.
 *
 * Run: npx tsx scripts/nightscout.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  connectNightscout,
  disconnectNightscout,
  readNightscoutState,
  resetNightscoutCursor,
  runNightscoutSync,
  testConnection,
  type NsDeps,
} from "../lib/nightscout/sync";
import { parseNightscoutEntries } from "../lib/nightscout/parse";

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
const ORIGIN = "https://ns.example.org";
const TOKEN = "reader-0123456789abcdef";
const PROFILE = "P1";

// ── mock server ──────────────────────────────────────────────────────────
interface Entry {
  _id: string;
  type: string;
  date: number;
  sgv: unknown;
  dateString?: string;
  utcOffset?: number;
  device?: string;
  [k: string]: unknown;
}
const srv = {
  data: [] as Entry[],
  requireToken: true,
  mode: "ok" as "ok" | "401" | "403" | "hang" | "html" | "badjson" | "notarray" | "429" | "500" | "redirect",
  canWrite: false,
  isAdmin: false,
  verifyStatus: 200,
  log: [] as { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"] }[],
};
function resetServer(): void {
  srv.data = [];
  srv.requireToken = true;
  srv.mode = "ok";
  srv.canWrite = false;
  srv.isAdmin = false;
  srv.verifyStatus = 200;
  srv.log = [];
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  srv.log.push({ method: req.method ?? "", path: u.pathname, query: u.searchParams, headers: req.headers });
  if (srv.mode === "hang") return;
  if (srv.mode === "429") {
    res.writeHead(429, { "Retry-After": "120" });
    res.end("slow down");
    return;
  }
  if (srv.mode === "500") {
    res.writeHead(500);
    res.end("boom");
    return;
  }
  if (srv.mode === "403") {
    res.writeHead(403);
    res.end("no");
    return;
  }
  const tokenOk = !srv.requireToken || u.searchParams.get("token") === TOKEN;
  if (srv.mode === "401" || !tokenOk) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: 401, message: "Unauthorized" }));
    return;
  }
  if (u.pathname === "/api/v1/verifyauth") {
    res.writeHead(srv.verifyStatus, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ message: { canRead: true, canWrite: srv.canWrite, isAdmin: srv.isAdmin, message: "OK", rolefound: "FOUND" } })
    );
    return;
  }
  if (u.pathname !== "/api/v1/entries.json") {
    res.writeHead(404);
    res.end("nope");
    return;
  }
  if (srv.mode === "html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>Welcome</body></html>");
    return;
  }
  if (srv.mode === "badjson") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('[{"_id": "a", "sgv": ');
    return;
  }
  if (srv.mode === "notarray") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  const count = Number(u.searchParams.get("count") ?? "10");
  const gt = u.searchParams.get("find[date][$gt]");
  const lt = u.searchParams.get("find[date][$lt]");
  let list = [...srv.data].sort((a, b) => b.date - a.date);
  if (gt != null) list = list.filter((e) => e.date > Number(gt));
  if (lt != null) list = list.filter((e) => e.date < Number(lt));
  list = list.slice(0, count);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(list));
}

let server: Server;
let port = 0;

// ── deps ─────────────────────────────────────────────────────────────────
const kv = new Map<string, string>();
const vault = new Map<string, string>();
const imported = new Map<string, { at: string; mgdl: number; sourceApp: string | null; isCgm: boolean }>();
const errors: { stage: string; err: unknown }[] = [];
let insertCalls = 0;
let clock = NOW;

function mapFetch(real: typeof fetch): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const original = String(input);
    const rewritten = original.replace(ORIGIN, `http://127.0.0.1:${port}`);
    if (rewritten === original) throw new TypeError("fetch failed: unexpected origin");
    const res = await real(rewritten, init);
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url: original,
      headers: { get: (k: string) => res.headers.get(k) },
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function makeDeps(over: Partial<NsDeps> = {}): NsDeps {
  return {
    storage: {
      getItem: async (k) => kv.get(k) ?? null,
      setItem: async (k, v) => void kv.set(k, v),
      removeItem: async (k) => void kv.delete(k),
    },
    secure: {
      get: async (k) => vault.get(k) ?? null,
      set: async (k, v) => void vault.set(k, v),
      remove: async (k) => void vault.delete(k),
    },
    insert: async (_profileId, rows) => {
      insertCalls++;
      let n = 0;
      for (const r of rows) {
        const key = `${r.source}:${r.externalId}`;
        if (imported.has(key)) continue;
        imported.set(key, { at: r.at, mgdl: r.mgdl, sourceApp: r.sourceApp ?? null, isCgm: r.isCgm });
        n++;
      }
      return n;
    },
    fetchImpl: mapFetch(fetch),
    now: () => clock,
    timeoutMs: 2000,
    testTimeoutMs: 2000,
    onError: (stage, err) => void errors.push({ stage, err }),
    ...over,
  };
}

function reset(): void {
  resetServer();
  kv.clear();
  vault.clear();
  imported.clear();
  errors.length = 0;
  insertCalls = 0;
  clock = NOW;
}

function series(n: number, stepMin = 5, endMs = NOW - 2 * MIN, sgv = (i: number) => 100 + (i % 50)): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const date = endMs - i * stepMin * MIN;
    out.push({ _id: `id${date}`, type: "sgv", date, sgv: sgv(i), device: "share2" });
  }
  return out;
}

async function main(): Promise<void> {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
  console.log("zerospike nightscout test");

  section("A. connection test");
  {
    reset();
    srv.data = series(3);
    const deps = makeDeps();
    const r = await testConnection({ url: ORIGIN, token: TOKEN }, deps);
    eq("200 -> ok", r.result, "ok");
    eq("latest reading time", r.latestMs, NOW - 2 * MIN);
    ok("every request is GET", srv.log.length > 0 && srv.log.every((l) => l.method === "GET"));
    ok("token rides in the query", srv.log.every((l) => l.query.get("token") === TOKEN));
    ok("count is always given", srv.log.filter((l) => l.path.endsWith("entries.json")).every((l) => l.query.get("count") != null));
  }
  {
    reset();
    srv.data = [];
    const r = await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps());
    eq("empty server is still ok", r.result, "ok");
    eq("empty detail", r.detail, "empty");
    eq("no latest", r.latestMs, null);
  }
  {
    reset();
    srv.data = series(2);
    const r = await testConnection({ url: ORIGIN, token: "reader-ffffffffffffffff" }, makeDeps());
    eq("401 -> auth", r.result, "auth");
  }
  {
    reset();
    srv.mode = "403";
    eq("403 -> auth", (await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps())).result, "auth");
  }
  {
    reset();
    srv.requireToken = false;
    srv.data = series(2);
    const r = await testConnection({ url: ORIGIN, token: "" }, makeDeps());
    eq("readable server works without token", r.result, "ok");
    ok("no token param sent", srv.log.every((l) => !l.query.has("token")));
  }
  {
    reset();
    const dead = makeDeps({
      fetchImpl: (async () => {
        throw new TypeError("Network request failed");
      }) as unknown as typeof fetch,
    });
    eq("network failure -> network", (await testConnection({ url: ORIGIN, token: TOKEN }, dead)).result, "network");
  }
  {
    reset();
    srv.mode = "500";
    eq("500 -> network", (await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps())).result, "network");
  }
  {
    reset();
    srv.mode = "html";
    const r = await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps());
    eq("html answer -> invalid", r.result, "invalid");
    eq("html detail", r.detail, "not_nightscout");
  }
  {
    reset();
    srv.mode = "badjson";
    const r = await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps());
    eq("broken json -> invalid", r.result, "invalid");
  }
  {
    reset();
    srv.mode = "notarray";
    eq("json object instead of array -> invalid", (await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps())).result, "invalid");
  }
  {
    reset();
    srv.mode = "hang";
    const t0 = Date.now();
    const r = await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps({ testTimeoutMs: 150 }));
    eq("silent server -> network", r.result, "network");
    eq("silent server detail", r.detail, "timeout");
    ok("gave up quickly", Date.now() - t0 < 1500);
  }
  {
    reset();
    srv.data = series(2);
    const r = await testConnection({ url: ORIGIN, token: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3" }, makeDeps());
    eq("API_SECRET hash -> invalid", r.result, "invalid");
    eq("API_SECRET detail", r.detail, "api_secret");
    eq("API_SECRET never reaches the server", srv.log.length, 0);
  }
  {
    reset();
    srv.data = series(2);
    const r = await testConnection({ url: "http://ns.example.org", token: TOKEN }, makeDeps());
    eq("http address -> invalid", r.result, "invalid");
    eq("http detail", r.detail, "insecure_url");
    eq("no request for http", srv.log.length, 0);
  }
  {
    reset();
    srv.data = series(2);
    srv.canWrite = true;
    const r = await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps());
    eq("write-capable token -> invalid", r.result, "invalid");
    eq("write token detail", r.detail, "write_token");
    srv.canWrite = false;
    srv.isAdmin = true;
    eq("admin token -> invalid", (await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps())).detail, "write_token");
    srv.isAdmin = false;
    srv.verifyStatus = 404;
    eq("old server without verifyauth still ok", (await testConnection({ url: ORIGIN, token: TOKEN }, makeDeps())).result, "ok");
  }
  {
    reset();
    srv.data = series(2);
    const r = await testConnection({ url: `${ORIGIN}/?token=${TOKEN}`, token: "" }, makeDeps());
    eq("token pasted inside the address works", r.result, "ok");
    eq("and is handed back for the token field", r.token, TOKEN);
  }
  {
    reset();
    srv.mode = "redirect";
    const redirecting = makeDeps({
      fetchImpl: (async () =>
        ({ ok: true, status: 200, url: "http://elsewhere.example.org/api/v1/entries.json", headers: { get: () => null }, text: async () => "[]" }) as unknown as Response) as unknown as typeof fetch,
    });
    eq("redirect to http is refused", (await testConnection({ url: ORIGIN, token: TOKEN }, redirecting)).result, "invalid");
  }

  section("B. connect and store");
  {
    reset();
    srv.data = series(3);
    const deps = makeDeps();
    const bad = await connectNightscout(PROFILE, { url: ORIGIN, token: "reader-ffffffffffffffff" }, deps);
    ok("rejected connect stores nothing", !bad.ok && vault.size === 0 && kv.size === 0);
    const good = await connectNightscout(PROFILE, { url: `${ORIGIN}/api/v1/`, token: TOKEN }, deps);
    ok("connect ok", good.ok);
    eq("secret stored once", vault.size, 1);
    const [k, v] = [...vault.entries()][0];
    ok("secure key is per profile", k.endsWith(PROFILE));
    ok("secure value holds url and token", v.includes(TOKEN) && v.includes(ORIGIN));
    const state = await readNightscoutState(PROFILE, deps);
    ok("state connected", state.connected && state.status === "ok");
    ok("no secret in plain storage", [...kv.values()].every((x) => !x.includes(TOKEN) && !x.includes("ns.example.org")));
    const noVault = await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, makeDeps({ secure: null }));
    ok("no secure store -> unavailable, nothing stored", !noVault.ok && noVault.detail === "unavailable");
  }

  section("C. parse rules");
  {
    const rawRows: Record<string, unknown>[] = [
      { _id: "ok1", type: "sgv", date: NOW - MIN, sgv: 120, device: "xDrip-DexcomG5" },
      { _id: "low", type: "sgv", date: NOW - 2 * MIN, sgv: 39 },
      { _id: "high", type: "sgv", date: NOW - 3 * MIN, sgv: 401 },
      { _id: "under", type: "sgv", date: NOW - 4 * MIN, sgv: 19 },
      { _id: "over", type: "sgv", date: NOW - 5 * MIN, sgv: 601 },
      { _id: "min", type: "sgv", date: NOW - 6 * MIN, sgv: 20 },
      { _id: "max", type: "sgv", date: NOW - 7 * MIN, sgv: 600 },
      { _id: "mbg", type: "mbg", date: NOW - 8 * MIN, sgv: 130, mbg: 130 },
      { _id: "str", type: "sgv", date: NOW - 9 * MIN, sgv: "130" },
      { _id: "nodate", type: "sgv", sgv: 130 },
      { _id: "future", type: "sgv", date: NOW + 60 * MIN, sgv: 130 },
      { _id: "mmol", type: "sgv", date: NOW - 10 * MIN, sgv: 5.5 },
      { _id: "round", type: "sgv", date: NOW - 11 * MIN, sgv: 120.6 },
      { _id: "nan", type: "sgv", date: NOW - 12 * MIN, sgv: Number.NaN },
      { type: "sgv", date: NOW - 13 * MIN, sgv: 111 },
      { _id: "ok1", type: "sgv", date: NOW - MIN, sgv: 120 },
      { _id: "notype", date: NOW - 14 * MIN, sgv: 112 },
    ];
    const p = parseNightscoutEntries(rawRows, NOW);
    const ids = p.rows.map((r) => r.externalId).sort();
    eq("kept ids", ids.join(","), ["ok1", "min", "max", "round", `${NOW - 13 * MIN}:111`].sort().join(","));
    const ok1 = p.rows.find((r) => r.externalId === "ok1");
    eq("mg/dL kept as is", ok1?.mgdl, 120);
    eq("utc iso from epoch ms", ok1?.at, new Date(NOW - MIN).toISOString());
    eq("device becomes source app", ok1?.sourceApp, "xDrip-DexcomG5");
    eq("source", ok1?.source, "nightscout");
    eq("is cgm", ok1?.isCgm, true);
    eq("rounded", p.rows.find((r) => r.externalId === "round")?.mgdl, 121);
    ok("39 and 401 dropped", !ids.includes("low") && !ids.includes("high"));
    ok("range edges", ids.includes("min") && ids.includes("max") && !ids.includes("under") && !ids.includes("over"));
    ok("future dropped", !ids.includes("future"));
    ok("mmol-looking value dropped, not converted", !ids.includes("mmol"));
    eq("duplicate id kept once", p.rows.filter((r) => r.externalId === "ok1").length, 1);
    ok("empty input safe", parseNightscoutEntries(null, NOW).rows.length === 0 && parseNightscoutEntries({}, NOW).rows.length === 0);
  }
  {
    // timezone: dateString and utcOffset are ignored, only the epoch counts
    const date = Date.UTC(2026, 9, 27, 12, 0, 0);
    const p = parseNightscoutEntries(
      [{ _id: "tz", type: "sgv", date, sgv: 123, dateString: "2026-10-27T15:00:00.000+03:00", utcOffset: 180 }],
      NOW
    );
    eq("dateString ignored", p.rows[0]?.at, "2026-10-27T12:00:00.000Z");
    eq("value untouched by offset", p.rows[0]?.mgdl, 123);
    const floor = parseNightscoutEntries([{ _id: "f", type: "sgv", date, sgv: 123 }], NOW, date);
    eq("entries at or before the floor are not imported", floor.rows.length, 0);
  }

  section("D. sync");
  {
    reset();
    srv.data = series(4500);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.log = [];
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    eq("sync ok", out.status, "ok");
    eq("all rows landed", imported.size, 4500);
    const reqs = srv.log.filter((l) => l.path.endsWith("entries.json"));
    eq("4500 rows -> 3 pages", reqs.length, 3);
    ok("page size 2000", reqs.every((r) => r.query.get("count") === "2000"));
    const gt0 = Number(reqs[0].query.get("find[date][$gt]"));
    ok("first connect asks 30 days back", Math.abs(gt0 - (NOW - 30 * 24 * 60 * MIN)) < MIN);
    ok("older pages page back with $lt", reqs[1].query.has("find[date][$lt]") && reqs[2].query.has("find[date][$lt]"));
    ok("all rows are sensor rows from nightscout", [...imported.values()].every((r) => r.isCgm) && [...imported.keys()].every((k) => k.startsWith("nightscout:")));
    const state = await readNightscoutState(PROFILE, deps);
    eq("cursor = newest reading", state.cursorMs, NOW - 2 * MIN);
    eq("last sync stamped", state.lastSyncAt, NOW);

    // second pull: idempotent, narrow window
    srv.log = [];
    clock = NOW + 5 * MIN;
    srv.data = [...srv.data, ...series(2, 1, NOW + 3 * MIN)];
    const before = imported.size;
    const second = await runNightscoutSync(PROFILE, deps, { entitled: true });
    eq("second pull ok", second.status, "ok");
    eq("only the 2 new rows added", imported.size - before, 2);
    const r2 = srv.log.filter((l) => l.path.endsWith("entries.json"));
    eq("one request", r2.length, 1);
    const gt1 = Number(r2[0].query.get("find[date][$gt]"));
    ok("window starts near the cursor, not 30 days", gt1 > NOW - 30 * MIN && gt1 < NOW);
    // a third pull with nothing new inserts nothing
    clock = NOW + 10 * MIN;
    const third = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("third pull adds nothing", third.status === "ok" && third.inserted === 0);
  }
  {
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.log = [];
    const out = await runNightscoutSync(PROFILE, deps, { entitled: false });
    ok("not entitled -> skipped", out.status === "skipped" && out.reason === "not_entitled");
    eq("no request without entitlement", srv.log.length, 0);
  }
  {
    reset();
    const deps = makeDeps();
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("not connected -> skipped", out.status === "skipped" && out.reason === "not_connected");
    eq("no request when not connected", srv.log.length, 0);
  }
  {
    // 401 during sync halts until the user reconnects
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.mode = "401";
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("401 -> error auth", out.status === "error" && out.error === "auth");
    eq("state says auth", (await readNightscoutState(PROFILE, deps)).status, "auth");
    srv.log = [];
    clock += 24 * 60 * MIN;
    const again = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("halted: no request even a day later", again.status === "skipped" && srv.log.length === 0);
    srv.mode = "ok";
    const re = await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    ok("reconnect clears the halt", re.ok && (await readNightscoutState(PROFILE, deps)).status === "ok");
  }
  {
    // network failure: exponential backoff 5, 10, 20 ... and reset on success
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.mode = "500";
    const f1 = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("failure reported", f1.status === "error" && f1.error === "network");
    let st = await readNightscoutState(PROFILE, deps);
    eq("first backoff 5 min", st.nextAttemptAt, clock + 5 * MIN);
    srv.log = [];
    clock += 2 * MIN;
    const skipped = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("inside backoff: no request", skipped.status === "skipped" && skipped.reason === "backoff" && srv.log.length === 0);
    clock += 4 * MIN;
    await runNightscoutSync(PROFILE, deps, { entitled: true });
    st = await readNightscoutState(PROFILE, deps);
    eq("second backoff 10 min", st.nextAttemptAt, clock + 10 * MIN);
    for (let i = 0; i < 8; i++) {
      clock = (st.nextAttemptAt ?? clock) + 1;
      await runNightscoutSync(PROFILE, deps, { entitled: true });
      st = await readNightscoutState(PROFILE, deps);
    }
    eq("backoff capped at 60 min", (st.nextAttemptAt ?? 0) - clock, 60 * MIN);
    srv.mode = "ok";
    clock = (st.nextAttemptAt ?? clock) + 1;
    const good = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("recovers", good.status === "ok");
    st = await readNightscoutState(PROFILE, deps);
    ok("success clears backoff", st.failures === 0 && st.nextAttemptAt === null && st.status === "ok");
  }
  {
    // 429 honours Retry-After
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.mode = "429";
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("429 reported", out.status === "error");
    const st = await readNightscoutState(PROFILE, deps);
    ok("Retry-After 120 s respected (at least)", (st.nextAttemptAt ?? 0) >= clock + 120_000);
  }
  {
    // a hung server must not hold the sync forever
    reset();
    srv.data = series(5);
    const deps = makeDeps({ timeoutMs: 150 });
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.mode = "hang";
    const t0 = Date.now();
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("timeout -> network error", out.status === "error" && out.error === "network");
    ok("timed out quickly", Date.now() - t0 < 1500);
  }
  {
    // an insert failure keeps the cursor so the next pass retries the same window
    reset();
    srv.data = series(10);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    const failing = makeDeps({
      insert: async () => {
        throw new Error("database is locked");
      },
    });
    const out = await runNightscoutSync(PROFILE, failing, { entitled: true });
    ok("insert failure -> error", out.status === "error");
    eq("cursor not advanced", (await readNightscoutState(PROFILE, deps)).cursorMs, null);
    eq("error reported once with a stage", errors.length, 1);
  }
  {
    // "Verileri sil": the cursor jumps to now and older readings never come back
    reset();
    srv.data = series(20);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    await runNightscoutSync(PROFILE, deps, { entitled: true });
    imported.clear();
    clock = NOW + 5 * MIN;
    await resetNightscoutCursor(PROFILE, deps);
    srv.log = [];
    clock = NOW + 10 * MIN;
    await runNightscoutSync(PROFILE, deps, { entitled: true });
    eq("nothing from before the clear returns", imported.size, 0);
    const gt = Number(srv.log.filter((l) => l.path.endsWith("entries.json"))[0].query.get("find[date][$gt]"));
    ok("window starts at the clear", gt >= NOW + 5 * MIN);
  }
  {
    // two syncs at once do not overlap
    reset();
    srv.data = series(30);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    srv.log = [];
    const [a, b] = await Promise.all([
      runNightscoutSync(PROFILE, deps, { entitled: true }),
      runNightscoutSync(PROFILE, deps, { entitled: true }),
    ]);
    ok("one runs, one is busy", [a.status, b.status].sort().join() === "ok,skipped");
  }

  section("E. disconnect");
  {
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    await runNightscoutSync(PROFILE, deps, { entitled: true });
    await disconnectNightscout(PROFILE, deps);
    eq("secret gone", vault.size, 0);
    eq("state gone", kv.size, 0);
    eq("state reads as disconnected", (await readNightscoutState(PROFILE, deps)).connected, false);
    srv.log = [];
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("no polling after disconnect", out.status === "skipped" && srv.log.length === 0);
    eq("imported readings stay unless deleted separately", imported.size, 5);
  }
  {
    // another profile is untouched
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout("A", { url: ORIGIN, token: TOKEN }, deps);
    await connectNightscout("B", { url: ORIGIN, token: TOKEN }, deps);
    await disconnectNightscout("A", deps);
    ok("B keeps its connection", (await readNightscoutState("B", deps)).connected && vault.size === 1);
  }
  {
    // the vault lost the secret (Android restore): honest state, no crash, no request
    reset();
    srv.data = series(5);
    const deps = makeDeps();
    await connectNightscout(PROFILE, { url: ORIGIN, token: TOKEN }, deps);
    vault.clear();
    srv.log = [];
    const out = await runNightscoutSync(PROFILE, deps, { entitled: true });
    ok("missing secret -> skipped", out.status === "skipped" && out.reason === "no_credentials");
    eq("state asks to reconnect", (await readNightscoutState(PROFILE, deps)).status, "reconnect");
    eq("no request", srv.log.length, 0);
  }

  section("F. messages and config");
  {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { statusKey, testDetailKey } = await import("../lib/nightscout/messages");
    const root = join(import.meta.dirname, "..");
    const tr = readFileSync(join(root, "lib/i18n/locales/tr.ts"), "utf8");
    const block = tr.slice(tr.indexOf("  nightscout: {"), tr.indexOf("  healthRationale: {"));
    const details = [
      "ok", "empty", "auth", "network", "timeout", "rate_limited", "invalid_url", "insecure_url",
      "credentials_url", "api_secret", "bad_token", "write_token", "not_nightscout", "unavailable",
    ] as const;
    for (const d of details) {
      const key = testDetailKey(d).replace("nightscout.", "");
      ok(`detail ${d} has a locale string`, new RegExp(`\\n    ${key}: `).test(block), key);
    }
    for (const s of ["auth", "network", "invalid", "reconnect"] as const) {
      const key = (statusKey(s) ?? "").replace("nightscout.", "");
      ok(`status ${s} has a locale string`, new RegExp(`\\n    ${key}: `).test(block), key);
    }
    eq("a healthy status shows no failure line", statusKey("ok"), null);

    const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo;
    const entry = (app.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === "expo-secure-store") as
      | [string, Record<string, unknown>]
      | undefined;
    ok("expo-secure-store plugin is configured", entry != null);
    eq("android backup rules exclude the SecureStore prefs", entry?.[1]?.configureAndroidBackup, true);
    eq("no Face ID prompt string for an unused feature", entry?.[1]?.faceIDPermission, false);
    eq("android auto backup stays on", app.android.allowBackup, true);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    ok("expo-secure-store is a dependency", typeof pkg.dependencies["expo-secure-store"] === "string");
    const rules = readFileSync(join(root, "node_modules/expo-secure-store/android/src/main/res/xml/secure_store_data_extraction_rules.xml"), "utf8");
    ok("the plugin's extraction rules exclude SecureStore from cloud backup and device transfer",
      (rules.match(/<exclude domain="sharedpref" path="SecureStore"\/>/g) ?? []).length === 2);
  }

  server.close();
  server.closeAllConnections?.();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
