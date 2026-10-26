/**
 * lib/dexcom/client.ts + oauth.ts: URL kurulumu, 30 gun pencere bolme, birim ve saat
 * donusumu, hata yollari. Ag sahte; gercek istek yok. Calistirma:
 *
 *   npx -y tsx scripts/dexcomClient.test.ts
 */
declare const require: (id: string) => any;

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string) {
  if (request === "expo-constants") return { __esModule: true, default: { expoConfig: undefined } };
  return realLoad.apply(this, arguments);
};

const {
  DAY_MS,
  exchangeCode,
  fetchEgvs,
  formatQueryTime,
  parseReading,
  parseSystemTime,
  splitWindows,
  startAuthorization,
  statusToReason,
  unlinkDexcom,
} = require("../lib/dexcom/client");
const { DEXCOM_HOSTS, DEXCOM_REDIRECT_URI, dexcomHost, regionForCountry } = require("../lib/dexcom/config");
const { buildAuthorizeUrl, isSafeAuthorizeUrl, parseCallbackParams } = require("../lib/dexcom/oauth");

type DexcomConfig = { tokenFnUrl: string; sandbox: boolean; defaultRegion: "us" | "ous" | "jp" };
type ClientDeps = { config: DexcomConfig | null; deviceId: string; fetch: typeof fetch };

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const DEVICE = "11111111-2222-4333-8444-555555555555";
const SECRET = "ab".repeat(32);
const STATE = "c".repeat(64);
const CONFIG: DexcomConfig = { tokenFnUrl: "https://fn.example.test/functions/v1/dexcom-token", sandbox: false, defaultRegion: "ous" };

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}
function fakeFetch(handler: (call: Call, n: number) => { status?: number; body?: unknown; headers?: Record<string, string> } | "throw" | "abort") {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    const call: Call = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    const out = handler(call, calls.length);
    if (out === "throw") throw new TypeError("network down");
    if (out === "abort") {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    const status = out.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => out.headers?.[k] ?? null },
      json: async () => out.body ?? null,
    };
  }) as unknown as typeof fetch;
  return { f, calls };
}
const deps = (f: typeof fetch, over: Partial<ClientDeps> = {}): ClientDeps => ({ config: CONFIG, deviceId: DEVICE, fetch: f, ...over });

