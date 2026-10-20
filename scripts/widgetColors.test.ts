// Calistir: npx tsx scripts/widgetColors.test.ts
import assert from "node:assert/strict";
import { contrast } from "../lib/theme/contrast";
import { WIDGET_DARK, WIDGET_LIGHT, type WidgetPalette } from "../lib/services/widgetColors";

function check(name: string, pal: WidgetPalette) {
  const bg = pal.bgTo;
  const min = (label: string, fg: string, on: string, t: number) => {
    const c = contrast(fg, on, on);
    assert.ok(c >= t, `${name} ${label}: ${c.toFixed(2)} < ${t}`);
  };
  assert.equal(pal.bgFrom === pal.bgTo || name === "dark", true);
  min("ink/bg", pal.ink, bg, 4.5);
  min("muted/bg", pal.muted, bg, 4.5);
  min("accent/bg", pal.accent, bg, 4.5);
  min("onAccentFill/accentFill", pal.onAccentFill, pal.accentFill, 4.5);
  for (const [k, v] of Object.entries(pal.glucose)) min(`glucose.${k}/bg`, v, bg, 4.5);
  for (const [k, v] of Object.entries(pal.tileInk)) {
    const tile = pal.tile[k === "glucose" ? "glucosePrimary" : (k as "meal")];
    min(`tileInk.${k}/tile`, v, tile.fill, 3);
    min(`tileInk.${k}/bg`, v, bg, 3);
  }
  for (const [k, t] of Object.entries(pal.tile)) min(`ink/tile.${k}`, pal.ink, t.fill, 4.5);
  min("accent/countdown", pal.accent, pal.tile.countdown.fill, 4.5);
  min("muted/surface", pal.muted, pal.surface, 4.5);
}

check("light", WIDGET_LIGHT);
check("dark", WIDGET_DARK);
assert.equal(WIDGET_DARK.accent, "#22c7e0");
assert.equal(WIDGET_DARK.accentFill, "#22c7e0");
assert.equal(WIDGET_DARK.tileInk.glucose, "#22c7e0");
assert.ok(contrast(WIDGET_DARK.accentFill, WIDGET_DARK.bgTo, WIDGET_DARK.bgTo) >= 3, "dark accentFill/bg < 3");
assert.ok(contrast(WIDGET_DARK.accentFill, WIDGET_DARK.bgFrom, WIDGET_DARK.bgFrom) >= 3, "dark accentFill/bgFrom < 3");
assert.ok(contrast(WIDGET_DARK.accent, WIDGET_DARK.bgFrom, WIDGET_DARK.bgFrom) >= 4.5, "dark accent/bgFrom < 4.5");
console.log("widgetColors: OK");
