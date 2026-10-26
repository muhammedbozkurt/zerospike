// deno test --allow-env --allow-net --allow-read supabase/functions/dexcom-token
// Ag ve depolama sahte: gercek Dexcom'a ya da Supabase'e istek gitmez.

import { createHandler, DEVICE_HOURLY, type Deps, STATE_TTL_MS } from "./handler.ts";
import type { LinkRow, NewLink, Region, Store } from "./store.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`assert: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const DEVICE = "11111111-2222-4333-8444-555555555555";
const OTHER_DEVICE = "99999999-2222-4333-8444-555555555555";
const STATE_A = "a".repeat(64);
const KEY = "0123456789abcdef".repeat(4);
const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);

class MemStore implements Store {
  states = new Map<string, { device: string; region: Region; at: number; used: boolean }>();
  links = new Map<string, LinkRow>();
  counters = new Map<string, number>();
  failNext = false;
  clock = { now: T0 };
  async allowed(d: string, i: string, maxD: number, maxI: number) {
    const dn = (this.counters.get("d" + d) ?? 0) + 1;
    const inn = (this.counters.get("i" + i) ?? 0) + 1;
    this.counters.set("d" + d, dn);
    this.counters.set("i" + i, inn);
    return inn <= maxI && dn <= maxD;
  }
  async saveState(h: string, device: string, region: Region, iso: string) {
    if (this.failNext) throw new Error("db");
    this.states.set(h, { device, region, at: Date.parse(iso), used: false });
  }
  async consumeState(h: string, device: string, notBefore: string) {
    const s = this.states.get(h);
    if (!s || s.used || s.device !== device || s.at < Date.parse(notBefore)) return null;
    s.used = true;
    return s.region;
  }
  async getLink(device: string) {
    const l = this.links.get(device);
    return l ? { ...l } : null;
  }
  async upsertLink(l: NewLink) {
    this.links.set(l.device_id, { link_id: "link-" + l.device_id, ...l, refresh_lease_until: null });
  }
  async deleteLink(device: string) {
    this.links.delete(device);
  }
  async claimRefresh(id: string, nowIso: string, untilIso: string) {
    const l = [...this.links.values()].find((x) => x.link_id === id);
    if (!l) return false;
    if (l.refresh_lease_until && Date.parse(l.refresh_lease_until) >= Date.parse(nowIso)) return false;
    l.refresh_lease_until = untilIso;
    return true;
  }
  async saveTokens(id: string, t: { refresh_enc: string; access_enc: string; access_expires_at: string }) {
    const l = [...this.links.values()].find((x) => x.link_id === id)!;
    Object.assign(l, t, { refresh_lease_until: null });
  }
  async clearAccess(id: string) {
    const l = [...this.links.values()].find((x) => x.link_id === id)!;
    l.access_enc = null;
    l.access_expires_at = null;
  }
  async releaseLease(id: string) {
    const l = [...this.links.values()].find((x) => x.link_id === id)!;
    l.refresh_lease_until = null;
  }
}

/** Dexcom sahtesi: refresh token tek kullanimlik (kullanilan ikinci kez reddedilir). */
class FakeDexcom {
  calls: Array<{ url: string; body?: string; auth?: string }> = [];
  refreshCalls = 0;
  validRefresh = new Set<string>();
  counter = 0;
  tokenStatus = 200;
  egvsStatus = 200;
  egvsBody: unknown = {
    records: [
      {
        recordId: "r1",
        systemTime: "2026-10-27T10:00:00",
        displayTime: "2026-10-27T13:00:00",
        value: 112,
        trend: "flat",
        unit: "mg/dL",
        transmitterId: "SECRET-TX",
      },
    ],
  };
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    this.calls.push({ url, body, auth });
    if (url.includes("/v3/oauth2/token")) {
      if (this.tokenStatus !== 200) return new Response("{}", { status: this.tokenStatus });
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        this.refreshCalls++;
        const rt = form.get("refresh_token")!;
        if (!this.validRefresh.has(rt)) return new Response('{"error":"invalid_grant"}', { status: 400 });
        this.validRefresh.delete(rt);
      } else if (form.get("code") !== "good-code") {
        return new Response('{"error":"invalid_grant"}', { status: 400 });
      }
      this.counter++;
      const refresh = `rt-${this.counter}`;
      this.validRefresh.add(refresh);
      return new Response(JSON.stringify({ access_token: `at-${this.counter}`, refresh_token: refresh, expires_in: 7200 }), { status: 200 });
    }
    if (url.includes("/v3/users/self/egvs")) {
      return new Response(JSON.stringify(this.egvsBody), { status: this.egvsStatus });
    }
    return new Response("nope", { status: 404 });
  };
}

