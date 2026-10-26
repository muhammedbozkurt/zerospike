// Offline tests for the 502 upstream counter, fetch stubbed:
//   deno test --allow-env --config supabase/functions/ai-ask-spike/deno.json supabase/functions/ai-ask-spike/gate.test.ts
import { upstreamFailure, type Creds } from "./gate.ts";

const creds: Creds = { url: "https://example.invalid", key: "test-key" };

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

async function withFetch(
  handler: (fn: string) => Response | Promise<Response>,
  run: (calls: string[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const fn = String(input).split("/rpc/")[1] ?? "";
    calls.push(fn);
    return Promise.resolve(handler(fn));
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("upstream failure: releases the slot once, counts once, answers 502 upstream", async () => {
  await withFetch(() => new Response("null", { status: 200 }), async (calls) => {
    const res = await upstreamFailure(creds, "device", "2026-10-27", true);
    assertEqual(res.status, 502, "status");
    assertEqual(JSON.stringify(await res.json()), JSON.stringify({ error: "upstream" }), "body");
    assertEqual(calls.filter((c) => c === "spike_release").length, 1, "release calls");
    assertEqual(calls.filter((c) => c === "spike_count_upstream").length, 1, "counter calls");
    assertEqual(calls.length, 2, "no other rpc (429 counters live in spike_reserve)");
  });
});

Deno.test("upstream failure: a counter that errors (migration not applied) still gives the 502 body and the release", async () => {
  await withFetch(
    (fn) => (fn === "spike_count_upstream" ? new Response('{"code":"PGRST202"}', { status: 404 }) : new Response("null", { status: 200 })),
    async (calls) => {
      const res = await upstreamFailure(creds, "device", "2026-10-27", true);
      assertEqual(res.status, 502, "status");
      assertEqual(JSON.stringify(await res.json()), JSON.stringify({ error: "upstream" }), "body");
      assertEqual(calls.filter((c) => c === "spike_release").length, 1, "release calls");
      assertEqual(calls.filter((c) => c === "spike_count_upstream").length, 1, "counter calls");
    },
  );
});

Deno.test("upstream failure: a counter that throws (network) is swallowed too", async () => {
  await withFetch(
    (fn) => {
      if (fn === "spike_count_upstream") throw new Error("network down");
      return new Response("null", { status: 200 });
    },
    async () => {
      const res = await upstreamFailure(creds, "device", "2026-10-27", false);
      assertEqual(res.status, 502, "status");
    },
  );
});
