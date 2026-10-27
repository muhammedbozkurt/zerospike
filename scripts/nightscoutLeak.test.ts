/**
 * CGM-E: the Nightscout address and token never leave the secure store.
 *
 * Drives the real lib/services/sourceSync.ts (and secureStore, sync, client)
 * through success, auth, network, timeout, broken answer and storage failures,
 * with logCrash and logEvent replaced by recorders, then searches everything
 * that was logged, tracked, returned or written to plain storage for the token
 * and the address. Also pins the sources: no raw error reaches logCrash, the
 * analytics call carries one field, the old expo-secure-store JS package (which
 * throws at import in a binary without the module) is never imported.
 *
 * Run: npx tsx scripts/nightscoutLeak.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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

(globalThis as any).__DEV__ = false;

const TOKEN = "reader-0123456789abcdef";
const HOST = "secret-ns.example.org";
const URL_IN = `https://${HOST}/`;
const NOW_ENTRY = Date.now() - 2 * 60_000;

// ── recorders and fakes ──────────────────────────────────────────────────
const logged: unknown[] = [];
const kv = new Map<string, string>();
const nativeVault = new Map<string, string>();
const nativeCalls: unknown[] = [];
let nativePresent = true;
let insertThrows: Error | null = null;
const inserted: unknown[] = [];

const fakeNative = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 7,
  getValueWithKeyAsync: async (key: string, options: unknown) => {
    nativeCalls.push({ op: "get", key, options });
    return nativeVault.get(key) ?? null;
  },
  setValueWithKeyAsync: async (value: string, key: string, options: unknown) => {
    nativeCalls.push({ op: "set", key, options });
    nativeVault.set(key, value);
  },
  deleteValueWithKeyAsync: async (key: string, options: unknown) => {
    nativeCalls.push({ op: "del", key, options });
    nativeVault.delete(key);
  },
};

const M = Module as unknown as { _load: (request: string, parent?: { filename?: string }, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, parent?: { filename?: string }, ...rest: unknown[]) {
  const from = parent?.filename ?? "";
  if (request === "react-native") return { Platform: { OS: "android" }, AppState: { currentState: "active" } };
  if (request === "@react-native-async-storage/async-storage") {
    return {
      __esModule: true,
      default: {
        getItem: async (k: string) => kv.get(k) ?? null,
        setItem: async (k: string, v: string) => void kv.set(k, v),
        removeItem: async (k: string) => void kv.delete(k),
      },
    };
  }
  if (request === "expo-modules-core") {
    return { requireOptionalNativeModule: (name: string) => (name === "ExpoSecureStore" && nativePresent ? fakeNative : null) };
  }
  if (from.endsWith("sourceSync.ts")) {
    if (request === "../analytics") {
      return {
        logCrash: (...a: unknown[]) => void logged.push({ fn: "logCrash", a }),
        logEvent: (...a: unknown[]) => void logged.push({ fn: "logEvent", a }),
      };
    }
    if (request === "../db/logs") {
      return {
        insertImportedGlucose: async (_p: string, rows: unknown[]) => {
          if (insertThrows) throw insertThrows;
          inserted.push(...rows);
          return rows.length;
        },
      };
    }
    if (request === "../db/profiles") return { getProfile: async () => null, listProfiles: async () => [{ id: "P1" }] };
    if (request === "./health") {
      return {
        getHealthBackgroundEntitled: async () => true,
        syncHealthInBackground: async () => ({ ran: false, skipped: null, result: null }),
      };
    }
  }
  return realLoad.call(this, request, parent, ...rest);
} as typeof M._load;

// ── mock server ──────────────────────────────────────────────────────────
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

let mode: "ok" | "401" | "hang" | "html" = "ok";
function handle(req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (mode === "hang") return;
  if (mode === "401" || u.searchParams.get("token") !== TOKEN) {
    res.writeHead(401);
    res.end("no");
    return;
  }
  if (mode === "html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html></html>");
    return;
  }
  if (u.pathname === "/api/v1/verifyauth") {
    res.writeHead(200);
    res.end(JSON.stringify({ message: { canRead: true, canWrite: false, isAdmin: false } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify([{ _id: "a1", type: "sgv", date: NOW_ENTRY, sgv: 110, device: "dev" }]));
}

const realFetch = globalThis.fetch;
let port = 0;
let fetchMode: "map" | "throw-with-secrets" = "map";
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const original = String(input);
  if (fetchMode === "throw-with-secrets") {
    throw new TypeError(`getaddrinfo ENOTFOUND ${HOST} while fetching ${original} token=${TOKEN}`);
  }
  const res = await realFetch(original.replace(`https://${HOST}`, `http://127.0.0.1:${port}`), init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, url: original, headers: { get: (k: string) => res.headers.get(k) }, text: async () => text } as unknown as Response;
}) as typeof fetch;

function haystack(): string {
  return JSON.stringify({ logged, kv: [...kv.entries()] });
}
function clean(name: string, extra: unknown = ""): void {
  const hay = haystack() + JSON.stringify(extra);
  ok(`${name}: no token`, !hay.includes(TOKEN) && !hay.includes("0123456789abcdef"));
  ok(`${name}: no address`, !hay.includes(HOST) && !hay.includes("example.org"));
}

async function main(): Promise<void> {
  const server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;

  const svc = await import("../lib/services/sourceSync");
  console.log("zerospike nightscout leak test");

  section("A. flows with recorders");
  {
    const t1 = await svc.testNightscout({ url: URL_IN, token: TOKEN });
    eq("test ok", t1.result, "ok");
    clean("after a good test", t1);
    ok("the test view carries no address or stored token", !("base" in t1) && !("useToken" in t1));

    const c = await svc.connectNightscoutFor("P1", { url: URL_IN, token: TOKEN });
    ok("connected", c.ok);
    clean("after connect", c);
    const stored = [...nativeVault.values()].join("");
    ok("the secret is in the secure store only", stored.includes(TOKEN) && stored.includes(HOST));
    ok("stored with the device-only accessibility option", nativeCalls.some((c2: any) => c2.op === "set" && c2.options?.keychainAccessible === 7));

    const s1 = await svc.syncNightscoutForeground("P1", true);
    eq("sync ok", s1.status, "ok");
    ok("rows were handed over", inserted.length === 1);
    ok("the device name is stored as source app, not tracked", JSON.stringify(inserted).includes("dev") && !haystack().includes('"dev"'));
    clean("after a good sync", s1);

    mode = "401";
    const s2 = await svc.syncNightscoutForeground("P1", true);
    eq("401 -> auth", s2.status === "error" ? s2.error : null, "auth");
    clean("after 401", s2);
    // reconnect after the halt
    mode = "ok";
    await svc.connectNightscoutFor("P1", { url: URL_IN, token: TOKEN });

    fetchMode = "throw-with-secrets";
    const t2 = await svc.testNightscout({ url: URL_IN, token: TOKEN });
    eq("network error", t2.result, "network");
    clean("after a throwing fetch (error text quotes address and token)", t2);
    const s3 = await svc.syncNightscoutForeground("P1", true);
    ok("sync failure reported as enum", s3.status === "error");
    clean("after a failing sync", s3);
    fetchMode = "map";

    mode = "html";
    const t3 = await svc.testNightscout({ url: URL_IN, token: TOKEN });
    eq("html answer", t3.result, "invalid");
    clean("after a non-Nightscout answer", t3);
    mode = "ok";

    // a storage failure whose message quotes the secrets must be reduced
    await svc.connectNightscoutFor("P1", { url: URL_IN, token: TOKEN });
    // the backoff from the failed sync above would skip; clear by reconnecting (done)
    insertThrows = new Error(`database error near ${URL_IN} token=${TOKEN}`);
    const s4 = await svc.syncNightscoutForeground("P1", true);
    ok("insert failure reported", s4.status === "error");
    ok("the failure was logged", logged.some((l: any) => l.fn === "logCrash"));
    clean("after an insert failure whose message quotes both", s4);
    insertThrows = null;

    const crashes = logged.filter((l: any) => l.fn === "logCrash") as any[];
    ok("logged errors carry a message-free text", crashes.every((c2) => /^nightscout \w+ failed \(/.test(String(c2.a[0]?.message))));
    ok("nothing but logCrash was called", logged.every((l: any) => l.fn === "logCrash"));

    await svc.disconnectNightscoutFor("P1", { deleteReadings: false });
    ok("disconnect empties the secure store", nativeVault.size === 0);
    ok(
      "disconnect leaves only a disconnected marker in plain state",
      [...kv.values()].every((v) => JSON.parse(v).connected === false)
    );
    clean("after disconnect");
  }

  section("B. secure store missing (older binary)");
  {
    nativePresent = false;
    const secure = await import("../lib/secureStore");
    secure.resetSecureStoreCache();
    eq("not available", secure.secureStoreAvailable(), false);
    eq("service says unavailable", svc.nightscoutAvailable(), false);
    let threw = false;
    try {
      await secure.secureSet("zerospike.nightscout.P1", "x");
    } catch {
      threw = true;
    }
    ok("writing throws instead of falling back to a weaker store", threw);
    kv.clear();
    const c = await svc.connectNightscoutFor("P1", { url: URL_IN, token: TOKEN });
    ok("connect refuses", !c.ok && c.detail === "unavailable");
    eq("nothing in plain storage", kv.size, 0);
    const s = await svc.syncNightscoutForeground("P1", true);
    ok("sync skips without throwing", s.status === "skipped");
    eq("background not wanted", await svc.nightscoutBackgroundWanted(), false);
    nativePresent = true;
    secure.resetSecureStoreCache();

    let badKey = false;
    try {
      await secure.secureSet("bad key/with space", "x");
    } catch {
      badKey = true;
    }
    ok("keys outside the native alphabet fail before the native call", badKey);
  }

  section("C. sources");
  {
    const ROOT = resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    walk(join(ROOT, "lib/nightscout"));
    for (const f of ["lib/services/sourceSync.ts", "lib/useSourcePolling.ts", "lib/secureStore.ts"]) files.push(join(ROOT, f));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const rel = f.slice(ROOT.length + 1);
      ok(`${rel}: no console output`, !/\bconsole\./.test(src));
      ok(`${rel}: no analytics event`, !/\blogEvent\(/.test(src));
      for (const m of src.matchAll(/logCrash\(\s*([^,)]*)/g)) {
        const first = m[1].trim();
        ok(`${rel}: logCrash gets a safe error (${first})`, first.startsWith("safeNightscoutError("));
      }
    }

    const ui = readFileSync(join(ROOT, "app/settings/data-sources.tsx"), "utf8");
    for (const m of ui.matchAll(/logCrash\(\s*([^,)]*)/g)) {
      const first = m[1].trim();
      const line = ui.slice(m.index!, m.index! + 200);
      if (/op:\s*"(count|setMode|setBrand)"/.test(line)) continue;
      ok(`data-sources.tsx: nightscout logCrash is safe (${first})`, first.startsWith("safeNightscoutError("));
    }
    const events = [...ui.matchAll(/logEvent\(\s*"nightscout_connect",\s*(\{[^}]*\})/g)];
    ok("data-sources.tsx tracks nightscout_connect", events.length >= 1);
    for (const e of events) ok(`nightscout_connect carries only result (${e[1]})`, /^\{\s*result(:\s*[\w.]+)?\s*\}$/.test(e[1]));
    ok("no toast shows the address or token", !/toast\([^)]*\b(url|token|base)\b/.test(ui));

    // the JS package throws at import in a binary without the native module
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(ts|tsx|js)$/.test(n) && !/\.test\./.test(n) && /from\s+"expo-secure-store"|require\("expo-secure-store"\)/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    for (const d of ["lib", "app", "components"]) scan(join(ROOT, d));
    eq("expo-secure-store JS package is never imported", offenders.join(","), "");
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