function rig(opts: { env?: Record<string, string>; store?: MemStore } = {}) {
  const store = opts.store ?? new MemStore();
  const dexcom = new FakeDexcom();
  const env: Record<string, string> = {
    DEXCOM_CLIENT_ID: "cid-test",
    DEXCOM_CLIENT_SECRET: "csecret-test",
    DEXCOM_TOKEN_KEY: KEY,
    ...opts.env,
  };
  const deps: Deps = {
    store,
    env: (n) => env[n],
    fetch: dexcom.fetch,
    now: () => store.clock.now,
    bucketKey: "bucket-key",
    callerIp: async () => "203.0.113.7",
  };
  const handle = createHandler(deps);
  async function call(body: unknown, headers: Record<string, string> = {}, device = DEVICE) {
    const res = await handle(
      new Request("http://x/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-id": device, ...headers },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> | null, res };
  }
  async function link(device = DEVICE): Promise<string> {
    const s = await call({ action: "start", state: STATE_A, region: "ous" }, {}, device);
    assertEq(s.status, 200, "start");
    const e = await call({ action: "exchange", code: "good-code", state: STATE_A }, {}, device);
    assertEq(e.status, 200, "exchange");
    return e.body!.linkSecret as string;
  }
  return { store, dexcom, call, link, handle };
}

Deno.test("secret yokken 500 degil kontrollu not_configured, Dexcom'a istek yok", async () => {
  for (const missing of ["DEXCOM_CLIENT_ID", "DEXCOM_CLIENT_SECRET", "DEXCOM_TOKEN_KEY"]) {
    const r = rig({ env: { [missing]: "" } });
    const out = await r.call({ action: "start", state: STATE_A, region: "us" });
    assertEq(out.status, 503, `${missing} status`);
    assertEq(out.body, { error: "not_configured" }, `${missing} body`);
    assertEq(r.dexcom.calls.length, 0, `${missing} calls`);
  }
  const bad = rig({ env: { DEXCOM_TOKEN_KEY: "short" } });
  assertEq((await bad.call({ action: "start", state: STATE_A, region: "us" })).status, 503, "gecersiz anahtar");
});

Deno.test("depolama yok -> kontrollu not_configured", async () => {
  const handle = createHandler({
    store: null,
    env: () => "x",
    fetch: () => Promise.reject(new Error("no network")),
    now: () => T0,
    bucketKey: undefined,
    callerIp: async () => "1.1.1.1",
  });
  const res = await handle(
    new Request("http://x/", { method: "POST", headers: { "x-device-id": DEVICE }, body: JSON.stringify({ action: "start" }) }),
  );
  assertEq(res.status, 503, "status");
});

Deno.test("istek dogrulamasi: yontem, cihaz kimligi, govde", async () => {
  const r = rig();
  const get = await r.handle(new Request("http://x/", { method: "GET" }));
  assertEq(get.status, 405, "GET");
  assertEq((await r.call({ action: "start" }, {}, "nope")).status, 400, "bad device");
  assertEq((await r.call({ action: "zzz" })).body, { error: "bad_action" }, "bad action");
  const raw = await r.handle(
    new Request("http://x/", { method: "POST", headers: { "x-device-id": DEVICE }, body: "{not json" }),
  );
  assertEq(raw.status, 400, "bad json");
  assertEq((await r.call({ action: "start", state: "short", region: "us" })).status, 400, "weak state");
  assertEq((await r.call({ action: "start", state: STATE_A, region: "mars" })).status, 400, "bad region");
});

