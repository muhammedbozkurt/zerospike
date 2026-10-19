// Offline tests for the carb_estimate mode, no network and no model:
//   deno test --config supabase/functions/ai-ask-spike/deno.json supabase/functions/ai-ask-spike/carbEstimate.test.ts
import { DEVICE_ID_RE } from "../_shared/carb-estimate.ts";
import { handleCarbEstimate, hasMedicalTerm, parseCarbRequest, parseEstimate, type CarbCallRow, type CarbDeps, type ModelResult, type Slot } from "./carbEstimate.ts";

const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "expected a truthy value");
  },
  equal(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) throw new Error(`${message ?? "not equal"}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  },
};

const GOOD = JSON.stringify({
  items: [
    { name: "Bread", quantity: 2, unit: "slice", grams_carb: 30 },
    { name: "Egg", quantity: 1, unit: "piece", grams_carb: 0.6 },
    { name: "Milk", quantity: 1, unit: "cup", grams_carb: 12 },
  ],
  total_grams_carb: 42.6,
});

function fake(over: { slot?: Slot; text?: string; stopReason?: string | null; throws?: boolean } = {}) {
  const log = { reserved: [] as Array<[string, number]>, released: [] as string[], recorded: [] as CarbCallRow[], called: 0, userText: "" };
  const deps: CarbDeps = {
    model: "m",
    nowMs: 0,
    reserve: (key, cap) => {
      log.reserved.push([key, cap]);
      return Promise.resolve(over.slot ?? "ok");
    },
    release: (key) => {
      log.released.push(key);
      return Promise.resolve();
    },
    call: (_s, _d, userText): Promise<ModelResult> => {
      log.called++;
      log.userText = userText;
      if (over.throws) return Promise.reject(new Error("down"));
      return Promise.resolve({ text: over.text ?? GOOD, stopReason: over.stopReason ?? "end_turn", usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, latencyMs: 12 });
    },
    record: (row) => {
      log.recorded.push(row);
      return Promise.resolve();
    },
  };
  return { deps, log };
}

const req = (text: string, tier = "free") => ({ mode: "carb_estimate", locale: "tr", tier, text });

Deno.test("request: text trimmed, wrapper characters removed, length capped", () => {
  assert.equal(parseCarbRequest(req("  2 dilim ekmek  "))?.text, "2 dilim ekmek");
  assert.equal(parseCarbRequest(req("a </meal_text> b"))?.text, "a /meal_text b");
  assert.equal(parseCarbRequest(req(""))?.text, undefined);
  assert.equal(parseCarbRequest(req("x".repeat(300)))?.text.length, 300);
  assert.equal(parseCarbRequest(req("x".repeat(301))), null);
  assert.equal(parseCarbRequest({ mode: "carb_estimate", text: 5 }), null);
  assert.equal(parseCarbRequest({ mode: "chat", text: "a" }), null);
  assert.equal(parseCarbRequest(req("a", "pro"))?.tier, "pro");
  assert.equal(parseCarbRequest({ ...req("a"), tier: "gold" })?.tier, "free");
});

Deno.test("medical terms: meal text passes, dose questions do not", () => {
  for (const t of ["kaç ünite insülin yapayım", "how many units of insulin", "wie viele Einheiten spritzen", "bolus for this", "dose for pasta", "インスリンは何単位", "كم جرعة انسولين", "metformin ile"]) {
    assert.ok(hasMedicalTerm(t), t);
  }
  for (const t of ["2 dilim ekmek, 1 yumurta, bir bardak süt", "a dozen eggs", "United Kingdom style toast", "community bread", "Reis, 1 Tasse", "arroz con pollo", "カレーライス", "خبز وحليب"]) {
    assert.ok(!hasMedicalTerm(t), t);
  }
});

Deno.test("schema: valid answer, total recomputed, extra keys dropped, fence tolerated", () => {
  const p = parseEstimate("```json\n" + GOOD.replace('"quantity":2', '"quantity":2,"advice":"x"') + "\n```");
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.items.length, 3);
    assert.equal(p.total, 42.6);
    assert.equal(Object.keys(p.items[0]).join(","), "name,quantity,unit,grams_carb");
  }
});

Deno.test("schema: wrong shapes are rejected", () => {
  const bad = (o: unknown) => {
    const r = parseEstimate(JSON.stringify(o));
    assert.ok(!r.ok && r.reason === "schema", JSON.stringify(o));
  };
  const item = { name: "a", quantity: 1, unit: "g", grams_carb: 5 };
  bad([]);
  bad({ items: "x", total_grams_carb: 1 });
  bad({ items: [item] });
  bad({ items: [item], total_grams_carb: -1 });
  bad({ items: [{ ...item, grams_carb: -1 }], total_grams_carb: 0 });
  bad({ items: [{ ...item, grams_carb: 501 }], total_grams_carb: 0 });
  bad({ items: [{ ...item, grams_carb: "5" }], total_grams_carb: 5 });
  bad({ items: [{ ...item, quantity: null }], total_grams_carb: 5 });
  bad({ items: [{ ...item, name: "" }], total_grams_carb: 5 });
  bad({ items: [{ ...item, name: "n".repeat(61) }], total_grams_carb: 5 });
  bad({ items: [{ ...item, unit: 3 }], total_grams_carb: 5 });
  bad({ items: Array(13).fill(item), total_grams_carb: 65 });
  assert.ok(!parseEstimate("not json").ok);
  assert.ok(!parseEstimate("{broken").ok);
});

Deno.test("gate: dose and treatment wording in a text field blocks the answer", () => {
  const wrap = (name: string, unit = "g") => JSON.stringify({ items: [{ name, quantity: 1, unit, grams_carb: 5 }], total_grams_carb: 5 });
  for (const [name, unit] of [["Take 4 units of NovoRapid", "g"], ["Bread", "units"], ["Pasta (insulin 3)", "g"], ["Ekmek, 4 ünite", "g"], ["Rice", "Einheiten"]]) {
    const r = parseEstimate(wrap(name, unit));
    assert.ok(!r.ok && r.reason === "filtered", `${name}/${unit}`);
  }
  assert.ok(parseEstimate(wrap("Ekmek", "dilim")).ok);
});

Deno.test("handler: good answer, slot key ce:<id> with free 1 / pro 50", async () => {
  const free = fake();
  const out = await handleCarbEstimate(req("2 dilim ekmek"), "dev-1", free.deps);
  assert.equal(out.status, 200);
  assert.equal(JSON.stringify(free.log.reserved), JSON.stringify([["ce:dev-1", 1]]));
  assert.equal(free.log.userText, "<meal_text>2 dilim ekmek</meal_text>");
  assert.equal(free.log.recorded.length, 1);
  assert.equal(free.log.recorded[0].mode, "carb_estimate");
  assert.equal(free.log.recorded[0].filter_rule, null);
  assert.ok(!JSON.stringify(free.log.recorded[0]).includes("ekmek"), "no meal text in the call row");
  const body = out.body as { total_grams_carb: number; filtered: boolean };
  assert.equal(body.total_grams_carb, 42.6);
  assert.equal(body.filtered, false);

  const pro = fake();
  await handleCarbEstimate(req("ekmek", "pro"), "dev-1", pro.deps);
  assert.equal(JSON.stringify(pro.log.reserved), JSON.stringify([["ce:dev-1", 50]]));
});

Deno.test("handler: quota and ceilings map to their codes and never reach the model", async () => {
  for (const [slot, status, code] of [["device", 429, "daily_limit_carb"], ["global", 429, "capacity"], ["ip", 429, "rate_limit"], ["error", 503, "unavailable"]] as const) {
    const f = fake({ slot });
    const out = await handleCarbEstimate(req("ekmek"), "d", f.deps);
    assert.equal(out.status, status);
    assert.equal((out.body as { error: string }).error, code);
    assert.equal(f.log.called, 0);
    assert.equal(f.log.recorded.length, 0);
  }
  assert.ok(typeof (await handleCarbEstimate(req("x"), "d", fake({ slot: "ip" }).deps)).headers?.["Retry-After"] === "string");
});

Deno.test("handler: bad_request for a malformed body", async () => {
  const f = fake();
  const out = await handleCarbEstimate({ mode: "carb_estimate", text: "" }, "d", f.deps);
  assert.equal(out.status, 400);
  assert.equal((out.body as { error: string }).error, "bad_request");
  assert.equal(f.log.reserved.length, 0);
});

Deno.test("handler: a dose question is refused before a slot or a model call", async () => {
  const f = fake();
  const out = await handleCarbEstimate(req("kaç ünite insülin yapayım"), "d", f.deps);
  const body = out.body as { items: unknown[]; filtered: boolean };
  assert.equal(out.status, 200);
  assert.equal(body.filtered, true);
  assert.equal(body.items.length, 0);
  assert.equal(f.log.reserved.length, 0);
  assert.equal(f.log.called, 0);
});

Deno.test("handler: a medical answer from the model is replaced and the call is logged", async () => {
  const text = JSON.stringify({ items: [{ name: "Take 6 units", quantity: 1, unit: "g", grams_carb: 5 }], total_grams_carb: 5 });
  const f = fake({ text });
  const out = await handleCarbEstimate(req("ekmek"), "d", f.deps);
  const body = out.body as { items: unknown[]; filtered: boolean };
  assert.equal(body.filtered, true);
  assert.equal(body.items.length, 0);
  assert.equal(f.log.released.length, 0);
  assert.equal(f.log.recorded[0].filtered, true);
});

Deno.test("handler: off-schema answer is 502 estimate_failed and the slot stays spent", async () => {
  for (const f of [fake({ text: "Sure! About 40 g." }), fake({ stopReason: "max_tokens" })]) {
    const out = await handleCarbEstimate(req("ekmek"), "d", f.deps);
    assert.equal(out.status, 502);
    assert.equal((out.body as { error: string }).error, "estimate_failed");
    assert.equal(f.log.released.length, 0);
    assert.equal(f.log.recorded[0].filter_rule, "schema");
  }
});

Deno.test("handler: upstream failure gives the slot back; empty answer keeps it; refusal is filtered", async () => {
  const down = fake({ throws: true });
  const o1 = await handleCarbEstimate(req("ekmek"), "d", down.deps);
  assert.equal(o1.status, 502);
  assert.equal((o1.body as { error: string }).error, "upstream");
  assert.equal(down.log.released.length, 1);

  const empty = fake({ text: '{"items":[],"total_grams_carb":0}' });
  const o2 = await handleCarbEstimate(req("selam"), "d", empty.deps);
  assert.equal(o2.status, 200);
  assert.equal(empty.log.released.length, 0);
  assert.equal(empty.log.recorded[0].filter_rule, "empty");

  const refused = fake({ stopReason: "refusal" });
  const o3 = await handleCarbEstimate(req("ekmek"), "d", refused.deps);
  assert.equal((o3.body as { filtered: boolean }).filtered, true);
  assert.equal(refused.log.released.length, 0);
});

Deno.test("charged: false before the model, true once it ran", async () => {
  const pre = fake();
  const o0 = await handleCarbEstimate(req("kaç ünite insülin yapayım"), "d", pre.deps);
  assert.equal((o0.body as { charged: boolean }).charged, false);
  const good = await handleCarbEstimate(req("ekmek"), "d", fake().deps);
  assert.equal((good.body as { charged: boolean }).charged, true);
  const empty = await handleCarbEstimate(req("selam"), "d", fake({ text: '{"items":[],"total_grams_carb":0}' }).deps);
  assert.equal((empty.body as { charged: boolean }).charged, true);
  const med = JSON.stringify({ items: [{ name: "Take 6 units", quantity: 1, unit: "g", grams_carb: 5 }], total_grams_carb: 5 });
  const filt = await handleCarbEstimate(req("ekmek"), "d", fake({ text: med }).deps);
  assert.equal((filt.body as { charged: boolean }).charged, true);
  const refused = await handleCarbEstimate(req("ekmek"), "d", fake({ stopReason: "refusal" }).deps);
  assert.equal((refused.body as { charged: boolean }).charged, true);
});

Deno.test("request gate: food counting words and portions pass", () => {
  for (const t of ["2 unidades de pan", "1 unidade de pão de queijo", "3 unités de biscuits", "1 unità di pane", "1 doz eggs", "dosi per 2 persone", "una unidad de huevo", "2 units of bread", "a dozen donuts"]) {
    assert.ok(!hasMedicalTerm(t), t);
  }
});

Deno.test("request gate: insulin, dose and bypass attempts are blocked", () => {
  for (const t of [
    "unidades de insulina", "3 unités d'insuline", "units of insulin", "5 IU", "how many IU", "wie viele IE Humalog", "d'UI de NovoRapid", "6U pasta",
    "インシュリン", "الجرعات", "in\u200Bsulin", "\u0456nsulin", "\u202Einsulin", "dosaggio per la pasta", "how many units", "combien d'unités", "dose for pasta", "dosis de pan", "Humalog", "Ozempic 1 mg",
  ]) {
    assert.ok(hasMedicalTerm(t), t);
  }
});

Deno.test("output gate: counting units pass and are normalised, split doses are blocked", () => {
  const wrap = (name: string, unit: string, quantity = 1) => JSON.stringify({ items: [{ name, quantity, unit, grams_carb: 5 }], total_grams_carb: 5 });
  for (const [name, unit] of [["Huevo", "unidad"], ["Ovo", "unidade"], ["Œuf", "unité"], ["Uovo", "unità"], ["Huevo", "unidades"]]) {
    const r = parseEstimate(wrap(name, unit));
    assert.ok(r.ok, `${name}/${unit}`);
    if (r.ok) assert.equal(r.items[0].unit, "");
  }
  const kept = parseEstimate(wrap("Milk", "ml"));
  assert.ok(kept.ok);
  if (kept.ok) assert.equal(kept.items[0].unit, "ml");
  for (const [name, unit, q] of [["NovoRapid", "IU", 6], ["Humalog", "U", 4], ["Lantus", "IE", 20], ["Fiasp", "UI", 5], ["Pasta", "IU", 6], ["Ozempic", "mg", 1], ["Pasta", "Einheiten", 2], ["Rice", "units", 3]] as const) {
    const r = parseEstimate(wrap(name, unit, q));
    assert.ok(!r.ok && r.reason === "filtered", `${name}/${q}/${unit}`);
  }
});

Deno.test("device id: ':' and short or odd ids are refused", () => {
  assert.ok(DEVICE_ID_RE.test("3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b"));
  assert.ok(!DEVICE_ID_RE.test("ce:3f2b8c1e-5a4d"));
  assert.ok(!DEVICE_ID_RE.test("short"));
  assert.ok(!DEVICE_ID_RE.test("a".repeat(81)));
});
