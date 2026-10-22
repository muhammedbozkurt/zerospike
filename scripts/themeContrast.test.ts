/** Kalici kontrast testi (Apple "Sufficient Contrast", WCAG 2.x): metin 4.5:1, UI/grafik 3:1.
 *  Calistir: npx tsx scripts/themeContrast.test.ts */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { contrast, contrastTable, extraContrastRows, type ContrastRow } from "../lib/theme/contrast";
import { highContrastEventFor, highContrastPalette } from "../lib/theme/highContrastPalette";
import { nativeSchemeOverride } from "../lib/theme/themePref";
import { DARK, HIGH_CONTRAST_PALETTES, LIGHT, switchColors, setActiveScheme, setHighContrast } from "../lib/theme/tokens";
import { WIDGET_DARK, WIDGET_LIGHT, type WidgetPalette } from "../lib/services/widgetColors";

const fmt = (r: ContrastRow) => `${r.scheme} ${r.name}: ${r.ratio.toFixed(2)} < ${r.min}`;
const below = (rows: ContrastRow[]) => rows.filter((r) => r.ratio < r.min).map(fmt);

function widgetRows(name: string, W: WidgetPalette): ContrastRow[] {
  const rows: ContrastRow[] = [];
  const add = (n: string, fg: string, bg: string, min: number) =>
    rows.push({ scheme: name, name: n, fg, bg, min, ratio: contrast(fg, bg, bg) });
  for (const bg of [W.bgFrom, W.bgTo, W.surface]) {
    add(`ink on ${bg}`, W.ink, bg, 4.5);
    add(`muted on ${bg}`, W.muted, bg, 4.5);
    add(`accent on ${bg}`, W.accent, bg, 4.5);
    add(`caution on ${bg}`, W.caution, bg, 4.5);
    for (const [k, v] of Object.entries(W.glucose)) add(`glucose.${k} on ${bg}`, v, bg, 4.5);
  }
  add("onAccentFill on accentFill", W.onAccentFill, W.accentFill, 4.5);
  for (const [k, t] of Object.entries(W.tile)) {
    add(`ink on tile.${k}`, W.ink, t.fill, 4.5);
    add(`muted on tile.${k}`, W.muted, t.fill, 4.5);
  }
  add("accent on tile.countdown", W.accent, W.tile.countdown.fill, 4.5);
  for (const [k, ink] of Object.entries(W.tileInk)) {
    const tile = W.tile[k === "glucose" ? "glucosePrimary" : (k as "meal")];
    add(`tileInk.${k} on tile`, ink, tile.fill, 4.5);
    if (k === "glucose") add("tileInk.glucose on tile.glucose", ink, W.tile.glucose.fill, 4.5);
    add(`tileInk.${k} on bg`, ink, W.bgTo, 4.5);
  }
  return rows;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

const root = new URL("..", import.meta.url).pathname;

const cases: Array<[string, () => void]> = [
  ["token tablosu: 114 cift, acik ve koyu, hepsi esik uzerinde", () => {
    const rows = contrastTable();
    assert.equal(rows.length, 114);
    assert.deepEqual(below(rows), []);
  }],
  ["ek cifler: placeholder, switch, accent karti, glucose pill (acik+koyu)", () => {
    const rows = extraContrastRows();
    assert.ok(rows.length >= 46, `satir sayisi ${rows.length}`);
    assert.deepEqual(below(rows), []);
  }],
  ["placeholder tokeni: bg, surface, raised sheet ve inset alanlarda >= 4.5", () => {
    for (const p of [LIGHT, DARK]) {
      const rows = extraContrastRows([p]).filter((r) => r.name.startsWith("placeholder"));
      assert.equal(rows.length, 6);
      assert.deepEqual(below(rows), []);
    }
  }],
  ["switch: ON track >= 3 (bg, surface), thumb >= 3 hem ON hem OFF track uzerinde", () => {
    for (const p of [LIGHT, DARK]) {
      const rows = extraContrastRows([p]).filter((r) => r.name.startsWith("switch"));
      assert.ok(rows.length >= 7);
      assert.deepEqual(below(rows), []);
    }
  }],
  ["switchColors(): iOS ve Android ayni tokenlardan, acik ve koyu", () => {
    for (const p of [LIGHT, DARK]) {
      setHighContrast(false);
      setActiveScheme(p.scheme);
      const c = switchColors();
      assert.equal(c.trackColor.true, p.switchTrackOn);
      assert.equal(c.trackColor.false, p.switchTrackOff);
      assert.equal(c.thumbColor, p.switchThumb);
      assert.equal(c.ios_backgroundColor, p.switchTrackOff);
    }
    setActiveScheme("dark");
  }],
  ["her TextInput placeholderTextColor yalniz THEME.placeholder", () => {
    const bad: string[] = [];
    let total = 0;
    for (const d of ["app", "components", "lib"]) {
      for (const f of sourceFiles(join(root, d))) {
        const lines = readFileSync(f, "utf8").split("\n");
        lines.forEach((l, i) => {
          if (!l.includes("placeholderTextColor")) return;
          total++;
          if (!l.includes("placeholderTextColor={THEME.placeholder}")) bad.push(`${f}:${i + 1}`);
        });
      }
    }
    assert.ok(total >= 20, `placeholder sayisi ${total}`);
    assert.deepEqual(bad, []);
  }],
  ["Increase Contrast: tum tablo ve ek ciftler yine esik uzerinde", () => {
    const pals = [HIGH_CONTRAST_PALETTES.light, HIGH_CONTRAST_PALETTES.dark];
    assert.deepEqual(below(contrastTable(pals)), []);
    assert.deepEqual(below(extraContrastRows(pals)), []);
  }],
  ["Increase Contrast: ikincil metin >= 7:1, kenarlik daha belirgin, marka rengi ayni", () => {
    for (const base of [LIGHT, DARK]) {
      const hc = highContrastPalette(base);
      for (const g of [hc.bg, hc.surfaceRaised]) {
        assert.ok(contrast(hc.textMuted, g, hc.bg) >= 7, `${base.scheme} textMuted ${contrast(hc.textMuted, g, hc.bg)}`);
        assert.ok(contrast(hc.textMuted, g, hc.bg) > contrast(base.textMuted, g, base.bg));
      }
      assert.ok(contrast(hc.borderStrong, hc.bg, hc.bg) > contrast(base.borderStrong, base.bg, base.bg));
      assert.ok(contrast(hc.trackEdge, hc.bg, hc.bg) > contrast(base.trackEdge, base.bg, base.bg));
      const alpha = (c: string) => parseFloat(c.match(/,([0-9.]+)\)$/)![1]);
      assert.ok(alpha(hc.border) > alpha(base.border));
      assert.equal(hc.accent, base.accent);
      assert.equal(hc.accentFill, base.accentFill);
      assert.deepEqual(hc.glucose, base.glucose);
      assert.equal(hc.placeholder, hc.textMuted);
    }
    assert.ok(contrast(HIGH_CONTRAST_PALETTES.light.switchTrackOff, LIGHT.bg, LIGHT.bg) > contrast(LIGHT.switchTrackOff, LIGHT.bg, LIGHT.bg));
    assert.equal(HIGH_CONTRAST_PALETTES.dark.switchTrackOff, DARK.switchTrackOff);
  }],
  ["Increase Contrast: tema bayragi aktif paleti degistirir", () => {
    setActiveScheme("light");
    setHighContrast(true);
    assert.equal(switchColors().ios_backgroundColor, HIGH_CONTRAST_PALETTES.light.switchTrackOff);
    setHighContrast(false);
    assert.equal(switchColors().ios_backgroundColor, LIGHT.switchTrackOff);
    setActiveScheme("dark");
  }],
  ["Increase Contrast: platform -> olay adi", () => {
    assert.equal(highContrastEventFor("ios"), "darkerSystemColorsChanged");
    assert.equal(highContrastEventFor("android"), "highTextContrastChanged");
    assert.equal(highContrastEventFor("web"), null);
  }],
  ["Appearance.setColorScheme argumani: tercih -> native tema", () => {
    assert.equal(nativeSchemeOverride("light"), "light");
    assert.equal(nativeSchemeOverride("dark"), "dark");
    assert.equal(nativeSchemeOverride("system"), "unspecified");
  }],
  ["widget paletleri (acik+koyu): metin, kutucuk murekkebi ve vurgu >= 4.5", () => {
    assert.deepEqual(below(widgetRows("widget-light", WIDGET_LIGHT)), []);
    assert.deepEqual(below(widgetRows("widget-dark", WIDGET_DARK)), []);
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
