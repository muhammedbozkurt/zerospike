/**
 * lib/services/liveDataCgm.ts harness: CGM payload shape, manual stays untouched,
 * 20 minute staleness, trend, unit, and the Android/Swift/JS contract pins.
 * Run: npx -y tsx scripts/liveDataCgm.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CGM_STALE_MIN,
  buildLiveCgm,
  cgmAgeText,
  cgmLiveFields,
  cgmReadingText,
  cgmTrendGlyph,
  cgmWidgetModel,
  isCgmStale,
  type LiveCgm,
} from "../lib/services/liveDataCgm";
import { sceneCgmSnapshot, sceneSnapshot } from "../components/scWidgets/sceneData";
import type { LiveData } from "../lib/services/liveData";
import { formatTime } from "../lib/format";

const MIN = 60000;
const NOW = Date.parse("2026-10-27T10:00:00.000Z");

function readings(values: number[], newestAgeMin: number) {
  return values.map((mgdl, i) => ({
    at: NOW - (newestAgeMin + (values.length - 1 - i) * 5) * MIN,
    mgdl,
  }));
}

// Manual mod: cgm alani YOK, yalniz mode
{
  const f = cgmLiveFields("manual", readings([100, 110, 120], 2), NOW, "mgdl");
  assert.deepEqual(f, { mode: "manual" });
  assert.equal("cgm" in f, false);
  assert.equal("cgm" in JSON.parse(JSON.stringify(f)), false);
}

// CGM mod, okuma yok: mode var, cgm yok
{
  const f = cgmLiveFields("cgm", [], NOW, "mgdl");
  assert.deepEqual(f, { mode: "cgm" });
}

// CGM mod: yuk sekli
{
  const f = cgmLiveFields("cgm", readings([100, 110, 120, 130], 4), NOW, "mgdl");
  assert.equal(f.mode, "cgm");
  const c = f.cgm as LiveCgm;
  assert.equal(c.mgdl, 130);
  assert.equal(c.at, NOW - 4 * MIN);
  assert.equal(c.ageMin, 4);
  assert.equal(c.trend, "up");
  assert.equal(c.display, "130");
  assert.deepEqual(Object.keys(c).sort(), ["ageMin", "at", "display", "mgdl", "trend"]);
}

// nightscout modu da sensor modudur
assert.equal(cgmLiveFields("nightscout", readings([100, 100, 100], 1), NOW, "mgdl").mode, "nightscout");
assert.ok(cgmLiveFields("nightscout", readings([100, 100, 100], 1), NOW, "mgdl").cgm);

// Trend adimlari
const trendOf = (vals: number[]) => buildLiveCgm(readings(vals, 1), NOW, "mgdl")?.trend;
assert.equal(trendOf([100, 100, 100, 100]), "flat");
assert.equal(trendOf([100, 105, 110, 115]), "up45");
assert.equal(trendOf([100, 110, 120, 130]), "up");
assert.equal(trendOf([100, 115, 130, 145]), "up2");
assert.equal(trendOf([130, 125, 120, 115]), "down45");
assert.equal(trendOf([130, 120, 110, 100]), "down");
assert.equal(trendOf([145, 130, 115, 100]), "down2");
// Cok az okuma: trend yok ama deger var
{
  const c = buildLiveCgm(readings([140, 142], 2), NOW, "mgdl");
  assert.equal(c?.trend, null);
  assert.equal(c?.mgdl, 142);
}

// 20 dakika esigi: tam 20 taze, 21 eski; eski degerde trend yok
assert.equal(CGM_STALE_MIN, 20);
assert.equal(isCgmStale(20), false);
assert.equal(isCgmStale(21), true);
assert.equal(buildLiveCgm(readings([100, 110, 120, 130], 20), NOW, "mgdl")?.trend, "up");
{
  const c = buildLiveCgm(readings([100, 110, 120, 130], 21), NOW, "mgdl");
  assert.equal(c?.ageMin, 21);
  assert.equal(c?.trend, null);
  assert.equal(c?.mgdl, 130);
}

// Birim: mmol/L formatlayici
{
  const c = buildLiveCgm(readings([100, 100, 100, 180], 3), NOW, "mmol");
  assert.equal(c?.mgdl, 180);
  assert.equal(c?.display, (180 / 18.0182).toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
}

// Yas: negatif olmaz (saat kaymasi), sirasiz giris
{
  const c = buildLiveCgm([{ at: NOW + 5 * MIN, mgdl: 90 }], NOW, "mgdl");
  assert.equal(c?.ageMin, 0);
  const shuffled = readings([100, 110, 120, 130], 2).reverse();
  assert.equal(buildLiveCgm(shuffled, NOW, "mgdl")?.mgdl, 130);
}

// Yas metni: native ile ayni sablon (agoTemplate + hourShort/minuteShort)
const labels = { hourShort: "hr", minuteShort: "min", agoTemplate: "{{t}} ago" };
assert.equal(cgmAgeText(0, labels), "0 min ago");
assert.equal(cgmAgeText(4, labels), "4 min ago");
assert.equal(cgmAgeText(60, labels), "1 hr ago");
assert.equal(cgmAgeText(65, labels), "1 hr 5 min ago");
assert.equal(cgmAgeText(4, labels, true), "4 min");
assert.equal(cgmAgeText(4, undefined), "4 min");

// Ok simgeleri
assert.equal(cgmTrendGlyph("up2"), "↑↑");
assert.equal(cgmTrendGlyph("up"), "↑");
assert.equal(cgmTrendGlyph("up45"), "↗");
assert.equal(cgmTrendGlyph("flat"), "→");
assert.equal(cgmTrendGlyph("down45"), "↘");
assert.equal(cgmTrendGlyph("down"), "↓");
assert.equal(cgmTrendGlyph("down2"), "↓↓");
assert.equal(cgmTrendGlyph(null), "");

// Android model: elle modda null, CGM modunda cgm alanlarindan
{
  assert.equal(cgmWidgetModel(null, NOW), null);
  assert.equal(cgmWidgetModel({ mode: "manual" }, NOW), null);
  assert.equal(cgmWidgetModel({ mode: "cgm" }, NOW), null);
  const cgm = buildLiveCgm(readings([100, 110, 120, 130], 4), NOW, "mgdl")!;
  const m = cgmWidgetModel({ mode: "cgm", cgm, labels: { cgm: "CGM", ...labels } }, NOW)!;
  assert.equal(m.label, "CGM");
  assert.equal(m.value, "130");
  assert.equal(m.glyph, "↑");
  assert.equal(m.stale, false);
  assert.equal(m.ageText, "4 min ago");
  // Android bitmap render aninda yaslanir: payload ageMin 4, 30 dk sonra 34
  const later = cgmWidgetModel({ mode: "cgm", cgm, labels: { cgm: "CGM", ...labels } }, NOW + 30 * MIN)!;
  assert.equal(later.stale, true);
  assert.equal(later.glyph, "");
  assert.equal(later.ageText, "34 min ago");
  // Etiket yoksa jenerik "CGM"
  assert.equal(cgmWidgetModel({ mode: "cgm", cgm }, NOW)!.label, "CGM");
}

// Ekran goruntusu sahnesi: magaza karesi elle modda kalir, CGM varyanti ?cgm=1
{
  const base = { unit: "mgdl", mode: "cgm", cgm: { mgdl: 90, at: 1, trend: null, ageMin: 1, display: "90" }, labels: {} } as unknown as LiveData;
  const manual = sceneSnapshot(base, NOW);
  assert.equal(manual.mode, "manual");
  assert.equal("cgm" in manual, false);
  const demo = sceneCgmSnapshot(base, NOW, NOW);
  assert.equal(demo.mode, "cgm");
  assert.equal(demo.cgm?.mgdl, 112);
  assert.equal(demo.cgm?.trend, "flat");
  assert.equal(cgmWidgetModel(demo as never, NOW)?.ageText, "4 min");
}

// Sozlesme sabitleri: kaynak dosyalar
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const liveData = read("lib/services/liveData.ts");
assert.match(liveData, /\.\.\.cgm/, "computeLiveData cgm alanlarini yuke yaymali");
assert.match(liveData, /subscribeCgmChanges/, "CGM degisince canli veri yeniden yayinlanmali");
assert.match(liveData, /labels:[\s\S]*cgm: i18n\.t\("cgmSource\.cgm"\)/);
const android = read("lib/services/androidWidget.ts");
assert.match(android, /cgmWidgetModel/);
for (const f of [
  "targets/widget/LiveData.swift",
  "targets/watch/LiveData.swift",
  "targets/watch-widget/LiveData.swift",
]) {
  const s = read(f);
  assert.match(s, /var mode: String\?/, `${f}: mode opsiyonel`);
  assert.match(s, /var cgm: Cgm\?/, `${f}: cgm opsiyonel`);
  assert.match(s, /let cgm: String\?/, `${f}: labels.cgm opsiyonel`);
  assert.match(s, /staleAfterMinutes = 20/, `${f}: 20 dk esigi`);
  for (const [state, glyph] of [["up2", "↑↑"], ["up", "↑"], ["up45", "↗"], ["flat", "→"], ["down45", "↘"], ["down", "↓"], ["down2", "↓↓"]]) {
    assert.match(s, new RegExp(`case "${state}": return "${glyph}"`), `${f}: ${state} -> ${glyph}`);
  }
  assert.match(s, /default: return ""/, `${f}: bilinmeyen durum ok cizmez`);
  for (const field of ["mgdl", "at", "trend", "ageMin", "display"]) {
    assert.match(s, new RegExp(`struct Cgm: Codable \\{[\\s\\S]*let ${field}: `), `${f}: Cgm.${field}`);
  }
}
assert.match(liveData, /cgmReadingText\(data\.cgm/, "Live Activity pill CGM degerini ve oku gostermeli");

// Live Activity metni: deger + okuma saati, ok YOK (icerik yalniz esitlemede yazilir)
{
  const cgm = buildLiveCgm(readings([100, 110, 120, 130], 4), NOW, "mgdl")!;
  const clock = formatTime(new Date(cgm.at).toISOString());
  assert.equal(cgmReadingText(cgm, "mg/dL"), `130 mg/dL · ${clock}`, "birim degerden hemen sonra, saat sonda");
  assert.equal(cgmReadingText({ ...cgm, trend: "up2" }, "mg/dL"), `130 mg/dL · ${clock}`);
  assert.ok(!/[↑↗→↘↓]/.test(cgmReadingText(cgm, "mg/dL")), "pill metninde ok olmamali");
  assert.doesNotMatch(cgmReadingText(cgm, "mg/dL"), /· \d{1,2}[:.]\d{2} mg\/dL/, "birim saate yapismamali");
  assert.match(clock, /\d{1,2}[:.]\d{2}/);
  assert.doesNotMatch(liveData, /cgmReadingText\(data\.cgm, (now|Date|new Date)/, "pill metni saate degil okuma saatine bakar");
  assert.match(liveData, /unitLabel: data\.cgm \? "" : /, "CGM pill'inde native'e giden birim bos (birim metnin icinde)");
}

console.log("liveDataCgm.test.ts OK");
