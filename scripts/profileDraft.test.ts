/**
 * lib/profileDraft.ts correctness harness (Z1/Z6). No jest, same standalone
 * style as scripts/alarmSelect.test.ts.
 *
 * The property under test: cancelling a brand-new profile must never race a
 * write. app/profile-setup.tsx is opened by the profile switcher AFTER the new
 * row is created and made active, so "the user closed it" is a real decision -
 * and it can arrive from the X, from an unmount, or from a modal swipe, at any
 * moment, including while a save or a reminder-plan setup is still inserting
 * rows. Deciding "discard" at that moment deletes a profile out from under an
 * in-flight insert; deciding it after an active-profile switch would delete the
 * WRONG profile and take another profile's reminders down with it (deleteProfile
 * clears that profile's reminders by design, lib/db/profiles.ts).
 *
 * Run: npx tsx scripts/profileDraft.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  decideDraftDiscard,
  resolveFallbackProfileId,
  type DraftDecision,
  type DraftDiscardInput,
} from "../lib/profileDraft";

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

console.log("zerospike profile draft test");

/** A freshly created profile, nothing configured, nothing running. */
const DRAFT: DraftDiscardInput = {
  isDraft: true,
  saved: false,
  planInstalled: false,
  alreadyDiscarded: false,
  inFlight: false,
};

section("A. the plain cases");
{
  eq("an untouched draft is discarded", decideDraftDiscard(DRAFT), "discard");
  eq(
    "a saved profile is the user's own",
    decideDraftDiscard({ ...DRAFT, saved: true }),
    "keep"
  );
  eq(
    "a profile whose measurement layout was set up is kept",
    decideDraftDiscard({ ...DRAFT, planInstalled: true }),
    "keep"
  );
  eq(
    "not a draft at all (opened for an existing profile)",
    decideDraftDiscard({ ...DRAFT, isDraft: false }),
    "none"
  );
  eq(
    "a second dismiss never deletes twice",
    decideDraftDiscard({ ...DRAFT, alreadyDiscarded: true }),
    "none"
  );
}

section("B. dismiss WHILE a write is in flight decides nothing (Z1b)");
{
  // The regression this exists for: the X, the unmount cleanup and the modal
  // swipe all call the same discard, and all three can land mid-save. Deferring
  // is the only answer that is safe for every one of them.
  eq(
    "dismissed during a save",
    decideDraftDiscard({ ...DRAFT, inFlight: true }),
    "defer"
  );
  eq(
    "dismissed during a reminder-plan setup",
    decideDraftDiscard({ ...DRAFT, inFlight: true }),
    "defer"
  );

  // And the re-ask, which is what app/profile-setup.tsx runs in the write's
  // `finally`. The answer is now decided by what the write actually did.
  eq(
    "re-asked after the save landed: kept",
    decideDraftDiscard({ ...DRAFT, inFlight: false, saved: true }),
    "keep"
  );
  eq(
    "re-asked after the plan landed: kept (the carve-out)",
    decideDraftDiscard({ ...DRAFT, inFlight: false, planInstalled: true }),
    "keep"
  );
  eq(
    "re-asked after a write that changed nothing: discarded as asked",
    decideDraftDiscard({ ...DRAFT, inFlight: false }),
    "discard"
  );

  // A write that has already FINISHED must answer on its own rather than be
  // deferred behind another one still winding down - otherwise a save followed
  // by a slow trailing write could defer forever and never re-ask.
  eq(
    "a completed save outranks a still-running write",
    decideDraftDiscard({ ...DRAFT, saved: true, inFlight: true }),
    "keep"
  );
  eq(
    "so does a completed plan setup",
    decideDraftDiscard({ ...DRAFT, planInstalled: true, inFlight: true }),
    "keep"
  );
  // Already acted on outranks everything: a deferred dismiss that is re-asked
  // twice must not delete a second time.
  eq(
    "already discarded outranks an in-flight write",
    decideDraftDiscard({ ...DRAFT, alreadyDiscarded: true, inFlight: true }),
    "none"
  );
}

section("C. exhaustive: 'discard' is the ONLY combination that deletes");
{
  // 32 combinations. Nothing but "a real draft, nothing configured, nothing
  // running, not already answered" may ever return "discard" - every other
  // input must return one of the three harmless answers.
  const flags = [true, false];
  let discards = 0;
  for (const isDraft of flags) {
    for (const saved of flags) {
      for (const planInstalled of flags) {
        for (const alreadyDiscarded of flags) {
          for (const inFlight of flags) {
            const input: DraftDiscardInput = {
              isDraft,
              saved,
              planInstalled,
              alreadyDiscarded,
              inFlight,
            };
            const got: DraftDecision = decideDraftDiscard(input);
            const wantDiscard =
              isDraft && !saved && !planInstalled && !alreadyDiscarded && !inFlight;
            eq(
              `draft=${isDraft} saved=${saved} plan=${planInstalled} done=${alreadyDiscarded} busy=${inFlight}`,
              got === "discard",
              wantDiscard
            );
            if (got === "discard") discards++;
          }
        }
      }
    }
  }
  eq("exactly one combination deletes", discards, 1);
}

section("D. where a discard goes back to (Z6)");
{
  const draftId = "draft";
  const list = [{ id: "p1" }, { id: "p2" }, { id: draftId }];

  eq(
    "the profile that was active before, when it still exists",
    resolveFallbackProfileId("p2", list, draftId),
    "p2"
  );
  // The regression: that profile can be deleted from Settings > Data while this
  // screen is open, and switching to a row that is gone leaves AppContext
  // pointing at nothing.
  eq(
    "a previous profile that has since been deleted falls through",
    resolveFallbackProfileId("gone", list, draftId),
    "p1"
  );
  eq(
    "no hint at all falls through the same way",
    resolveFallbackProfileId(null, list, draftId),
    "p1"
  );
  // Never the draft itself: it is about to be deleted.
  eq(
    "the hint can never be the draft",
    resolveFallbackProfileId(draftId, list, draftId),
    "p1"
  );
  eq(
    "and the fallback skips the draft too",
    resolveFallbackProfileId(null, [{ id: draftId }, { id: "p9" }], draftId),
    "p9"
  );
  // Nothing to go back to: the caller leaves the active profile alone rather
  // than switching to a profile that does not exist.
  eq(
    "a list holding only the draft has no fallback",
    resolveFallbackProfileId(null, [{ id: draftId }], draftId),
    null
  );
  eq("an empty list has no fallback", resolveFallbackProfileId(null, [], draftId), null);
  eq(
    "nor does a stale hint with nothing else left",
    resolveFallbackProfileId("gone", [{ id: draftId }], draftId),
    null
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
