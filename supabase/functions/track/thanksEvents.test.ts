import { EVENT_SCHEMA, parseTrackBody } from "../_shared/event-schema.ts";

function assertEq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
  }
}

const NOW = Date.parse("2026-11-01T12:00:00Z");

function batch(events: unknown[]) {
  return parseTrackBody(EVENT_SCHEMA, { events }, NOW);
}

Deno.test("trial_converted_seen and renewal_seen are accepted, with no props", () => {
  const b = batch([
    { name: "trial_converted_seen", ts: "2026-11-01T11:59:00Z" },
    { name: "renewal_seen", ts: "2026-11-01T11:59:30Z" },
  ]);
  assertEq(b?.dropped, 0);
  assertEq(b?.events.map((e) => e.name), ["trial_converted_seen", "renewal_seen"]);
});

Deno.test("props sent on the two thank-you events never reach storage", () => {
  const b = batch([
    { name: "trial_converted_seen", props: { product: "annual", expires: "2027-01-01" } },
    { name: "renewal_seen", props: { product: "monthly" } },
  ]);
  assertEq(b?.events.map((e) => e.props), [{}, {}]);
});

Deno.test("store_review_prompt takes trial_converted and still rejects unknown triggers", () => {
  const b = batch([
    { name: "store_review_prompt", props: { trigger: "trial_converted" } },
    { name: "store_review_prompt", props: { trigger: "log_saved" } },
    { name: "store_review_prompt", props: { trigger: "something_else" } },
  ]);
  assertEq(b?.events.map((e) => e.props), [{ trigger: "trial_converted" }, { trigger: "log_saved" }, {}]);
});
