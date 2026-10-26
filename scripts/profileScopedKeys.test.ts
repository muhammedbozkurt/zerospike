/**
 * lib/profileScopedKeys.ts correctness harness (X9). No jest, same standalone
 * style as scripts/alarmSelect.test.ts.
 *
 * The property under test: the list of per-profile AsyncStorage keys that
 * deleteProfile sweeps is COMPLETE. It is a hand-maintained list of base names
 * whose owners live in screens and services this harness cannot import, so
 * every entry is checked against the real source file that writes it - a rename
 * that forgets the list fails here instead of silently orphaning a deleted
 * profile's flags (one of which is a health preference the user asked to remove
 * along with the profile).
 *
 * Run: npx tsx scripts/profileScopedKeys.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PROFILE_SCOPED_KEY_BASES,
  profileScopedKeys,
} from "../lib/profileScopedKeys";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const root = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

console.log("zerospike profile-scoped keys test");

section("A. every base name is really written by the file that owns it");
{
  // base name -> the source that declares it. If one of these moves, the test
  // points at exactly which pair drifted.
  const owners: Record<string, string> = {
    "zerospike.healthWriteEnabled": "lib/services/health.ts",
    "zerospike.editHintDismissed": "app/(tabs)/index.tsx",
    "zerospike.finishSetupDismissed": "app/(tabs)/index.tsx",
    "zerospike.rotationCycleStart": "lib/rotationCycle.ts",
    "zerospike.screenshotSeededLang.v16": "lib/db/screenshotSeed.ts",
    "zerospike.ratiosConfirmPrompted": "lib/calcSetup.ts",
    "zerospike.calcSetupDismissed": "lib/calcSetup.ts",
    "zerospike.healthFirstImportDone": "lib/healthFirstImport.ts",
    "zerospike.reportName": "lib/reportName.ts",
    "zerospike.healthWriteCarbs": "lib/services/health.ts",
    "zerospike.healthWriteInsulin": "lib/services/health.ts",
    "zerospike.healthBgSync": "lib/services/health.ts",
    "zerospike.healthLastSync": "lib/services/health.ts",
    "zerospike.healthWriteStatus": "lib/services/health.ts",
    "zerospike.healthWritePending": "lib/services/health.ts",
    "zerospike.healthWritePending.carbs": "lib/services/health.ts",
    "zerospike.healthWritePending.insulin": "lib/services/health.ts",
    "zerospike.cgmMode": "lib/cgm/state.ts",
    "zerospike.cgmOffer": "lib/cgm/state.ts",
    "zerospike.cgmGlucoseOptIn": "lib/cgm/reminderMode.ts",
    "zerospike.cgmPostMealPending": "lib/cgm/postMealLink.ts",
    "zerospike.cgmCurveHours": "lib/useCgmWindow.ts",
  };
  for (const base of PROFILE_SCOPED_KEY_BASES) {
    const file = owners[base];
    ok(`${base} has a declared owner`, file != null);
    if (!file) continue;
    // Some owners quote the base ("zerospike.x"), others embed it in a
    // template literal (`zerospike.x.${profileId}`), so match the bare name.
    ok(`${base} still appears in ${file}`, read(file).includes(base.replace(/(\.healthWritePending)\.(carbs|insulin)$/, "$1")));
  }
  eq(
    "the list and the owner map are the same size",
    PROFILE_SCOPED_KEY_BASES.length,
    Object.keys(owners).length
  );
}

section("B. the scoped form is the shape every owner writes");
{
  // Each owner builds its key as `${base}.${profileId}`; the sweep has to
  // produce byte-identical strings or it deletes nothing.
  const keys = profileScopedKeys("p1");
  eq("one key per base", keys.length, PROFILE_SCOPED_KEY_BASES.length);
  for (const base of PROFILE_SCOPED_KEY_BASES) {
    ok(`${base}.p1 is produced`, keys.includes(`${base}.p1`));
  }
  ok("no key is left unscoped", !keys.some((k) => !k.endsWith(".p1")));
  // Two profiles never collide.
  const other = profileScopedKeys("p2");
  ok("no overlap between profiles", !keys.some((k) => other.includes(k)));
}

section("C. deleteProfile actually performs the sweep");
{
  const src = read("lib/db/profiles.ts");
  ok(
    "deleteProfile imports the shared list",
    /import \{ profileScopedKeys \} from "\.\.\/profileScopedKeys";/.test(src)
  );
  ok(
    "and removes them for the deleted id",
    /multiRemove\(profileScopedKeys\(id\)\)/.test(src)
  );
  // The sweep must not be able to fail the delete itself.
  const body = src.slice(src.indexOf("export async function deleteProfile"));
  const sweepAt = body.indexOf("multiRemove");
  const tryAt = body.lastIndexOf("try {", sweepAt);
  ok("the sweep is inside a try", tryAt !== -1 && tryAt < sweepAt);
  ok(
    "and it runs AFTER the row is deleted",
    body.indexOf("DELETE FROM user_profiles") < sweepAt
  );
}

section("D. the sweep never touches device-level keys");
{
  // These belong to the device, not to any profile: sweeping one would take a
  // setting away from every remaining profile.
  const deviceLevel = [
    "zerospike.liveData",
    "zerospike.notifPrefs",
    "zerospike.alarmTourSeen",
    "zerospike.postMealTimerEnd",
    "zerospike.activeProfileId",
  ];
  const keys = profileScopedKeys("p1");
  for (const device of deviceLevel) {
    ok(`${device} is not swept`, !keys.includes(device) && !keys.includes(`${device}.p1`));
    ok(
      `${device} is not a base either`,
      !(PROFILE_SCOPED_KEY_BASES as readonly string[]).includes(device)
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