Deno.test("start: giris adresi sunucudan, client_id yalniz env'den, state kaydedilir", async () => {
  const r = rig();
  const out = await r.call({ action: "start", state: STATE_A, region: "ous" });
  assertEq(out.status, 200, "status");
  const u = new URL(out.body!.authorizeUrl);
  assertEq(u.origin, "https://api.dexcom.eu", "host");
  assertEq(u.pathname, "/v3/oauth2/login", "path");
  assertEq(u.searchParams.get("client_id"), "cid-test", "client_id");
  assertEq(u.searchParams.get("redirect_uri"), "https://greeneyeapp.com/zerospike/oauth/dexcom", "redirect");
  assertEq(u.searchParams.get("scope"), "offline_access", "scope");
  assertEq(u.searchParams.get("state"), STATE_A, "state");
  assertEq(r.store.states.size, 1, "state kaydi");
  assert(!JSON.stringify(out.body).includes("csecret-test"), "secret sizmaz");

  const sb = rig({ env: { DEXCOM_SANDBOX: "1" } });
  const sbOut = await sb.call({ action: "start", state: STATE_A, region: "us" });
  assertEq(new URL(sbOut.body!.authorizeUrl).origin, "https://sandbox-api.dexcom.com", "sandbox host");
});

Deno.test("exchange: state yoksa reddedilir ve Dexcom'a gidilmez", async () => {
  const r = rig();
  const out = await r.call({ action: "exchange", code: "good-code", state: STATE_A });
  assertEq(out.status, 400, "status");
  assertEq(out.body, { error: "state_invalid" }, "body");
  assertEq(r.dexcom.calls.length, 0, "calls");
  assertEq((await r.call({ action: "exchange", code: "good-code", state: "zz" })).body, { error: "state_invalid" }, "bicim");
});

Deno.test("exchange: state tek kullanimlik, 10 dk omurlu, baska cihaza bagli degil", async () => {
  const r = rig();
  await r.call({ action: "start", state: STATE_A, region: "us" });
  const wrongDevice = await r.call({ action: "exchange", code: "good-code", state: STATE_A }, {}, OTHER_DEVICE);
  assertEq(wrongDevice.body, { error: "state_invalid" }, "baska cihaz");
  const ok = await r.call({ action: "exchange", code: "good-code", state: STATE_A });
  assertEq(ok.status, 200, "ilk kullanim");
  const again = await r.call({ action: "exchange", code: "good-code", state: STATE_A });
  assertEq(again.body, { error: "state_invalid" }, "ikinci kullanim");

  const e = rig();
  await e.call({ action: "start", state: STATE_A, region: "us" });
  e.store.clock.now += STATE_TTL_MS + 1000;
  const late = await e.call({ action: "exchange", code: "good-code", state: STATE_A });
  assertEq(late.body, { error: "state_invalid" }, "suresi dolmus");
  assertEq(e.dexcom.calls.length, 0, "suresi dolmus: Dexcom yok");
});

Deno.test("exchange: sir cevapta yok, token'lar sifreli, Dexcom reddi 400", async () => {
  const r = rig();
  await r.call({ action: "start", state: STATE_A, region: "us" });
  const out = await r.call({ action: "exchange", code: "good-code", state: STATE_A });
  assertEq(out.status, 200, "status");
  assertEq(Object.keys(out.body!).sort(), ["linkSecret", "region"], "alanlar");
  assert(/^[0-9a-f]{64}$/.test(out.body!.linkSecret), "sir bicimi");
  const row = r.store.links.get(DEVICE)!;
  assert(!row.refresh_enc.includes("rt-1") && !row.access_enc!.includes("at-1"), "sifreli");
  assert(row.link_secret_hash !== out.body!.linkSecret && row.link_secret_hash.length === 64, "ozet");
  const form = new URLSearchParams(r.dexcom.calls[0].body);
  assertEq(form.get("client_secret"), "csecret-test", "secret yalniz Dexcom'a gider");
  assertEq(form.get("redirect_uri"), "https://greeneyeapp.com/zerospike/oauth/dexcom", "redirect");

  const bad = rig();
  await bad.call({ action: "start", state: STATE_A, region: "us" });
  const rej = await bad.call({ action: "exchange", code: "wrong", state: STATE_A });
  assertEq(rej.body, { error: "code_rejected" }, "kod reddi");
  assertEq(bad.store.links.size, 0, "baglanti yok");

  const down = rig();
  await down.call({ action: "start", state: STATE_A, region: "us" });
  down.dexcom.tokenStatus = 503;
  assertEq((await down.call({ action: "exchange", code: "good-code", state: STATE_A })).status, 502, "upstream");
});

