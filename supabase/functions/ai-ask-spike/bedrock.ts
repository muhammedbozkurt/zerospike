// Claude on Amazon Bedrock through the Mantle endpoint (Messages API shape):
// https://bedrock-mantle.{region}.api.aws/anthropic, SigV4-signed by the SDK.
// Inline npm: specifiers on purpose: deploy must not depend on deno.json being picked up.
// The Anthropic SDK is a dependency of bedrock-sdk with an open range (">=0.115.1 <1"), so
// without a pin every deploy would pick up whatever version is newest that day. Importing
// it here at an exact version makes Deno resolve bedrock-sdk's copy to the same one (an
// entry in deno.json's import map alone does not do that); deno.lock then pins the rest of
// the tree. 0.131.0 satisfies that range and its d.ts has everything buildParams sends
// (thinking "between_tools", output_config.effort) and stop_reason "max_tokens" / "refusal".
// deno-lint-ignore no-import-prefix
import { APIError } from "npm:@anthropic-ai/sdk@0.131.0";
// deno-lint-ignore no-import-prefix
import { AnthropicBedrockMantle } from "npm:@anthropic-ai/bedrock-sdk@0.34.2";

export type BedrockClient = AnthropicBedrockMantle;

export const DEFAULT_MODEL = "anthropic.claude-sonnet-5-5";
export const DEFAULT_REGION = "eu-central-1";
/** A reply is two or three sentences (about 80 words) plus the meta line. */
export const MAX_TOKENS = 600;
/** Claude Opus 5.5 always thinks (it cannot be turned off) and thinking tokens count against
 *  max_tokens, so at 600 a reply could be cut off before it says anything. */
export const OPUS_MAX_TOKENS = 1200;

/** SPIKE_MODEL and AWS_REGION are deploy secrets; a typo or a leaked value must not be able to
 *  point the function at an unknown model (cost) or a region outside the EU (data residency). */
export const ALLOWED_MODELS: readonly string[] = [
  "anthropic.claude-sonnet-5-5",
  "anthropic.claude-opus-5-5",
  "anthropic.claude-haiku-4-5",
];
export const ALLOWED_REGIONS: readonly string[] = ["eu-central-1", "eu-west-1", "eu-west-3", "eu-north-1"];

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const env = (name: string): string | undefined => Deno.env.get(name)?.trim() || undefined;

export function spikeModel(): string {
  return env("SPIKE_MODEL") ?? DEFAULT_MODEL;
}

export function spikeRegion(): string {
  return env("AWS_REGION") ?? DEFAULT_REGION;
}

/** What is wrong with the model or region configuration, or null when both are allowed. */
export function configIssue(): string | null {
  if (!ALLOWED_MODELS.includes(spikeModel())) return `SPIKE_MODEL is not one of ${ALLOWED_MODELS.join(", ")}`;
  if (!ALLOWED_REGIONS.includes(spikeRegion())) return `AWS_REGION is not one of ${ALLOWED_REGIONS.join(", ")}`;
  return null;
}

let client: BedrockClient | null = null;

/** Null until both AWS keys are set and the model and region are allowed (the reason is
 *  logged). The keys are passed explicitly so the SDK never falls back to the Node-oriented
 *  AWS credential provider chain. */
export function bedrockClient(): BedrockClient | null {
  if (client) return client;
  const issue = configIssue();
  if (issue) {
    console.error("spike config:", issue);
    return null;
  }
  const awsAccessKey = env("AWS_ACCESS_KEY_ID");
  const awsSecretAccessKey = env("AWS_SECRET_ACCESS_KEY");
  if (!awsAccessKey || !awsSecretAccessKey) return null;
  client = new AnthropicBedrockMantle({
    awsRegion: spikeRegion(),
    awsAccessKey,
    awsSecretAccessKey,
    awsSessionToken: env("AWS_SESSION_TOKEN") ?? null,
    timeout: 30_000,
    maxRetries: 1,
  });
  return client;
}

/**
 * The one request shape, shared by the function and eval.ts.
 * - Claude Sonnet 5.5: `thinking: {type: "between_tools"}` is its only
 *   thinking-off setting (`disabled` is a 400) and is valid at effort high or
 *   below; effort low keeps chat replies short and fast.
 * - Claude Opus 5.5: thinking cannot be turned off at all, so `thinking` is
 *   omitted (adaptive) and only effort is lowered; it gets a larger max_tokens.
 * - Claude Haiku 4.5 rejects `effort`, so it gets neither.
 * No temperature (non-default sampling is rejected on the newest models) and
 * no assistant prefill (rejected too); the reply format comes from the prompt.
 */
export function buildParams(model: string, system: string, dynamic: string, messages: ChatMessage[]) {
  return {
    model,
    max_tokens: model.includes("opus") ? OPUS_MAX_TOKENS : MAX_TOKENS,
    system: [
      { type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: dynamic },
    ],
    messages,
    ...(model.includes("claude-sonnet-5-5") ? { thinking: { type: "between_tools" as const } } : {}),
    ...(model.includes("claude-haiku") ? {} : { output_config: { effort: "low" as const } }),
  };
}

export interface TokenUsage {
  /** Every prompt token, cached or not. The API's input_tokens counts only
   *  the uncached part, which would hide most of a cached prompt. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface UsageFields {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageOf(u: UsageFields | undefined): TokenUsage {
  if (!u) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return { input: u.input_tokens + cacheRead + cacheWrite, output: u.output_tokens, cacheRead, cacheWrite };
}

/** Logs only the upstream status and error class: error bodies can echo
 *  request content, which may include the user's logbook summary. */
export function logUpstream(err: unknown): void {
  const status = err instanceof APIError ? err.status : (err as { status?: unknown } | null)?.status;
  console.error("spike upstream error", typeof status === "number" ? status : "-", err instanceof Error ? err.name : typeof err);
}
