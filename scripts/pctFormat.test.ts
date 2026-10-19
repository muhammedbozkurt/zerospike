/**
 * pct()/pctParts(): the sign never breaks away from the number (U+00A0 in
 * de/fr/es), tr/en/others unchanged.   npx tsx scripts/pctFormat.test.ts
 */
import { pct, pctParts } from "../lib/format";
import { setActiveLang } from "../lib/lang";

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const NB = " ";
for (const l of ["de", "fr", "es"]) {
  setActiveLang(l);
  eq(`${l} pct`, pct(92), `92${NB}%`);
  eq(`${l} pctParts sign`, pctParts(92).sign, `${NB}%`);
}
setActiveLang("tr");
eq("tr pct", pct(92), "%92");
setActiveLang("en");
eq("en pct", pct(92), "92%");
setActiveLang("it");
eq("it pct", pct(92), "92%");

if (failed) {
  console.log(`pctFormat: ${failed} failed`);
  process.exit(1);
}
console.log("pctFormat: all passed");
