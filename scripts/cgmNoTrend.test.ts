/**
 * Regression guard: the CGM trend arrow is gone from every surface.
 * Run: npx tsx scripts/cgmNoTrend.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { buildLiveCgm, cgmLiveFields, cgmWidgetModel } from "../lib/services/liveDataCgm";
import { sceneCgmSnapshot } from "../components/scWidgets/sceneData";
import type { LiveData } from "../lib/services/liveData";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ARROWS = /[↑↗↘↓⇡⇣]|→/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) {
      if (name !== "locales" && name !== "node_modules") walk(rel, out);
    } else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const MIN = 60000;
const NOW = Date.parse("2026-10-27T10:00:00.000Z");
const rising = [100, 115, 130, 145].map((mgdl, i) => ({ at: NOW - (3 - i) * 5 * MIN, mgdl }));

// Home card: no arrow component, no arrow icon, no trend text
{
  const card = read("components/CgmHomeCard.tsx");
  assert.doesNotMatch(card, /TrendArrow/);
  assert.doesNotMatch(card, /cgmTrend|cgm\/trend|trendReadings|cgmCurve\.trend/);
  assert.doesNotMatch(card, /arrow-/);
  assert.doesNotMatch(card, /Ionicons/);
}

// Native payload: trend stays in the schema (Swift decodes it) but is always null
{
  const cgm = buildLiveCgm(rising, NOW, "mgdl")!;
  assert.equal(cgm.trend, null);
  assert.equal((cgmLiveFields("cgm", rising, NOW, "mgdl").cgm as { trend: unknown }).trend, null);
  const base = { unit: "mgdl", mode: "cgm", labels: {} } as unknown as LiveData;
  assert.equal(sceneCgmSnapshot(base, NOW, NOW).cgm?.trend, null);
  assert.ok(!existsSync(join(root, "lib/cgm/trend.ts")), "lib/cgm/trend.ts must stay deleted");
}

// Android widget text: no glyph in the model, none drawn by the builders
{
  const cgm = buildLiveCgm(rising, NOW, "mgdl")!;
  const m = cgmWidgetModel({ mode: "cgm", cgm }, NOW)!;
  assert.equal("glyph" in m, false);
  for (const text of [m.value, m.ageText, m.label]) assert.doesNotMatch(text, ARROWS);
  const android = read("lib/services/androidWidget.ts");
  assert.doesNotMatch(android, /\.glyph/);
  assert.doesNotMatch(stripComments(android), ARROWS);
}

// lib, components, app: no arrow characters in CGM code, no arrow icon in CGM files
{
  const files = [...walk("lib"), ...walk("components"), ...walk("app")];
  assert.ok(files.length > 100);
  for (const f of files) {
    const text = read(f);
    const code = stripComments(text);
    if (/cgm/i.test(f) || /cgm/i.test(text)) {
      assert.doesNotMatch(code, ARROWS, `${f}: arrow character in CGM code`);
    }
    if (/cgm/i.test(f)) {
      assert.doesNotMatch(code, /arrow-(forward|up|down|back)|trending-(up|down)|TrendArrow/, `${f}: arrow icon in CGM file`);
    }
  }
}

// Locales: no trend wording left under cgmCurve
for (const l of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const mod = require(`../lib/i18n/locales/${l}`);
  const dict = mod.default ?? mod;
  assert.equal(dict.cgmCurve.trend, undefined, `${l}: cgmCurve.trend must be gone`);
}

console.log("cgmNoTrend: ok");