Deno.test("egvs: sir yok ya da yanlis -> 401; aralik dogrulamasi", async () => {
  const r = rig();
  const secret = await r.link();
  const q = { action: "egvs", startDate: "2026-10-01T00:00:00", endDate: "2026-10-02T00:00:00" };
  assertEq((await r.call(q)).status, 401, "sirsiz");
  assertEq((await r.call(q, { "x-dexcom-link": "0".repeat(64) })).status, 401, "yanlis sir");
  assertEq((await r.call(q, { "x-dexcom-link": secret }, OTHER_DEVICE)).status, 401, "baska cihaz");
  const long = { action: "egvs", startDate: "2026-09-01T00:00:00", endDate: "2026-10-02T00:00:00" };
  assertEq((await r.call(long, { "x-dexcom-link": secret })).body, { error: "bad_range" }, "31 gun");
  const inverted = { action: "egvs", startDate: "2026-10-02T00:00:00", endDate: "2026-10-01T00:00:00" };
  assertEq((await r.call(inverted, { "x-dexcom-link": secret })).status, 400, "ters aralik");
  const fmt = { action: "egvs", startDate: "2026-10-01", endDate: "2026-10-02T00:00:00" };
  assertEq((await r.call(fmt, { "x-dexcom-link": secret })).status, 400, "bicim");
});

Deno.test("egvs: onbellekteki access ile calisir, yalniz gerekli alanlar doner", async () => {
  const r = rig();
  const secret = await r.link();
  const before = r.dexcom.calls.length;
  const out = await r.call(
    { action: "egvs", startDate: "2026-10-27T00:00:00", endDate: "2026-10-28T00:00:00" },
    { "x-dexcom-link": secret },
  );
  assertEq(out.status, 200, "status");
  assertEq(out.body, { records: [{ recordId: "r1", systemTime: "2026-10-27T10:00:00", value: 112, unit: "mg/dL" }] }, "minimal");
  assertEq(r.dexcom.refreshCalls, 0, "yenileme yok");
  assertEq(r.dexcom.calls.length - before, 1, "tek egvs istegi");
  const egvs = r.dexcom.calls.at(-1)!;
  assert(egvs.url.startsWith("https://api.dexcom.eu/v3/users/self/egvs?startDate=2026-10-27T00:00:00&endDate=2026-10-28T00:00:00"), "url");
  assertEq(egvs.auth, "Bearer at-1", "bearer");
});

Deno.test("refresh tek kullanimlik: yenilenen refresh saklanir, eskisi bir daha harcanmaz", async () => {
  const r = rig();
  const secret = await r.link();
  const q = { action: "egvs", startDate: "2026-10-27T00:00:00", endDate: "2026-10-28T00:00:00" };
  // access suresi doldu -> rt-1 harcanir, rt-2 saklanir
  r.store.clock.now += 3 * 3600 * 1000;
  assertEq((await r.call(q, { "x-dexcom-link": secret })).status, 200, "ilk yenileme");
  assertEq(r.dexcom.refreshCalls, 1, "bir yenileme");
  assertEq(r.dexcom.validRefresh.has("rt-1"), false, "rt-1 harcandi");
  // hemen sonra: yeni access onbellekte, tekrar yenileme yok
  assertEq((await r.call(q, { "x-dexcom-link": secret })).status, 200, "onbellek");
  assertEq(r.dexcom.refreshCalls, 1, "yine bir yenileme");
  // iki saat sonra rt-2 ile ikinci yenileme calisir (rt-1 olsaydi reddedilirdi)
  r.store.clock.now += 3 * 3600 * 1000;
  assertEq((await r.call(q, { "x-dexcom-link": secret })).status, 200, "ikinci yenileme");
  assertEq(r.dexcom.refreshCalls, 2, "iki yenileme");
  const bodies = r.dexcom.calls.filter((c) => c.body?.includes("refresh_token")).map((c) => new URLSearchParams(c.body).get("refresh_token"));
  assertEq(bodies, ["rt-1", "rt-2"], "her seferinde guncel refresh");
});

