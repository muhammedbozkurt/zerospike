/**
 * lib/tabLabelFit.ts: every bottom-tab label, in all 9 languages, fits one
 * line at a 320pt screen with four tabs (72pt each).
 * Run: npx tsx scripts/tabLabelFit.test.ts
 */
import assert from "node:assert/strict";

import ar from "../lib/i18n/locales/ar";
import de from "../lib/i18n/locales/de";
import en from "../lib/i18n/locales/en";
import es from "../lib/i18n/locales/es";
import fr from "../lib/i18n/locales/fr";
import it from "../lib/i18n/locales/it";
import ja from "../lib/i18n/locales/ja";
import pt from "../lib/i18n/locales/pt";
import tr from "../lib/i18n/locales/tr";
import { estimateTabLabelWidth, tabLabelBudget, tabLabelFits } from "../lib/tabLabelFit";

const LOCALES = { en, tr, de, fr, es, it, pt, ar, ja } as Record<string, { tabs: Record<string, string> }>;
const KEYS = ["today", "food", "injection", "settings"];
const SCREEN = 320;

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

check("budget at 320pt with 4 tabs is 72pt", () => {
  assert.equal(tabLabelBudget(SCREEN, 4), 72);
});

check("estimator reproduces the two measured overflows", () => {
  const fr = estimateTabLabelWidth("Tableau de bord");
  const pt = estimateTabLabelWidth("Configurações");
  assert.ok(Math.abs(fr - 82.9) < 3, `fr ${fr.toFixed(1)}`);
  assert.ok(Math.abs(pt - 73.7) < 3, `pt ${pt.toFixed(1)}`);
  assert.equal(tabLabelFits("Tableau de bord", SCREEN, 4), false);
  assert.equal(tabLabelFits("Configurações", SCREEN, 4), false);
});

check("the long food label that clipped is rejected", () => {
  assert.equal(tabLabelFits("Yemek & Tarama", SCREEN, 4), false);
});

const expectedFood: Record<string, string> = {
  tr: "Yemek",
  de: "Essen",
  en: "Food",
  fr: "Repas",
  es: "Comida",
  it: "Cibo",
  pt: "Comida",
  ar: "الطعام",
  ja: "食事",
};

for (const [lang, loc] of Object.entries(LOCALES)) {
  check(`${lang}: food label is the short form`, () => {
    assert.equal(loc.tabs.food, expectedFood[lang]);
  });
  for (const key of KEYS) {
    check(`${lang}.tabs.${key} fits 4 tabs at 320pt`, () => {
      const label = loc.tabs[key];
      assert.ok(label, "missing label");
      const w = estimateTabLabelWidth(label);
      assert.ok(w <= tabLabelBudget(SCREEN, 4), `"${label}" ~${w.toFixed(1)}pt > 72pt`);
    });
  }
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
