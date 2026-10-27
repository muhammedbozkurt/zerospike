/**
 * The sensor brand question and its honest note: five brands, nine languages, no
 * forbidden bridge names, no flat negative claim about Libre, the Nightscout
 * sentence only behind the build flag, the choice stored per profile on the device.
 * Run: npx tsx scripts/cgmBrandNote.test.ts
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kv = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
  setItem: async (k: string, v: string) => {
    kv.set(k, v);
  },
};
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: AsyncStorage };
  }
  return realLoad.call(this, request, ...rest);
};

const ROOT = join(__dirname, "..");
const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"] as const;

function namespace(lang: string): Record<string, string> {
  const src = readFileSync(join(ROOT, `lib/i18n/locales/${lang}.ts`), "utf8");
  const start = src.indexOf("\n  cgmBrand: {");
  assert.ok(start >= 0, `${lang}: cgmBrand ad alani yok`);
  const end = src.indexOf("\n  },", start);
  const out: Record<string, string> = {};
  for (const m of src.slice(start, end).matchAll(/^\s{4}(\w+): "((?:[^"\\]|\\.)*)",$/gm)) out[m[1]] = m[2];
  return out;
}

async function main() {
  const brand = await import("../lib/cgm/brand");
  const { profileScopedKeys } = await import("../lib/profileScopedKeys");

  // Five brand options.
  assert.deepEqual([...brand.CGM_BRANDS], ["dexcom", "libre", "medtronic", "eversense", "other"]);

  // Every brand label, the question and every message key exist in all nine languages.
  const required = [
    "question", "current", "change", "msgDexcom", "msgLibre", "msgOther", "nightscoutLine", "manualLine",
    ...brand.CGM_BRANDS,
  ];
  for (const lang of LANGS) {
    const ns = namespace(lang);
    for (const k of required) assert.ok(ns[k] && ns[k].length > 0, `${lang}: cgmBrand.${k} eksik`);
  }

  // Every key a brand can show resolves, with and without the Nightscout flag.
  for (const b of brand.CGM_BRANDS) {
    for (const flag of [true, false]) {
      for (const key of brand.cgmBrandMessageKeys(b, flag)) {
        for (const lang of LANGS) {
          assert.ok(namespace(lang)[key.replace("cgmBrand.", "")], `${lang}: ${key} eksik (${b})`);
        }
      }
    }
  }

  // No bridge or third-party tool names, in any language.
  for (const lang of LANGS) {
    const all = Object.values(namespace(lang)).join("\n");
    assert.ok(!/juggluco|xdrip|librelinkup|libre\s*link\s*up/i.test(all), `${lang}: yasak kopru adi`);
  }

  // Libre says "no verified path", never a flat "does not write".
  {
    const en = namespace("en");
    const libre = [en.msgLibre, en.nightscoutLine, en.manualLine].join(" ");
    assert.ok(!/does not write|doesn't write|do not write|don't write/i.test(libre), "Libre: kesin olumsuz dil");
    assert.ok(/no verified way/i.test(en.msgLibre), "Libre: dogrulanmis yol cercevesi");
  }

  // The Nightscout sentence appears only with the flag, for Libre and the generic brands.
  for (const b of ["libre", "medtronic", "eversense", "other"] as const) {
    assert.ok(brand.cgmBrandMessageKeys(b, true).includes("cgmBrand.nightscoutLine"), `${b}: bayrak aciksa Nightscout cumlesi`);
    assert.ok(!brand.cgmBrandMessageKeys(b, false).includes("cgmBrand.nightscoutLine"), `${b}: bayrak kapaliysa yok`);
  }
  assert.ok(!brand.cgmBrandMessageKeys("dexcom", true).includes("cgmBrand.nightscoutLine"), "Dexcom: Nightscout cumlesi yok");
  assert.ok(brand.cgmBrandMessageKeys("libre", false).includes("cgmBrand.manualLine"), "Libre: elle kayit cumlesi her durumda");

  // Both screens pass the build flag to the component, never a literal true.
  {
    const strip = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
    const ds = strip("app/settings/data-sources.tsx");
    assert.ok(/<CgmBrandNote[\s\S]*?nightscout=\{nsEnabled\}/.test(ds), "data-sources: nightscout bayragi");
    assert.ok(/const nsEnabled = nightscoutEnabled\(\);/.test(ds), "nsEnabled yalniz bayrak");
    const ob = strip("app/onboarding.tsx");
    assert.ok(/<CgmBrandNote[\s\S]*?nightscout=\{nightscoutAvailable\(\) && secureStoreAvailable\(\)\}/.test(ob), "onboarding: nightscout bayragi");
    assert.ok(/measure === "cgm" \? \(\s*<CgmBrandNote/.test(ob), "onboarding: yalniz CGM cevabinda");
    const comp = strip("components/CgmBrandNote.tsx");
    assert.ok(!/logEvent|fetch\(|#[0-9a-fA-F]{3,8}\b|rgba\(|adjustsFontSizeToFit/.test(comp), "bilesen: analitik, ag, sabit renk ya da metin kucultme yok");
  }

  // The choice is stored per profile, on the device, and survives a read.
  {
    assert.equal(await brand.getCgmBrand("p1"), null);
    await brand.setCgmBrand("p1", "libre");
    assert.equal(kv.get("zerospike.cgmBrand.p1"), "libre");
    assert.equal(await brand.getCgmBrand("p1"), "libre");
    assert.equal(await brand.getCgmBrand("p2"), null);
    kv.set("zerospike.cgmBrand.p3", "bogus");
    assert.equal(await brand.getCgmBrand("p3"), null);
    assert.ok(profileScopedKeys("p1").includes("zerospike.cgmBrand.p1"), "profil silinince temizlenir");
  }

  console.log("cgmBrandNote: tamam");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