Deno.test("refresh: eszamanli iki istek tek Dexcom yenilemesi harcar", async () => {
  const r = rig();
  const secret = await r.link();
  const q = { action: "egvs", startDate: "2026-10-27T00:00:00", endDate: "2026-10-28T00:00:00" };
  r.store.clock.now += 3 * 3600 * 1000;
  const [a, b] = await Promise.all([r.call(q, { "x-dexcom-link": secret }), r.call(q, { "x-dexcom-link": secret })]);
  assertEq(r.dexcom.refreshCalls, 1, "tek yenileme");
  assert([a.status, b.status].every((s) => s === 200 || s === 409), "200 ya da 409");
  assert(a.status === 200 || b.status === 200, "biri basarili");
  assertEq(r.store.links.get(DEVICE)!.refresh_lease_until, null, "kilit birakildi");
});

Deno.test("refresh reddedilirse baglanti silinir, link_expired", async () => {
  const r = rig();
  const secret = await r.link();
  r.dexcom.validRefresh.clear();
  r.store.clock.now += 3 * 3600 * 1000;
  const out = await r.call(
    { action: "egvs", startDate: "2026-10-27T00:00:00", endDate: "2026-10-28T00:00:00" },
    { "x-dexcom-link": secret },
  );
  assertEq(out.status, 401, "status");
  assertEq(out.body, { error: "link_expired" }, "body");
  assertEq(r.store.links.size, 0, "silindi");
});

Deno.test("egvs upstream hatalari: 429 gecer, 5xx -> 502", async () => {
  const r = rig();
  const secret = await r.link();
  const q = { action: "egvs", startDate: "2026-10-27T00:00:00", endDate: "2026-10-28T00:00:00" };
  r.dexcom.egvsStatus = 429;
  assertEq((await r.call(q, { "x-dexcom-link": secret })).status, 429, "429");
  r.dexcom.egvsStatus = 500;
  assertEq((await r.call(q, { "x-dexcom-link": secret })).status, 502, "500");
  r.dexcom.egvsStatus = 200;
  r.dexcom.egvsBody = { nope: true };
  assertEq((await r.call(q, { "x-dexcom-link": secret })).status, 502, "bozuk govde");
});

Deno.test("oran siniri: cihaz basina saatlik tavan 429 + Retry-After", async () => {
  const r = rig();
  let last = 0;
  let res: Response | null = null;
  for (let i = 0; i < DEVICE_HOURLY + 1; i++) {
    const out = await r.call({ action: "start", state: STATE_A, region: "us" });
    last = out.status;
    res = out.res;
  }
  assertEq(last, 429, "tavan asildi");
  assert(Number(res!.headers.get("Retry-After")) > 0, "Retry-After");
});

Deno.test("unlink baglantiyi siler; sirsiz unlink reddedilir; depolama hatasi 503", async () => {
  const r = rig();
  const secret = await r.link();
  assertEq((await r.call({ action: "unlink" })).status, 401, "sirsiz");
  assertEq(r.store.links.size, 1, "hala bagli");
  assertEq((await r.call({ action: "unlink" }, { "x-dexcom-link": secret })).status, 200, "unlink");
  assertEq(r.store.links.size, 0, "silindi");

  const f = rig();
  f.store.failNext = true;
  const out = await f.call({ action: "start", state: STATE_A, region: "us" });
  assertEq(out.status, 503, "storage");
  assertEq(out.body, { error: "storage" }, "storage body");
});
