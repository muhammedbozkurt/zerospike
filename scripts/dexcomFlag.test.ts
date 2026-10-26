/**
 * Dexcom bayragi: app.json extra'da alan yoksa kapali (sifir fetch, sifir tarayici
 * acilisi), state uyusmazligi ve suresi gecmis state reddedilir, state tek kullanimlik.
 * Calistirma:
 *
 *   npx -y tsx scripts/dexcomFlag.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";

declare const require: (id: string) => any;

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const rig = {
  extra: undefined as any,
  storage: new Map<string, string>(),
  opened: [] as string[],
  fetches: [] as Array<{ url: string; body: any }>,
  fetchReply: (_b: any): { status: number; body: unknown } => ({ status: 200, body: {} }),
};

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string) {
  if (request === "expo-constants") {
    return { __esModule: true, default: { get expoConfig() { return rig.extra === undefined ? undefined : { extra: rig.extra }; } } };
  }
  if (request === "@react-native-async-storage/async-storage") {
    return {
      __esModule: true,
      default: {
        getItem: async (k: string) => rig.storage.get(k) ?? null,
        setItem: async (k: string, v: string) => void rig.storage.set(k, v),
        removeItem: async (k: string) => void rig.storage.delete(k),
      },
    };
  }
  if (request === "expo-crypto") {
    return { getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256) };
  }
  if (request === "react-native") {
    return { Linking: { openURL: async (u: string) => void rig.opened.push(u) }, Platform: { OS: "ios" } };
  }
  return realLoad.apply(this, arguments);
};

(globalThis as any).fetch = async (url: string, init: any) => {
  const body = JSON.parse(init.body);
  rig.fetches.push({ url: String(url), body });
  const r = rig.fetchReply(body);
  return { ok: r.status < 300, status: r.status, headers: { get: () => null }, json: async () => r.body };
};

const { resolveDexcomConfig, dexcomRowVisible } = require("../lib/dexcom/config");
const { consumePendingState, createPendingState, STATE_TTL_MS, PENDING_STATE_KEY } = require("../lib/dexcom/oauth");
const connect = require("../lib/dexcom/connect");

const FN = "https://fn.example.test/functions/v1/dexcom-token";
const SECRET = "ef".repeat(32);
const OPEN = { dexcom: { enabled: true, tokenFnUrl: FN } };

function reset() {
  rig.storage.clear();
  rig.opened.length = 0;
  rig.fetches.length = 0;
  rig.fetchReply = () => ({ status: 200, body: {} });
}

async function main() {
  // --- bayrak cozumleme ---
  for (const [name, extra] of [
    ["extra yok", undefined],
    ["extra bos", {}],
    ["dexcom bos", { dexcom: {} }],
    ["enabled yok", { dexcom: { tokenFnUrl: FN } }],
    ["enabled false", { dexcom: { enabled: false, tokenFnUrl: FN } }],
    ["enabled metin", { dexcom: { enabled: "true", tokenFnUrl: FN } }],
    ["adres yok", { dexcom: { enabled: true } }],
    ["http adres", { dexcom: { enabled: true, tokenFnUrl: "http://fn.example.test/x" } }],
    ["bos adres", { dexcom: { enabled: true, tokenFnUrl: "  " } }],
    ["dexcom dizi", { dexcom: [] }],
  ] as Array<[string, unknown]>) {
    eq(`kapali: ${name}`, resolveDexcomConfig(extra), null);
  }
  eq("acik: enabled + https adres", resolveDexcomConfig(OPEN), { tokenFnUrl: FN, sandbox: false, defaultRegion: "ous" });
  eq("bolge ve sandbox", resolveDexcomConfig({ dexcom: { enabled: true, tokenFnUrl: FN, region: "jp", sandbox: true } }), {
    tokenFnUrl: FN,
    sandbox: true,
    defaultRegion: "jp",
  });
  eq("gecersiz bolge varsayilana", resolveDexcomConfig({ dexcom: { enabled: true, tokenFnUrl: FN, region: "mars" } })?.defaultRegion, "ous");

  rig.extra = undefined;
  eq("dexcomRowVisible: extra yok", dexcomRowVisible(), false);
  rig.extra = OPEN;
  eq("dexcomRowVisible: acik", dexcomRowVisible(), true);
  rig.extra = undefined;

  // Depodaki app.json bayragi acmamali.
  const appJson = JSON.parse(readFileSync("app.json", "utf8"));
  eq("app.json extra.dexcom yok", appJson.expo?.extra?.dexcom, undefined);

  // --- kapali: sifir fetch, sifir tarayici, sifir yazim ---
  reset();
  connect.setDexcomLinkSecretStore({ get: async () => null, set: async () => {}, remove: async () => {} });
  eq("kapali start", await connect.startDexcomConnect("us"), { ok: false, reason: "disabled" });
  eq("kapali finish", await connect.finishDexcomConnect({ code: "abc", state: "a".repeat(64) }), { ok: false, reason: "disabled" });
  eq("kapali: sifir fetch", rig.fetches.length, 0);
  eq("kapali: sifir tarayici acilisi", rig.opened.length, 0);
  eq("kapali: depoya yazim yok", rig.storage.size, 0);

  // --- acik ama guvenli depo yok: baslamaz ---
  reset();
  rig.extra = OPEN;
  connect.setDexcomLinkSecretStore(null);
  eq("depo yok start", await connect.startDexcomConnect("ous"), { ok: false, reason: "no_secure_store" });
  eq("depo yok: sifir fetch", rig.fetches.length, 0);
  eq("depo yok: state yazilmadi", rig.storage.size, 0);

  // --- acik akis ---
  reset();
  let saved: string | null = null;
  connect.setDexcomLinkSecretStore({ get: async () => saved, set: async (s: string) => void (saved = s), remove: async () => void (saved = null) });
  const realNow = Date.now;
  let clock = Date.UTC(2026, 9, 27, 12, 0, 0);
  Date.now = () => clock;
  try {
    let issued = "";
    rig.fetchReply = (b) => {
      if (b.action === "start") {
        issued = b.state;
        const q = new URLSearchParams({ client_id: "cid", redirect_uri: "https://greeneyeapp.com/zerospike/oauth/dexcom", response_type: "code", scope: "offline_access", state: b.state });
        return { status: 200, body: { authorizeUrl: `https://api.dexcom.eu/v3/oauth2/login?${q}` } };
      }
      if (b.action === "exchange") return { status: 200, body: { linkSecret: SECRET, region: "ous" } };
      return { status: 400, body: {} };
    };

    eq("start ok", await connect.startDexcomConnect("ous"), { ok: true });
    eq("start: bir fetch", rig.fetches.map((f) => f.body.action), ["start"]);
    eq("start: tarayici bir kez", rig.opened.length, 1);
    eq("state 64 hex", /^[0-9a-f]{64}$/.test(issued), true);
    eq("start: state bekleyen yuvada", JSON.parse(rig.storage.get(PENDING_STATE_KEY)!).state, issued);
    eq("start: istekte client_id/secret yok", JSON.stringify(rig.fetches[0].body).includes("client"), false);

    // state uyusmazligi
    const wrong = "b".repeat(64);
    eq("uyusmayan state reddi", await connect.finishDexcomConnect({ code: "abc", state: wrong }), { ok: false, reason: "state_invalid" });
    eq("uyusmazlik: exchange istegi yok", rig.fetches.length, 1);
    eq("uyusmazlik: guvenli depoya yazim yok", saved, null);
    eq("uyusmazlik: bekleyen state korunur", JSON.parse(rig.storage.get(PENDING_STATE_KEY)!).state, issued);
    eq("eksik state reddi", await connect.finishDexcomConnect({ code: "abc" }), { ok: false, reason: "state_invalid" });
    eq("kullanici reddi", await connect.finishDexcomConnect({ error: "access_denied", state: issued }), { ok: false, reason: "denied" });
    eq("reddedilen: hala exchange yok", rig.fetches.length, 1);

    // suresi gecmis state
    clock += STATE_TTL_MS + 1;
    eq("suresi gecmis state reddi", await connect.finishDexcomConnect({ code: "abc", state: issued }), { ok: false, reason: "state_invalid" });
    eq("suresi gecmis: exchange yok", rig.fetches.length, 1);
    eq("suresi gecmis: bekleyen state silindi", rig.storage.has(PENDING_STATE_KEY), false);
    eq("bekleyen yokken reddi", await connect.finishDexcomConnect({ code: "abc", state: issued }), { ok: false, reason: "state_invalid" });

    // 10 dk icinde basarili tamamlama, sonra tekrar oynatma
    clock += 1000;
    await connect.startDexcomConnect("ous");
    clock += STATE_TTL_MS - 1000;
    const okCb = { code: "good", state: issued };
    eq("10 dk icinde basarili", await connect.finishDexcomConnect(okCb), { ok: true });
    eq("sir guvenli depoya yazildi", saved, SECRET);
    eq("exchange istegi", rig.fetches.at(-1)!.body, { action: "exchange", code: "good", state: issued });
    const n = rig.fetches.length;
    eq("tekrar oynatma reddi (tek kullanim)", await connect.finishDexcomConnect(okCb), { ok: false, reason: "state_invalid" });
    eq("tekrar oynatma: yeni fetch yok", rig.fetches.length, n);

    // sunucu reddi sirri yazmaz
    saved = null;
    await connect.startDexcomConnect("us");
    rig.fetchReply = () => ({ status: 400, body: { error: "code_rejected" } });
    const bad = await connect.finishDexcomConnect({ code: "stale", state: issued });
    eq("sunucu reddi", [bad.ok, bad.reason], [false, "bad_request"]);
    eq("sunucu reddi: sir yok", saved, null);
  } finally {
    Date.now = realNow;
  }

  // --- oauth.ts dogrudan ---
  reset();
  const kv = {
    get: async (k: string) => rig.storage.get(k) ?? null,
    set: async (k: string, v: string) => void rig.storage.set(k, v),
    remove: async (k: string) => void rig.storage.delete(k),
  };
  const p = await createPendingState(kv, "jp", 1000, () => "A".repeat(64));
  eq("state kucuk harfe", p.state, "a".repeat(64));
  eq("sinirda gecerli", (await consumePendingState(kv, p.state, 1000 + STATE_TTL_MS)).ok, true);
  await createPendingState(kv, "jp", 1000, () => "a".repeat(64));
  eq("sinirdan 1 ms sonra expired", await consumePendingState(kv, "a".repeat(64), 1001 + STATE_TTL_MS), { ok: false, reason: "expired" });
  await createPendingState(kv, "jp", 5000, () => "a".repeat(64));
  eq("gelecekten state (saat geri) expired", (await consumePendingState(kv, "a".repeat(64), 1000)).ok, false);
  let threw = false;
  try {
    await createPendingState(kv, "jp", 1, () => "short");
  } catch {
    threw = true;
  }
  eq("zayif state uretimi reddi", threw, true);
  rig.storage.set(PENDING_STATE_KEY, "{bozuk");
  eq("bozuk kayit = bekleyen yok", await consumePendingState(kv, "a".repeat(64), 1), { ok: false, reason: "no_pending" });

  // --- statik: paket sir icermez, ekran bayrakla korunur ---
  const files = ["lib/dexcom", ...[]].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`)).concat(["app/oauth/dexcom.tsx"]);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    eq(`${f}: client_secret / DEXCOM_CLIENT_SECRET yok`, /client_secret|DEXCOM_CLIENT_SECRET|DEXCOM_CLIENT_ID/.test(src), false);
  }
  const screen = readFileSync("app/oauth/dexcom.tsx", "utf8");
  eq("ekran bayrak kapaliyken yonlendirir", /dexcomRowVisible\(\)/.test(screen) && /<Redirect href="\/" \/>/.test(screen), true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
