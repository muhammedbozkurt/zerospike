/**
 * G12 + K23: the disabled save button explains itself and the segment chip is a
 * noun. Run: npx sucrase-node scripts/injectionCta.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const form: string = readFileSync(join(__dirname, "..", "app/(tabs)/injection.tsx"), "utf8");

ok("dose hint no longer waits for a touch", !form.includes("doseHintVisible(") && !form.includes("setDoseInteracted"));
ok("dose hint is driven by the blockers", form.includes("blockers.dose"));
ok("CTA states why it is off", form.includes("injection.ctaNeedSite"));

let helper: any = null;
try {
  helper = require("../lib/injectionCta");
} catch {
  ok("lib/injectionCta.ts exists", false);
}
if (helper) {
  const { ctaBlockers } = helper;
  const a = ctaBlockers({ hasSite: false, doseOk: false });
  ok("nothing chosen: both missing", a.site && a.dose);
  const b = ctaBlockers({ hasSite: true, doseOk: false });
  ok("site chosen, no dose: dose only", !b.site && b.dose);
  const c = ctaBlockers({ hasSite: false, doseOk: true });
  ok("dose set, no site: site only", c.site && !c.dose);
  const d = ctaBlockers({ hasSite: true, doseOk: true });
  ok("ready: nothing missing", !d.site && !d.dose);
}

const want: Record<string, string> = {
  tr: "Yeni kayıt",
  en: "New entry",
  de: "Neuer Eintrag",
  fr: "Nouvelle entrée",
  es: "Nuevo registro",
  it: "Nuova voce",
  pt: "Novo registro",
  ar: "إدخال جديد",
  ja: "新規記録",
};
const MAX_WORD = 10;
for (const lang of Object.keys(want)) {
  const inj = require(`../lib/i18n/locales/${lang}`).default.injection as Record<string, string>;
  ok(`${lang} segSave is the agreed noun`, inj.segSave === want[lang]);
  const longest = Math.max(...inj.segSave.split(/\s+/).map((w) => w.length));
  ok(`${lang} segSave words fit a chip of three`, longest <= MAX_WORD);
  ok(`${lang} has ctaNeedSite`, typeof inj.ctaNeedSite === "string" && inj.ctaNeedSite.length > 0);
  ok(`${lang} ctaNeedSite has no em-dash`, !(inj.ctaNeedSite ?? "").includes("—"));
}

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
