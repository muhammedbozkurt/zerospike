// Calistir: npx tsx scripts/pdfColorsFrozen.test.ts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as C from "../lib/services/pdfColors";

const expected = {
  colors: { low: "#ff5468", normal: "#22e39a", elevated: "#ffd23f", high: "#ffa02a", veryHigh: "#ff8a00" },
  veryLow: "#b3243b",
};
assert.deepEqual({ ...C.FROZEN_GLUCOSE_COLORS }, expected.colors);
assert.equal(C.FROZEN_GLUCOSE_VERY_LOW, expected.veryLow);
assert.equal(C.FROZEN_GLUCOSE_RICH.target, "#22e39a");
assert.equal(C.FROZEN_THEME.accent, "#2ee6ff");

for (const f of ["lib/services/report.ts", "lib/services/androidWidget.ts"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(!/theme\/tokens/.test(src), `${f} tema token'larini import etmemeli`);
}
console.log("pdfColorsFrozen: OK");
