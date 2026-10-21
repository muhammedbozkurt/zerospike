/**
 * Region-based starting glucose unit and English regional formats
 * (lib/unitByRegion, lib/format formatTagFor). Run: npx tsx scripts/unitByRegion.test.ts
 */
import {
  defaultGlucoseUnitForRegion,
  initialOnboardingUnit,
  regionFromLocaleTag,
} from "../lib/unitByRegion";
import { formatTagFor } from "../lib/format";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${label}${detail ? `: ${detail}` : ""}`);
  }
}

console.log("A. mmol regions");
for (const r of ["GB", "AU", "CA", "IE", "NZ"]) {
  ok(`${r} -> mmol`, defaultGlucoseUnitForRegion(r) === "mmol");
  ok(`${r.toLowerCase()} (lower case) -> mmol`, defaultGlucoseUnitForRegion(r.toLowerCase()) === "mmol");
  ok(`en-${r} tag -> mmol`, defaultGlucoseUnitForRegion(`en-${r}`) === "mmol");
  ok(`en_${r} tag -> mmol`, defaultGlucoseUnitForRegion(`en_${r}`) === "mmol");
}
ok("padded region -> mmol", defaultGlucoseUnitForRegion(" gb ") === "mmol");

console.log("B. every other region keeps the existing mg/dL start");
for (const r of ["US", "DE", "FR", "TR", "JP", "BR", "SA", "MX", "IT", "ES", "PT", "IN", "ZA", "CN"]) {
  ok(`${r} -> mgdl`, defaultGlucoseUnitForRegion(r) === "mgdl");
}
ok("null -> mgdl", defaultGlucoseUnitForRegion(null) === "mgdl");
ok("undefined -> mgdl", defaultGlucoseUnitForRegion(undefined) === "mgdl");
ok("empty -> mgdl", defaultGlucoseUnitForRegion("") === "mgdl");
ok("language-only tag en -> mgdl", defaultGlucoseUnitForRegion("en") === "mgdl");
ok("en-US tag -> mgdl", defaultGlucoseUnitForRegion("en-US") === "mgdl");
ok("de-DE tag -> mgdl", defaultGlucoseUnitForRegion("de-DE") === "mgdl");
ok("tr-TR tag -> mgdl", defaultGlucoseUnitForRegion("tr-TR") === "mgdl");
ok("junk -> mgdl", defaultGlucoseUnitForRegion("###") === "mgdl");

console.log("C. region from a locale tag");
ok("en-GB", regionFromLocaleTag("en-GB") === "GB");
ok("en_au", regionFromLocaleTag("en_au") === "AU");
ok("zh-Hans-CN skips the script", regionFromLocaleTag("zh-Hans-CN") === "CN");
ok("pt-BR", regionFromLocaleTag("pt-BR") === "BR");
ok("bare region", regionFromLocaleTag("nz") === "NZ");
ok("bare language 3 letters", regionFromLocaleTag("fil") === "");
ok("null", regionFromLocaleTag(null) === "");

console.log("D. a saved unit is never overwritten");
ok("saved mmol in a US region stays mmol", initialOnboardingUnit("mmol", "US") === "mmol");
ok("saved mmol with no region stays mmol", initialOnboardingUnit("mmol", undefined) === "mmol");
ok("saved mmol in a GB region stays mmol", initialOnboardingUnit("mmol", "GB") === "mmol");
ok("fresh profile (mgdl default) in GB starts mmol", initialOnboardingUnit("mgdl", "GB") === "mmol");
ok("no profile in AU starts mmol", initialOnboardingUnit(undefined, "AU") === "mmol");
ok("fresh profile in US stays mgdl", initialOnboardingUnit("mgdl", "US") === "mgdl");
ok("fresh profile in DE stays mgdl", initialOnboardingUnit("mgdl", "DE") === "mgdl");
ok("no profile, no region -> mgdl", initialOnboardingUnit(undefined, null) === "mgdl");

console.log("E. English follows the device region, other languages do not");
ok("en + GB -> en-GB", formatTagFor("en", "GB") === "en-GB");
ok("en + AU -> en-AU", formatTagFor("en", "AU") === "en-AU");
ok("en + CA -> en-CA", formatTagFor("en", "CA") === "en-CA");
ok("en + US -> en", formatTagFor("en", "US") === "en");
ok("en + no region -> en", formatTagFor("en", "") === "en");
ok("tr + GB -> tr", formatTagFor("tr", "GB") === "tr");
ok("de + GB -> de", formatTagFor("de", "GB") === "de");
ok("ar + GB keeps latin digits", formatTagFor("ar", "GB") === "ar-u-nu-latn");

console.log("F. Intl output for those tags");
const d = new Date(2026, 9, 21, 15, 5);
const dateOf = (tag: string) => d.toLocaleDateString(tag);
ok("en-GB date is 21/10/2026", dateOf("en-GB") === "21/10/2026", dateOf("en-GB"));
ok("en-AU date is 21/10/2026", dateOf("en-AU") === "21/10/2026", dateOf("en-AU"));
ok("en date stays month first", dateOf("en") === "10/21/2026", dateOf("en"));
ok(
  "formatTagFor('en','GB') feeds Intl to the GB date",
  dateOf(formatTagFor("en", "GB")) === "21/10/2026"
);
ok("en-GB glucose keeps the dot decimal", (5.5).toLocaleString("en-GB", { minimumFractionDigits: 1 }) === "5.5");
ok("en-GB percent is 92%", new Intl.NumberFormat("en-GB", { style: "percent" }).format(0.92) === "92%");

console.log("G. regional English app locales resolve to the en catalogue");
for (const tag of ["en-GB", "en-AU", "en-CA", "en-IE", "en-NZ"]) {
  ok(`${tag} language code is en`, new Intl.Locale(tag).language === "en");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
