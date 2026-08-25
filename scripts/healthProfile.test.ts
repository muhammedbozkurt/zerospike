/**
 * lib/healthWriteScope.ts correctness harness (2.3.0's K3-5). No jest, same
 * standalone style as scripts/alarmSelect.test.ts.
 *
 * Two properties are under test, both of them things a shared (family /
 * caregiver) install gets wrong the moment they slip:
 *
 *  1. The Apple Health mirror belongs to ONE profile. A reading is written only
 *     when the toggle is on AND the reading is that same profile's. There is
 *     only one Health account on a device, so an "on" toggle is never a licence
 *     to push another profile's readings into it.
 *  2. The move off the old device-wide flag hands it to exactly one profile,
 *     once. Running the read again must ask for no further writes, or a second
 *     profile could inherit the same opt-in.
 *
 * Run: npx tsx scripts/healthProfile.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  planWriteFlagRead,
  shouldWriteToHealth,
  type WriteFlagStored,
} from "../lib/healthWriteScope";

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

console.log("zerospike health write scope test");

const P1 = "profile-1";
const P2 = "profile-2";

section("A. two profiles on one device: only the matching one is mirrored");
{
  eq(
    "p1 toggle on + p1 reading -> writes",
    shouldWriteToHealth({
      writeEnabledForProfile: true,
      recordProfileId: P1,
      enabledProfileId: P1,
    }),
    true
  );
  eq(
    "p1 toggle on + p2 reading -> does NOT write",
    shouldWriteToHealth({
      writeEnabledForProfile: true,
      recordProfileId: P2,
      enabledProfileId: P1,
    }),
    false
  );
  eq(
    "toggle off + p1 reading -> does NOT write",
    shouldWriteToHealth({
      writeEnabledForProfile: false,
      recordProfileId: P1,
      enabledProfileId: P1,
    }),
    false
  );
  eq(
    "toggle off + p2 reading -> does NOT write",
    shouldWriteToHealth({
      writeEnabledForProfile: false,
      recordProfileId: P2,
      enabledProfileId: P1,
    }),
    false
  );
}

section("B. an unresolvable profile on either side never writes");
{
  for (const missing of [null, undefined, ""] as (string | null | undefined)[]) {
    eq(
      `record profile ${JSON.stringify(missing)} -> no write`,
      shouldWriteToHealth({
        writeEnabledForProfile: true,
        recordProfileId: missing,
        enabledProfileId: P1,
      }),
      false
    );
    eq(
      `enabled profile ${JSON.stringify(missing)} -> no write`,
      shouldWriteToHealth({
        writeEnabledForProfile: true,
        recordProfileId: P1,
        enabledProfileId: missing,
      }),
      false
    );
  }
  eq(
    "both sides missing is NOT a match",
    shouldWriteToHealth({
      writeEnabledForProfile: true,
      recordProfileId: null,
      enabledProfileId: null,
    }),
    false
  );
}

section("C. migration: the device-wide flag moves to the first profile that reads it");
{
  const first = planWriteFlagRead({ scoped: null, legacy: "1" });
  eq("legacy ON is read as on", first.enabled, true);
  eq("legacy ON is copied to the scoped key", first.adoptScoped, "1");
  eq("legacy key is retired in the same pass", first.clearLegacy, true);

  const off = planWriteFlagRead({ scoped: null, legacy: "0" });
  eq("legacy OFF is read as off", off.enabled, false);
  eq("legacy OFF is copied verbatim", off.adoptScoped, "0");
  eq("legacy OFF key is retired too", off.clearLegacy, true);

  const fresh = planWriteFlagRead({ scoped: null, legacy: null });
  eq("nothing stored -> off", fresh.enabled, false);
  eq("nothing stored -> no adoption", fresh.adoptScoped, null);
  eq("nothing stored -> nothing to clear", fresh.clearLegacy, false);
}

section("D. migration is idempotent: the second run is a pure read");
{
  // Replays what storage actually does, so "run it twice" is tested against the
  // state the first run leaves behind rather than a hand-written assumption.
  const store: WriteFlagStored = { scoped: null, legacy: "1" };
  function runRead(): boolean {
    const plan = planWriteFlagRead(store);
    if (plan.adoptScoped != null) store.scoped = plan.adoptScoped;
    if (plan.clearLegacy) store.legacy = null;
    return plan.enabled;
  }

  eq("first run reports on", runRead(), true);
  eq("first run left the scoped value", store.scoped, "1");
  eq("first run removed the device-wide value", store.legacy, null);

  const second = planWriteFlagRead(store);
  eq("second run still reports on", second.enabled, true);
  eq("second run adopts nothing", second.adoptScoped, null);
  eq("second run clears nothing", second.clearLegacy, false);
  eq("a third run is still stable", runRead(), true);
  eq("scoped value unchanged after three runs", store.scoped, "1");
  eq("device-wide value stays gone", store.legacy, null);

  // The other profile on the same device reads its OWN (absent) key, and the
  // device-wide value it could once have inherited is no longer there.
  const other = planWriteFlagRead({ scoped: null, legacy: store.legacy });
  eq("second profile does not inherit the opt-in", other.enabled, false);
  eq("second profile adopts nothing", other.adoptScoped, null);
}

section("E. a scoped value always wins over a stale device-wide one");
{
  const plan = planWriteFlagRead({ scoped: "0", legacy: "1" });
  eq("scoped OFF beats legacy ON", plan.enabled, false);
  eq("scoped value is not overwritten", plan.adoptScoped, null);
  eq("the stale legacy key is still cleaned up", plan.clearLegacy, true);
}

section("F. the UPDATE path is gated by the same rule as the write path (X7)");
{
  // updateGlucoseInHealth WRITES a new sample (HealthKit has no in-place
  // update: it revokes the old one and writes a replacement), so it is a write
  // and has to pass the same per-profile gate.
  //
  // The bug this pins: its `recordProfileId` used to DEFAULT to the profile
  // that owns the switch, which made shouldWriteToHealth compare a value to
  // itself - the gate could never close, and a caregiver correcting a reading
  // on one profile mirrored it into another profile's Health account. The
  // parameter is required now, and both call sites pass the ROW's own owner
  // (app/calculator.tsx and lib/services/glucoseEdit.ts).
  const P1 = "p1";
  const P2 = "p2";

  eq(
    "switch on for p1, correcting a p1 reading -> writes",
    shouldWriteToHealth({
      writeEnabledForProfile: true,
      recordProfileId: P1,
      enabledProfileId: P1,
    }),
    true
  );
  eq(
    "switch on for p1, correcting a p2 reading -> does NOT write",
    shouldWriteToHealth({
      writeEnabledForProfile: true,
      recordProfileId: P2,
      enabledProfileId: P1,
    }),
    false
  );
  eq(
    "switch off, correcting a p1 reading -> does not write",
    shouldWriteToHealth({
      writeEnabledForProfile: false,
      recordProfileId: P1,
      enabledProfileId: P1,
    }),
    false
  );

  // The old defaulting behaviour, spelled out so it cannot come back: feeding
  // the enabled profile in as the record's owner always opens the gate, which
  // is exactly why the parameter must not have a default.
  eq(
    "the removed default would have opened the gate for ANY row",
    shouldWriteToHealth({
      writeEnabledForProfile: true,
      recordProfileId: P1,
      enabledProfileId: P1,
    }),
    true
  );

  // And the signature really is required now.
  const src = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "health.ts"),
    "utf8"
  );
  ok(
    "updateGlucoseInHealth takes a required recordProfileId",
    /recordProfileId: string \| null\n\): Promise<string \| null>/.test(src)
  );
  ok(
    "and no longer falls back to the enabled profile",
    !/recordProfileId: recordProfileId \?\? scope\.profileId/.test(src)
  );

  // Both callers pass the row's own owner.
  const calc = readFileSync(
    join(import.meta.dirname, "..", "app", "calculator.tsx"),
    "utf8"
  );
  ok("calculator.tsx passes row.profile_id", /row\.profile_id/.test(calc));
  const edit = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "glucoseEdit.ts"),
    "utf8"
  );
  ok("glucoseEdit.ts passes the stored row's owner", /stored\.profile_id/.test(edit));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
