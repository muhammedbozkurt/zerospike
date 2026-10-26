// Offline tests: the bearer model id is eu.-prefixed whatever SPIKE_MODEL_PREFIX says, and the config stays valid.
import { configIssue, modelId } from "./bedrock.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

Deno.test("global. configured: the bearer model id is still eu., sigv4 stays bare, no config issue", () => {
  const before = Deno.env.get("SPIKE_MODEL_PREFIX");
  try {
    Deno.env.set("SPIKE_MODEL_PREFIX", "global.");
    assertEqual(modelId("anthropic.claude-sonnet-5-5", "bearer"), "eu.anthropic.claude-sonnet-5-5", "bearer model id");
    assertEqual(modelId("anthropic.claude-sonnet-5-5", "sigv4"), "anthropic.claude-sonnet-5-5", "sigv4 model id");
    assertEqual(configIssue(), null, "config issue");
  } finally {
    if (before === undefined) Deno.env.delete("SPIKE_MODEL_PREFIX");
    else Deno.env.set("SPIKE_MODEL_PREFIX", before);
  }
});
