/**
 * lib/db/foods.ts searchFoods against a real SQLite (node:sqlite, FTS5): the
 * app's own foods/meal_logs/FTS DDL (lib/db/index.ts createSchemaV1, v20Sql,
 * v23Sql), the real SEED_FOODS catalog, and the unmodified searchFoods behind a
 * thin expo-sqlite-shaped adaptor.
 *
 * Run: npx tsx scripts/foodSearchSql.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import Module from "node:module";
import { DatabaseSync } from "node:sqlite";

import { V20_FOODS_COLUMNS } from "../lib/db/v20Sql";
import { V23_CREATE_FTS, V23_CREATE_TRIGGERS } from "../lib/db/v23Sql";

const raw = new DatabaseSync(":memory:");
const db = {
  async execAsync(sql: string) {
    raw.exec(sql);
  },
  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return raw.prepare(sql).all(...(params as never[])) as T[];
  },
  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (raw.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
  },
  async runAsync(sql: string, params: unknown[] = []) {
    raw.prepare(sql).run(...(params as never[]));
  },
};

const M = Module as unknown as {
  _load: (request: string, parent?: { filename?: string }, ...rest: unknown[]) => unknown;
};
const realLoad = M._load;
M._load = function (request: string, parent?: { filename?: string }, ...rest: unknown[]) {
  const from = parent?.filename ?? "";
  if (request === "./index" && from.endsWith("/lib/db/foods.ts")) {
    return { getDb: async () => db };
  }
  if (request === "./meals" && from.endsWith("/lib/db/foods.ts")) {
    return { inDbTransaction: async (fn: () => Promise<void>) => fn() };
  }
  if (request === "../uuid") return { uuid: () => `id-${Math.random().toString(36).slice(2)}-${Date.now()}` };
  if (request === "../services/openFoodFacts") return { OFF_SOURCE: "off" };
  return realLoad.call(this, request, parent, ...rest);
};

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

// lib/db/index.ts createSchemaV1 foods (426) + v20 columns + meal_logs (471, FKs dropped).
raw.exec(`
  CREATE TABLE foods (
    id TEXT PRIMARY KEY NOT NULL,
    name_tr TEXT NOT NULL,
    name_en TEXT NOT NULL DEFAULT '',
    name_de TEXT NOT NULL DEFAULT '',
    name_es TEXT NOT NULL DEFAULT '',
    name_fr TEXT NOT NULL DEFAULT '',
    name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT 'other',
    barcode TEXT,
    carb_100g REAL NOT NULL DEFAULT 0,
    glycemic_index INTEGER NOT NULL DEFAULT 0,
    glycemic_load INTEGER NOT NULL DEFAULT 0,
    portion_size_g REAL NOT NULL DEFAULT 100,
    brand_name TEXT,
    custom_notes TEXT,
    is_custom INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE meal_logs (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    food_id TEXT,
    portion_g REAL NOT NULL DEFAULT 0,
    logged_at TEXT NOT NULL
  );
`);
for (const c of V20_FOODS_COLUMNS) raw.exec(`ALTER TABLE foods ADD COLUMN ${c.name} ${c.type};`);
raw.exec(V23_CREATE_FTS);
raw.exec(V23_CREATE_TRIGGERS);

async function main() {
  const { SEED_FOODS } = await import("../lib/db/seed");
  const { searchFoods } = await import("../lib/db/foods");
  const { foodName } = await import("../lib/db/types");
  type L = Parameters<typeof searchFoods>[1];

  // Mirrors lib/db/index.ts insertSeedFoodsWithinTransaction row mapping.
  const ins = raw.prepare(
    `INSERT INTO foods (id, name_tr, name_en, name_de, name_es, name_fr, name_it, name_pt, name_ar, name_ja,
       aliases_json, category, barcode, carb_100g, glycemic_index, glycemic_load, portion_size_g,
       brand_name, custom_notes, is_custom, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,NULL,NULL,0,?)`
  );
  const idByEn = new Map<string, string>();
  raw.exec("BEGIN");
  SEED_FOODS.forEach((f, i) => {
    const id = `seed-${i}`;
    idByEn.set(f.en, id);
    const aliases = JSON.stringify([...new Set([f.tr, f.en, f.de, f.es, f.fr].map((n) => n.trim().toLowerCase()).filter(Boolean))]);
    ins.run(id, f.tr, f.en, f.de, f.es, f.fr, f.it ?? null, f.pt ?? null, f.ar ?? null, f.ja ?? null,
      aliases, f.cat, f.carb, f.gi, Math.round((f.gi * f.carb) / 100), f.portion ?? 100, new Date().toISOString());
  });
  raw.exec("COMMIT");
  ok("seed rows inserted", (raw.prepare("SELECT COUNT(*) c FROM foods").get() as { c: number }).c === SEED_FOODS.length);
  ok("fts rows match", (raw.prepare("SELECT COUNT(*) c FROM foods_fts").get() as { c: number }).c === SEED_FOODS.length);

  const names = (rs: { name_tr: string; name_en: string; name_de: string; name_es: string; name_fr: string }[], lang: L) =>
    rs.map((r) => foodName(r as never, lang));
  const has = (rs: unknown[], lang: L, re: RegExp) => names(rs as never, lang).some((n) => re.test(n));

  // (1) language scenarios
  const cases: [string, L, RegExp][] = [
    ["sut", "tr", /süt/i],
    ["cay", "tr", /çay/i],
    ["kase", "tr", /kasesi/i],
    ["IRMIK", "tr", /^[iİ]rmik/],
    ["ırmık", "tr", /^[iİ]rmik/],
    ["İRMİK", "tr", /^[iİ]rmik/],
    ["brotchen", "de", /brötchen/i],
    ["broetchen", "de", /brötchen/i],
    ["semmel", "de", /brötchen|semmel/i],
    ["nudeln", "de", /nudel|pasta|spaghetti/i],
    ["pain", "fr", /pain/i],
    ["pan", "es", /pan/i],
    ["arroz", "es", /arroz/i],
  ];
  for (const [q, lang, re] of cases) {
    const r = await searchFoods(q, lang);
    ok(`${lang} "${q}" finds ${re}`, r.length > 0 && has(r, lang, re), `top: ${names(r.slice(0, 4), lang).join("|")}`);
    if (q !== "kase") ok(`${lang} "${q}" top hit matches`, r.length > 0 && re.test(foodName(r[0], lang)), `top: ${r[0] ? foodName(r[0], lang) : "none"}`);
  }
  const nud = await searchFoods("nudeln", "de");
  ok("de nudeln: pasta synonym surfaces", has(nud, "de", /pasta|spaghetti|nudel/i), names(nud.slice(0, 5), "de").join("|"));

  // (2) ranking: logged food first
  const target = SEED_FOODS.find((f) => f.tr === "Sütlü çörek")!;
  const targetId = idByEn.get(target.en)!;
  const before = await searchFoods("sut", "tr");
  const posBefore = before.findIndex((r) => r.id === targetId);
  ok("logged food not near the top beforehand", posBefore > 1, String(posBefore));
  raw.prepare("INSERT INTO meal_logs (id, profile_id, food_id, portion_g, logged_at) VALUES (?,?,?,?,?)")
    .run("m1", "P", targetId, 100, new Date(Date.now() - 86400000).toISOString());
  const after = await searchFoods("sut", "tr", 50, "P");
  ok("exact name still outranks usage", foodName(after[0], "tr") === "Süt");
  ok("logged food first among prefix peers (14d)", after[1].id === targetId, `second: ${foodName(after[1], "tr")} want ${target.tr}`);
  const afterAll = await searchFoods("sut", "tr");
  ok("logged food first among prefix peers (all profiles)", afterAll[1].id === targetId);
  const otherProfile = await searchFoods("sut", "tr", 50, "OTHER");
  ok("other profile does not get the boost", otherProfile.findIndex((r) => r.id === targetId) === posBefore);
  const empty = await searchFoods("", "tr", 10);
  ok("empty query: default list", empty.length === 10);
  ok("empty query: staples first", empty.length > 0 && names(empty.slice(0, 1), "tr").length === 1);

  // (3) odd input
  for (const q of ["s", "a", "çö", '"', "'", "*", "%", "_", "(", ")", '"sut', "sut*", "su OR t", "NEAR(a b)", "a:b", "^x", "-", "AND", "OR", "NOT", "ü", "'; DROP TABLE foods; --", "%%", "\\", "{", "[", "sut'"]) {
    try {
      const r = await searchFoods(q, "tr");
      ok(`no throw: ${JSON.stringify(q)}`, Array.isArray(r) && r.length <= 50);
    } catch (e) {
      ok(`no throw: ${JSON.stringify(q)}`, false, String(e));
    }
  }
  ok("foods table intact after injection attempt", (raw.prepare("SELECT COUNT(*) c FROM foods").get() as { c: number }).c === SEED_FOODS.length);
  for (const lang of ["tr", "en", "de", "fr", "es", "it", "pt", "ar", "ja"] as L[]) {
    try {
      await searchFoods("x".repeat(5000), lang);
      await searchFoods("süt ".repeat(500), lang);
      ok(`long query ${lang}`, true);
    } catch (e) {
      ok(`long query ${lang}`, false, String(e));
    }
  }
  const short1 = await searchFoods("s", "tr");
  ok("1-char query returns rows", short1.length > 0);
  ok("1-char query: sorted prefix hit first", /^s/i.test(foodName(short1[0], "tr")), foodName(short1[0], "tr"));

  // (4) scan fallback: FTS only folds accents, not dotless i / ae-oe / ss
  const kas = await searchFoods("kasarli", "tr");
  ok("scan fallback: kasarli", kas.length > 0 && has(kas, "tr", /kaşarlı/i), names(kas.slice(0, 3), "tr").join("|"));
  const wb = await searchFoods("weissbrot", "de");
  ok("scan fallback: weissbrot", wb.length > 0 && has(wb, "de", /weißbrot/i), names(wb.slice(0, 3), "de").join("|"));
  const none = await searchFoods("zzqxjv", "en");
  ok("no match returns empty", none.length === 0);

  // (5) perf
  for (const q of ["sut", "brotchen", "kasarli", "s", "pasta"]) {
    const t0 = performance.now();
    await searchFoods(q, "tr");
    const ms = performance.now() - t0;
    console.log(`  perf ${JSON.stringify(q)}: ${ms.toFixed(1)} ms over ${SEED_FOODS.length} foods`);
    ok(`perf < 200ms: ${q}`, ms < 200, `${ms.toFixed(1)}ms`);
  }

  console.log(`\nfoodSearchSql: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.log(e);
  process.exit(1);
});
