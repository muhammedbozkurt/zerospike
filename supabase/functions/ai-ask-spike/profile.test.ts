// Offline tests for the profile prefix: only "eu." is ever used, whatever the secret says.
//   deno test --allow-env --config supabase/functions/ai-ask-spike/deno.json supabase/functions/ai-ask-spike/profile.test.ts
import { spikePrefix } from "./profile.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function withPrefix(value: string | undefined, run: () => void): void {
  const before = Deno.env.get("SPIKE_MODEL_PREFIX");
  try {
    if (value === undefined) Deno.env.delete("SPIKE_MODEL_PREFIX");
    else Deno.env.set("SPIKE_MODEL_PREFIX", value);
    run();
  } finally {
    if (before === undefined) Deno.env.delete("SPIKE_MODEL_PREFIX");
    else Deno.env.set("SPIKE_MODEL_PREFIX", before);
  }
}

Deno.test("prefix: global., us., empty and unset all fall back to eu.", () => {
  for (const value of ["global.", "us.", "apac.", "", "   ", undefined]) {
    withPrefix(value, () => assertEqual(spikePrefix(), "eu.", `prefix for ${JSON.stringify(value)}`));
  }
});

Deno.test("prefix: eu. stays eu.", () => {
  withPrefix("eu.", () => assertEqual(spikePrefix(), "eu.", "prefix"));
});
