/**
 * A manual profile's home is unchanged: every sensor item on the dashboard and
 * in the journal hangs off the mode (anything but manual), nothing renders for
 * "manual", and manual stays the default. Source-level, no renderer.
 * Run: npx tsx scripts/cgmHomeManual.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bosDurumKarari, cgmHomeVisible } from "../lib/homeEmpty";
import { cgmDaysForFilter } from "../lib/cgm/daySummary";
import { parseCgmMode } from "../lib/cgm/state";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const root = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const index = read("app/(tabs)/index.tsx");
const journal = read("app/journal.tsx");

console.log("A. the default and the gate");
ok("nothing stored reads manual", parseCgmMode(null) === "manual" && parseCgmMode(undefined) === "manual");
ok("manual shows no sensor item", cgmHomeVisible("manual") === false);
ok("cgm and nightscout do", cgmHomeVisible("cgm") && cgmHomeVisible("nightscout"));
ok("a manual profile with no record is still the welcome card", bosDurumKarari({ loaded: true, entries: 0, cgm: cgmHomeVisible("manual") }) === "welcome");

console.log("B. the dashboard renders sensor items only behind the mode");
ok("the mode gate is the shared helper", /const cgmActive = cgmHomeVisible\(dataMode\);/.test(index));
ok("the hero is CgmHomeCard only when cgmActive", /\{cgmActive && activeProfile \? \([\s\S]{0,260}<CgmHomeCard/.test(index));
ok("CgmHomeCard has exactly one call site", (index.match(/<CgmHomeCard/g) ?? []).length === 1);
ok("the manual hero is the else branch", /<CgmHomeCard[^>]*\/>\s*\) : lastGlucose \? \(/.test(index));
ok("the day summaries are loaded only when active", /useCgmDaySummaries\(\{[\s\S]{0,200}enabled: cgmActive/.test(index));
ok("the stats feed leaves sensor rows out only when active", /cgmActive \? \{ cgm: "exclude" \} : undefined/.test(index));
ok("the summary rows are merged only when active", /cgmActive && cgmDaysForFilter\(filter\)/.test(index));
ok("the tracking caption only when active", /\{cgmActive \? \(\s*<Txt kind="micro" tone="muted" style=\{\{ marginBottom: SPACE\.sm \}\}>\s*\{t\("cgmHome\.watching"\)\}/.test(index));
ok("the small add button only when active, the gradient bar otherwise", /\{cgmActive \? \([\s\S]{0,700}variant="outlined"[\s\S]{0,300}\) : \(\s*<GradientCTA/.test(index));
ok("the week strip is the manual strip only", /!cgmActive && weekView === "boxes"/.test(index) && /!cgmActive && weekView === "firstHint"/.test(index));
ok("the screenshot link is inert outside screenshot mode", /if \(!isScreenshotMode\(\) \|\| !screenshotProfileId\) return;/.test(index));

console.log("C. the journal screen folds sensor readings only behind the mode");
ok("the journal screen gates on the mode", /const cgmActive = dataMode !== "manual";/.test(journal));
ok("the summaries are loaded only when active", /useCgmDaySummaries\(\{[\s\S]{0,200}enabled: cgmActive/.test(journal));
ok("the merge is behind the mode", /cgmActive && cgmDaysForFilter\(filter\)/.test(journal));
ok("sensor rows never list one by one (feed excludes them)", /cgm: "exclude"/.test(journal));
ok("summary rows belong to the all and glucose lists only", cgmDaysForFilter("all") && cgmDaysForFilter("glucose") && !cgmDaysForFilter("meal"));

console.log("D. no sensor component leaks into other screens");
for (const rel of ["components/CgmHomeCard.tsx", "components/CgmSwitchOffer.tsx"]) {
  const name = rel.split("/").pop()!.replace(".tsx", "");
  ok(`${name} is used only by the dashboard`, !/<(CgmHomeCard|CgmSwitchOffer)/.test(journal));
}
ok("the home card draws no threshold line or alert colour", !/(alert|alarm|warning|danger)/i.test(read("components/CgmHomeCard.tsx")));
ok("the curve has no hard-coded colour", !/#[0-9a-fA-F]{3,8}\b|rgba\(/.test(read("components/charts/CgmCurve.tsx")));

console.log("E. Pro: the home curve is free (inside 24 hours), older days are not");
{
  const sheet = read("components/CgmDaySheet.tsx");
  ok("a day is locked when it ended more than 24 hours ago and the account is not Pro", /!isProUser && cgmWindowNeedsPro\(range\.hiMs, Date\.now\(\)\)/.test(sheet));
  ok("a free account's rows are cut to the last 24 hours", /getCgmWindowRows\(profileId, freeRowsStartMs\(range\.loMs, Date\.now\(\), isProUser\), range\.hiMs - 1\)/.test(sheet));
  ok("a locked day runs no query", /if \(!range \|\| !profileId \|\| locked\) \{\s*setRows\(\[\]\);\s*return;/.test(sheet));
  ok("the lock offers the existing upgrade path", /proCta\.upgrade/.test(sheet) && /pathname: "\/paywall"/.test(sheet));
  const card = read("components/CgmHomeCard.tsx");
  ok("the home card has no Pro gate: 3, 6 and 12 hours are all inside the free 24", !/isProUser|paywall/.test(card));
}

console.log(`\ncgmHomeManual: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
