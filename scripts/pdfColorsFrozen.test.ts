// Calistir: npx tsx scripts/pdfColorsFrozen.test.ts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as C from "../lib/services/pdfColors";
import { WIDGET_DARK } from "../lib/services/widgetColors";

const expected = {
  colors: { low: "#ff5468", normal: "#22e39a", elevated: "#ffd23f", high: "#ffa02a", veryHigh: "#ff8a00" },
  veryLow: "#b3243b",
};
assert.deepEqual({ ...C.FROZEN_GLUCOSE_COLORS }, expected.colors);
assert.equal(C.FROZEN_GLUCOSE_VERY_LOW, expected.veryLow);
assert.equal(C.FROZEN_GLUCOSE_RICH.target, "#22e39a");
assert.equal(C.FROZEN_THEME.accent, "#2ee6ff");

for (const f of ["lib/services/report.ts", "lib/services/androidWidget.ts", "lib/services/widgetColors.ts"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(!/theme\/tokens/.test(src), `${f} tema token'larini import etmemeli`);
}
for (const f of ["lib/services/androidWidget.ts", "lib/services/widgetColors.ts"]) {
  assert.ok(!/pdfColors/.test(readFileSync(f, "utf8")), `${f} pdfColors import etmemeli`);
}

assert.equal(WIDGET_DARK.bgFrom, C.FROZEN_THEME.bg.g2);
assert.equal(WIDGET_DARK.bgTo, C.FROZEN_THEME.bg.g1);
assert.equal(WIDGET_DARK.ink, C.FROZEN_THEME.ink);
assert.equal(WIDGET_DARK.muted, C.FROZEN_THEME.muted);
assert.equal(WIDGET_DARK.accent, "#22c7e0");
assert.notEqual(WIDGET_DARK.accent, C.FROZEN_THEME.accent);
assert.equal(WIDGET_DARK.violet, C.FROZEN_THEME.violet);
assert.equal(WIDGET_DARK.caution, C.FROZEN_THEME.caution);
assert.deepEqual({ ...WIDGET_DARK.glucose }, {
  low: C.FROZEN_GLUCOSE_RICH.low,
  target: C.FROZEN_GLUCOSE_RICH.target,
  high: C.FROZEN_GLUCOSE_RICH.high,
  wellAbove: C.FROZEN_GLUCOSE_RICH.wellAbove,
  veryHigh: C.FROZEN_GLUCOSE_RICH.veryHigh,
});
console.log("pdfColorsFrozen: OK");
