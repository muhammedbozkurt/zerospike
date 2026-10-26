// Offline eval for Spike. Runs eval-cases.json against SPIKE_MODEL and one
// alternative model straight on Bedrock (no HTTP layer, no database), through
// the same prompt, request params, meta parser and output filter as the
// function, and writes a markdown report. Every run is billed: see README.md.
// The client comes from bedrock.ts, so it takes the function's credential path:
// AWS_BEARER_TOKEN_BEDROCK when set, else AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
// altModel is a logical name like SPIKE_MODEL; the inference profile prefix is added
// by buildParams on the bearer path.
//
//   deno run --allow-env --allow-net --allow-read --allow-write \
//     supabase/functions/ai-ask-spike/eval.ts [altModel] [--out report.md]
import { bedrockClient, buildParams, spikeModel, usageOf, type BedrockClient, type ChatMessage, type TokenUsage } from "./bedrock.ts";
import { SYSTEM_PROMPT, dynamicSystem, normalizeLocale, parseMeta, sanitizeContext } from "./prompt.ts";
import { finalizeReply } from "./filter.ts";

const DEFAULT_ALT_MODEL = "anthropic.claude-opus-5-5";

interface EvalCase {
  id: string;
  kind: "normal" | "adversarial";
  category: string;
  locale: string;
  context: unknown;
  messages: ChatMessage[];
  expect: string;
}

// USD per million tokens at Anthropic's list prices. Bedrock bills its own
// rates, so every cost in the report is an estimate. Longer ids first:
// "claude-sonnet-5" is a prefix of "claude-sonnet-5-5".
const PRICES = [
  { match: "claude-sonnet-5-5", input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { match: "claude-opus-5-5", input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  { match: "claude-sonnet-5", input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { match: "claude-opus-5", input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { match: "claude-haiku-4-5", input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
];

function costUsd(model: string, u: TokenUsage): number | null {
  const p = PRICES.find((x) => model.includes(x.match));
  if (!p) return null;
  const uncached = u.input - u.cacheRead - u.cacheWrite;
  return (uncached * p.input + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}

interface Row {
  c: EvalCase;
  model: string;
  /** What the model wrote, before the filter, so false positives are visible. */
  modelReply: string;
  rule: string | null;
  stop: string | null;
  actions: string[];
  sources: string[];
  usage: TokenUsage;
  usd: number | null;
  ms: number;
  error?: string;
}

async function runCase(client: BedrockClient, model: string, c: EvalCase): Promise<Row> {
  const locale = normalizeLocale(c.locale);
  const packet = c.context == null ? null : sanitizeContext(c.context);
  const params = buildParams(model, SYSTEM_PROMPT, dynamicSystem(locale, packet), c.messages);
  const started = Date.now();
  try {
    const message = await client.messages.create(params);
    const ms = Date.now() - started;
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const outcome = finalizeReply(text, message.stop_reason, locale);
    const usage = usageOf(message.usage);
    return {
      c,
      model,
      modelReply: parseMeta(text, locale).reply,
      rule: outcome.rule,
      stop: message.stop_reason,
      actions: outcome.actions,
      sources: outcome.sources.map((s) => s.id),
      usage,
      usd: costUsd(model, usage),
      ms,
    };
  } catch (err) {
    return {
      c,
      model,
      modelReply: "",
      rule: null,
      stop: null,
      actions: [],
      sources: [],
      usage: usageOf(undefined),
      usd: null,
      ms: Date.now() - started,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const usd = (n: number | null): string => (n === null ? "?" : `$${n.toFixed(5)}`);

function report(models: string[], rows: Row[]): string {
  const lines: string[] = [
    `# Spike eval ${new Date().toISOString()}`,
    "",
    "Maliyet tahminidir: Anthropic liste fiyatı (USD/MTok); Bedrock faturası farklı olabilir. İlk çağrı sistem promptunu önbelleğe yazar, sonraki çağrılar 5 dakika içinde önbellekten okur.",
    "",
    "## Özet",
    "",
    "| model | çağrı | hata | filtre | refusal | ort. ms | girdi | çıktı | önbellek okuma | tahmini $ | 1000 mesaj $ |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const model of models) {
    const mine = rows.filter((r) => r.model === model);
    const ok = mine.filter((r) => !r.error);
    const sum = (f: (r: Row) => number) => ok.reduce((acc, r) => acc + f(r), 0);
    const total = ok.every((r) => r.usd !== null) ? sum((r) => r.usd ?? 0) : null;
    lines.push(
      `| ${model} | ${mine.length} | ${mine.length - ok.length} | ${ok.filter((r) => r.rule && r.rule !== "refusal").length} | ${ok.filter((r) => r.rule === "refusal").length} | ${ok.length ? Math.round(sum((r) => r.ms) / ok.length) : 0} | ${sum((r) => r.usage.input)} | ${sum((r) => r.usage.output)} | ${sum((r) => r.usage.cacheRead)} | ${usd(total)} | ${total === null || !ok.length ? "?" : `$${((total / ok.length) * 1000).toFixed(2)}`} |`,
    );
  }
  for (const model of models) {
    lines.push(
      "",
      `## ${model}`,
      "",
      "| id | dil | tür | bağlam | filtre | stop | actions | sources | girdi/çıktı | $ | ms | beklenen | model yanıtı |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const r of rows.filter((x) => x.model === model)) {
      lines.push(
        `| ${r.c.id} | ${r.c.locale} | ${r.c.kind}/${r.c.category} | ${r.c.context == null ? "-" : "var"} | ${r.error ? "HATA" : r.rule ?? "-"} | ${r.stop ?? "-"} | ${r.actions.join(", ") || "-"} | ${r.sources.join(", ") || "-"} | ${r.usage.input}/${r.usage.output} | ${usd(r.usd)} | ${r.ms} | ${cell(r.c.expect)} | ${cell(r.error ?? r.modelReply)} |`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function parseArgs(args: string[]): { alt: string; out: string } {
  let alt = DEFAULT_ALT_MODEL;
  let out = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") out = args[++i] ?? "";
    else if (a.startsWith("--out=")) out = a.slice("--out=".length);
    else if (!a.startsWith("--")) alt = a;
  }
  // .tmp* is gitignored in this repo.
  if (!out) out = `.tmp/spike-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  return { alt, out };
}

async function main(): Promise<void> {
  const { alt, out } = parseArgs(Deno.args);
  const client = bedrockClient();
  if (!client) {
    console.error("AWS_BEARER_TOKEN_BEDROCK (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) must be set, and SPIKE_MODEL and AWS_REGION, when set, must be on the allowlists in bedrock.ts (the log above says which one is not).");
    Deno.exit(1);
  }
  const cases = JSON.parse(await Deno.readTextFile(new URL("./eval-cases.json", import.meta.url))) as EvalCase[];
  const models = [spikeModel(), alt];
  const rows: Row[] = [];
  for (const model of models) {
    for (const c of cases) {
      const row = await runCase(client, model, c);
      console.log(`${model} ${c.id} ${row.error ? `ERROR ${row.error}` : row.rule ?? "ok"} ${row.ms}ms`);
      rows.push(row);
    }
  }
  const slash = out.lastIndexOf("/");
  if (slash > 0) await Deno.mkdir(out.slice(0, slash), { recursive: true });
  await Deno.writeTextFile(out, report(models, rows));
  console.log(`report: ${out}`);
}

if (import.meta.main) await main();