async function main() {
  // --- host / bolge ---
  eq("us host", dexcomHost("us", false), "https://api.dexcom.com");
  eq("ous host", dexcomHost("ous", false), "https://api.dexcom.eu");
  eq("jp host", dexcomHost("jp", false), "https://api.dexcom.jp");
  eq("sandbox host", dexcomHost("jp", true), "https://sandbox-api.dexcom.com");
  eq("hostlar tablosu", Object.values(DEXCOM_HOSTS).length, 3);
  eq("US -> us", regionForCountry("us"), "us");
  eq("JP -> jp", regionForCountry("JP"), "jp");
  eq("DE -> ous", regionForCountry("DE"), "ous");
  eq("bos -> ous", regionForCountry(null), "ous");

  // --- yetkilendirme URL'si ---
  const url = buildAuthorizeUrl({ host: DEXCOM_HOSTS.ous, clientId: "cid", state: STATE });
  const u = new URL(url);
  eq("authorize host", u.origin, "https://api.dexcom.eu");
  eq("authorize path", u.pathname, "/v3/oauth2/login");
  eq("authorize client_id", u.searchParams.get("client_id"), "cid");
  eq("authorize redirect_uri", u.searchParams.get("redirect_uri"), DEXCOM_REDIRECT_URI);
  eq("authorize response_type", u.searchParams.get("response_type"), "code");
  eq("authorize scope", u.searchParams.get("scope"), "offline_access");
  eq("authorize state", u.searchParams.get("state"), STATE);
  eq("guvenli url kabul", isSafeAuthorizeUrl(url, STATE), true);
  eq("baska state reddi", isSafeAuthorizeUrl(url, "d".repeat(64)), false);
  eq("baska host reddi", isSafeAuthorizeUrl(url.replace("api.dexcom.eu", "evil.example"), STATE), false);
  eq("http reddi", isSafeAuthorizeUrl(url.replace("https:", "http:"), STATE), false);
  eq("baska redirect reddi", isSafeAuthorizeUrl(url.replace("greeneyeapp.com", "evil.example"), STATE), false);
  eq("url degil reddi", isSafeAuthorizeUrl(42, STATE), false);
  eq("callback code+state", parseCallbackParams({ code: "abc", state: STATE }), { kind: "code", code: "abc", state: STATE });
  eq("callback dizi", parseCallbackParams({ code: ["abc"], state: [STATE] }), { kind: "code", code: "abc", state: STATE });
  eq("callback error", parseCallbackParams({ error: "access_denied", state: STATE }), { kind: "denied" });
  eq("callback eksik", parseCallbackParams({ code: "abc" }), { kind: "invalid" });
  eq("callback bosluklu kod", parseCallbackParams({ code: "a b", state: STATE }), { kind: "invalid" });

  // --- pencere bolme ---
  const D0 = Date.UTC(2026, 0, 1);
  eq("bos aralik", splitWindows(D0, D0), []);
  eq("ters aralik", splitWindows(D0 + 1, D0), []);
  eq("kisa aralik tek pencere", splitWindows(D0, D0 + 5 * DAY_MS), [[D0, D0 + 5 * DAY_MS]]);
  eq("tam 30 gun tek pencere", splitWindows(D0, D0 + 30 * DAY_MS), [[D0, D0 + 30 * DAY_MS]]);
  eq("30 gun + 1 sn iki pencere", splitWindows(D0, D0 + 30 * DAY_MS + 1000), [
    [D0, D0 + 30 * DAY_MS],
    [D0 + 30 * DAY_MS, D0 + 30 * DAY_MS + 1000],
  ]);
  const w90 = splitWindows(D0, D0 + 90 * DAY_MS);
  eq("90 gun uc pencere", w90.length, 3);
  eq("pencereler bitisik, ust uste binmez", w90.every(([, to], i) => i === w90.length - 1 || w90[i + 1][0] === to), true);
  eq("hicbir pencere 30 gunu asmaz", w90.every(([a, b]) => b - a <= 30 * DAY_MS), true);
  eq("sorgu zamani UTC saniye", formatQueryTime(Date.UTC(2026, 9, 27, 8, 5, 3, 999)), "2026-10-27T08:05:03");

  // --- saat ve birim ---
  eq("ofsetsiz systemTime UTC", parseSystemTime("2026-10-27T08:00:00"), Date.UTC(2026, 9, 27, 8, 0, 0));
  eq("Z aynen", parseSystemTime("2026-10-27T08:00:00Z"), Date.UTC(2026, 9, 27, 8, 0, 0));
  eq("ofsetli", parseSystemTime("2026-10-27T10:00:00+02:00"), Date.UTC(2026, 9, 27, 8, 0, 0));
  eq("kesirli saniye", parseSystemTime("2026-10-27T08:00:00.5"), Date.UTC(2026, 9, 27, 8, 0, 0, 500));
  eq("bozuk saat", parseSystemTime("yesterday"), null);
  eq("sayi saat", parseSystemTime(12345), null);
  const rec = (over: Record<string, unknown> = {}) => ({ recordId: "r1", systemTime: "2026-10-27T08:00:00", displayTime: "2026-10-27T11:00:00", value: 110, unit: "mg/dL", ...over });
  eq("mg/dL tamsayi", parseReading(rec({ value: 109.6 }))?.mgdl, 110);
  eq("displayTime kullanilmaz", parseReading(rec())?.ts, Date.UTC(2026, 9, 27, 8, 0, 0));
  eq("birim yoksa mg/dL", parseReading(rec({ unit: undefined }))?.mgdl, 110);
  eq("mmol/L donusur", parseReading(rec({ value: 5.5, unit: "mmol/L" }))?.mgdl, 99);
  eq("taninmayan birim atilir", parseReading(rec({ unit: "g/L" })), null);
  eq("recordId yok", parseReading(rec({ recordId: undefined })), null);
  eq("sayisal recordId", parseReading(rec({ recordId: 77 }))?.externalId, "77");
  eq("sifir deger atilir", parseReading(rec({ value: 0 })), null);
  eq("asiri deger atilir", parseReading(rec({ value: 5000 })), null);
  eq("NaN atilir", parseReading(rec({ value: NaN })), null);
  eq("metin deger atilir", parseReading(rec({ value: "110" })), null);

  // --- ag: bayrak kapali -> sifir istek ---
  const off = fakeFetch(() => ({ body: {} }));
  const closed = deps(off.f, { config: null });
  eq("kapali start", await startAuthorization(closed, { state: STATE, region: "us" }), { ok: false, reason: "disabled" });
  eq("kapali exchange", await exchangeCode(closed, { code: "c", state: STATE }), { ok: false, reason: "disabled" });
  eq("kapali unlink", await unlinkDexcom(closed, SECRET), { ok: false, reason: "disabled" });
  eq("kapali egvs", await fetchEgvs(closed, SECRET, D0, D0 + DAY_MS), { ok: false, reason: "disabled", readings: [] });
  eq("kapali: sifir fetch", off.calls.length, 0);

  // --- ag: baslik/govde kurulumu ---
  const s = fakeFetch(() => ({ body: { authorizeUrl: url } }));
  const started = await startAuthorization(deps(s.f), { state: STATE, region: "ous" });
  eq("start ok", started, { ok: true, authorizeUrl: url });
  eq("start url", s.calls[0].url, CONFIG.tokenFnUrl);
  eq("start x-device-id", s.calls[0].headers["x-device-id"], DEVICE);
  eq("start govde", s.calls[0].body, { action: "start", state: STATE, region: "ous" });
  eq("start link basligi yok", "x-dexcom-link" in s.calls[0].headers, false);
  const evil = fakeFetch(() => ({ body: { authorizeUrl: "https://evil.example/v3/oauth2/login?state=" + STATE } }));
  eq("sahte authorizeUrl reddi", await startAuthorization(deps(evil.f), { state: STATE, region: "ous" }), { ok: false, reason: "unsafe_url" });
  eq("gecersiz cihaz kimligi", await startAuthorization(deps(s.f, { deviceId: "unknown-device" }), { state: STATE, region: "us" }), { ok: false, reason: "no_device" });

  const x = fakeFetch(() => ({ body: { linkSecret: SECRET, region: "ous" } }));
  eq("exchange ok", await exchangeCode(deps(x.f), { code: "abc", state: STATE }), { ok: true, linkSecret: SECRET });
  eq("exchange govde", x.calls[0].body, { action: "exchange", code: "abc", state: STATE });
  const xb = fakeFetch(() => ({ body: { linkSecret: "short" } }));
  eq("kotu sir bicimi", await exchangeCode(deps(xb.f), { code: "abc", state: STATE }), { ok: false, reason: "bad_response" });

  const un = fakeFetch(() => ({ body: { ok: true } }));
  eq("unlink ok", await unlinkDexcom(deps(un.f), SECRET), { ok: true });
  eq("unlink basligi", un.calls[0].headers["x-dexcom-link"], SECRET);

  // --- egvs: bolme, birlestirme, tekillestirme ---
  const e1 = fakeFetch((call) => {
    const from = Date.parse(call.body.startDate + "Z");
    return {
      body: {
        records: [
          { recordId: `a${from}`, systemTime: call.body.startDate, value: 100, unit: "mg/dL" },
          { recordId: "dup", systemTime: call.body.startDate, value: 101, unit: "mg/dL" },
          { recordId: "bad", systemTime: "nope", value: 5 },
        ],
      },
    };
  });
  const span = 75 * DAY_MS;
  const all = await fetchEgvs(deps(e1.f), SECRET, D0, D0 + span);
  eq("75 gun uc istek", e1.calls.length, 3);
  eq("her istek 30 gunu asmaz", e1.calls.every((c) => Date.parse(c.body.endDate + "Z") - Date.parse(c.body.startDate + "Z") <= 30 * DAY_MS), true);
  eq("istek basligi", e1.calls[0].headers["x-dexcom-link"], SECRET);
  eq("istek govdesi", e1.calls[0].body, { action: "egvs", startDate: "2026-01-01T00:00:00", endDate: "2026-01-31T00:00:00" });
  eq("ardisik pencere baslangici = onceki bitis", e1.calls[1].body.startDate, e1.calls[0].body.endDate);
  eq("sonuc ok", all.ok, true);
  eq("tekil recordId, bozuk kayit atildi", all.readings.length, 4);
  eq("zamana gore artan", all.readings.every((r, i) => i === 0 || all.readings[i - 1].ts <= r.ts), true);

  // pencere disi kayit atilir (baslangic dahil, bitis haric)
  const edge = fakeFetch((call) => ({
    body: {
      records: [
        { recordId: "in", systemTime: call.body.startDate, value: 100 },
        { recordId: "out", systemTime: call.body.endDate, value: 100 },
      ],
    },
  }));
  const edgeRes = await fetchEgvs(deps(edge.f), SECRET, D0, D0 + DAY_MS);
  eq("bitis zamanli kayit pencere disi", edgeRes.readings.map((r) => r.externalId), ["in"]);

  eq("link yok", await fetchEgvs(deps(e1.f), null, D0, D0 + DAY_MS), { ok: false, reason: "no_link", readings: [] });
  eq("ters aralik", (await fetchEgvs(deps(e1.f), SECRET, D0 + DAY_MS, D0)).reason, "bad_range");

  // --- hata yollari ---
  eq("400", statusToReason(400), "bad_request");
  eq("401", statusToReason(401), "unauthorized");
  eq("403", statusToReason(403), "unauthorized");
  eq("409", statusToReason(409), "upstream");
  eq("429", statusToReason(429), "rate_limited");
  eq("502", statusToReason(502), "upstream");
  eq("500", statusToReason(500), "server");

  const e401 = fakeFetch(() => ({ status: 401, body: { error: "link_expired" } }));
  const r401 = await fetchEgvs(deps(e401.f), SECRET, D0, D0 + DAY_MS);
  eq("401 -> unauthorized + ayrinti", [r401.ok, (r401 as any).reason, (r401 as any).detail], [false, "unauthorized", "link_expired"]);
  const e429 = fakeFetch(() => ({ status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "120" } }));
  const r429 = (await fetchEgvs(deps(e429.f), SECRET, D0, D0 + DAY_MS)) as any;
  eq("429 retry-after", [r429.reason, r429.retryAfterSec], ["rate_limited", 120]);
  eq("ag hatasi", ((await fetchEgvs(deps(fakeFetch(() => "throw").f), SECRET, D0, D0 + DAY_MS)) as any).reason, "network");
  eq("zaman asimi", ((await fetchEgvs(deps(fakeFetch(() => "abort").f), SECRET, D0, D0 + DAY_MS)) as any).reason, "timeout");
  eq("bozuk govde", ((await fetchEgvs(deps(fakeFetch(() => ({ body: { nope: 1 } })).f), SECRET, D0, D0 + DAY_MS)) as any).reason, "bad_response");

  // ikinci pencere hata verirse ilk pencerenin okumalari kaybolmaz ve durulur
  const partial = fakeFetch((call, n) =>
    n === 1 ? { body: { records: [{ recordId: "x1", systemTime: call.body.startDate, value: 90 }] } } : { status: 429, body: { error: "rate_limited" } }
  );
  const pr = (await fetchEgvs(deps(partial.f), SECRET, D0, D0 + 70 * DAY_MS)) as any;
  eq("kismi: hata + toplananlar", [pr.ok, pr.reason, pr.readings.length], [false, "rate_limited", 1]);
  eq("kismi: hatadan sonra durur", partial.calls.length, 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
