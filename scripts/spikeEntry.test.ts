/**
 * Spike home entry card and the single fixed scope note. Source-pattern checks:
 *
 *   node --experimental-strip-types scripts/spikeEntry.test.ts
 */
import { readFileSync } from "node:fs";

const read = (p: string): string => readFileSync(p, "utf8");
let failed = 0;
const check = (name: string, ok: boolean): void => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};

const home = read("app/(tabs)/index.tsx");
const spike = read("app/spike.tsx");
const limit = read("lib/ai/spikeLimit.ts");

check("free cap read from the constant", /FREE_DAILY_MESSAGES\s*=\s*3/.test(limit) && /n:\s*FREE_DAILY_MESSAGES/.test(home));
check("free info hidden for Pro", /!isProUser\s*\?[\s\S]{0,200}spike\.entryFree/.test(home));
check("card routes to /spike", /router\.push\("\/spike"\)[\s\S]{0,900}spike\.entryBody/.test(home));
check("no disclaimer inside bubbles", !/disclaimer=/.test(spike) && !/disclaimer:\s*string/.test(spike));
check("exactly one fixed note", (spike.match(/spike\.disclaimer/g) ?? []).length === 1);

for (const lang of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const loc = read(`lib/i18n/locales/${lang}.ts`);
  const ok = ["entryBody", "entryFree", "disclaimer"].every((k) => new RegExp(`^    ${k}:`, "m").test(loc));
  check(`i18n keys in ${lang}`, ok);
}

if (failed > 0) throw new Error(`${failed} check(s) failed`);
