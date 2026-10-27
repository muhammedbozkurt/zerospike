/**
 * The onboarding "how do you measure" question only offers sources the app can
 * actually connect, and the Pro one is gated. Run: npx -y tsx scripts/cgmSourceAvailability.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { nightscoutAllowed } from "../lib/cgm/pro";
import { NIGHTSCOUT_ENABLED, nightscoutAvailable } from "../lib/cgm/sourceAvailability";
import { measureOptionsFor, measureNeedsPro } from "../lib/onboardingSteps";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

console.log("A. availability");
ok("the connector flag is an explicit constant, off until the connector ships", NIGHTSCOUT_ENABLED === false);
ok("nightscoutAvailable follows the flag by default", nightscoutAvailable() === NIGHTSCOUT_ENABLED);
ok("and can be forced on for the check below", nightscoutAvailable(true) === true && nightscoutAvailable(false) === false);

console.log("B. the option list");
ok("no connector: nightscout is hidden even with a health store", !measureOptionsFor({ hasHealth: true, nightscout: false }).includes("nightscout"));
ok("no connector, no health store: only the finger prick", measureOptionsFor({ hasHealth: false, nightscout: false }).join() === "finger");
ok("connector present: nightscout is listed", measureOptionsFor({ hasHealth: true, nightscout: true }).join() === "finger,cgm,nightscout");
ok("no health store hides cgm only", measureOptionsFor({ hasHealth: false, nightscout: true }).join() === "finger,nightscout");
ok("nightscout needs Pro, the others never do", measureNeedsPro("nightscout") === true && measureNeedsPro("cgm") === false && measureNeedsPro("finger") === false);
ok("the Pro rule is the shared one", nightscoutAllowed(true) && !nightscoutAllowed(false));

console.log("C. the screen");
const onb = readFileSync(join(import.meta.dirname, "..", "app/onboarding.tsx"), "utf8");
ok("the list comes from measureOptionsFor with the availability flag", /measureOptionsFor\(\{[^}]*nightscout: nightscoutAvailable\(\)/.test(onb));
ok("a non-Pro pick of nightscout goes to the paywall instead of being chosen", /measureNeedsPro\(picked\)[\s\S]{0,120}!nightscoutAllowed\(isProUser\)[\s\S]{0,200}\/paywall/.test(onb));
ok("the note shows only for the nightscout answer", /nightscoutHandoff\(measure\)\s*\?/.test(onb));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
