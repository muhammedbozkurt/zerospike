/**
 * First onboarding page sample ring: unit follows the device region and the
 * value comes from the lib/glucose conversion. Run: npx tsx scripts/onboardingExampleUnit.test.ts
 */
import { onboardingExample, ONBOARDING_EXAMPLE_MGDL } from "../lib/onboardingExample";
import { glucoseToDisplay, formatGlucose, glucoseUnitLabel } from "../lib/glucose";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${label}${detail ? `: ${detail}` : ""}`);
  }
}

console.log("A. mmol regions show mmol/L 6.0");
for (const r of ["GB", "AU", "CA", "IE", "NZ", "en-GB", "en_AU", "en-CA", "gb"]) {
  const e = onboardingExample(r);
  ok(`${r} unit`, e.unit === "mmol" && glucoseUnitLabel(e.unit) === "mmol/L");
  ok(`${r} value`, e.display === 6 && e.mgdl === ONBOARDING_EXAMPLE_MGDL, String(e.display));
}

console.log("B. other regions show mg/dL 108");
for (const r of ["US", "DE", "TR", "JP", "FR", "BR", "en-US", "", null, undefined]) {
  const e = onboardingExample(r);
  ok(`${String(r)} unit`, e.unit === "mgdl" && glucoseUnitLabel(e.unit) === "mg/dL");
  ok(`${String(r)} value`, e.display === 108, String(e.display));
}

console.log("C. value is tied to the lib/glucose conversion");
ok("mmol display equals glucoseToDisplay", onboardingExample("GB").display === glucoseToDisplay(ONBOARDING_EXAMPLE_MGDL, "mmol"));
ok("mgdl display equals glucoseToDisplay", onboardingExample("US").display === glucoseToDisplay(ONBOARDING_EXAMPLE_MGDL, "mgdl"));
ok("formatGlucose mgdl 108", formatGlucose(ONBOARDING_EXAMPLE_MGDL, "mgdl").replace(/\D/g, "") === "108");
ok("formatGlucose mmol has one decimal", /^6[.,]0$/.test(formatGlucose(ONBOARDING_EXAMPLE_MGDL, "mmol")), formatGlucose(ONBOARDING_EXAMPLE_MGDL, "mmol"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
