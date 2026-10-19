/**
 * fitFontSize(): the Injections title row at 375pt for all nine languages.
 * npx tsx scripts/fitText.test.ts
 * Hesaplı kanıt: gerçek cihaz ölçümü yok (DOĞRULANMADI).
 */
import { fitFontSize, estimateTextWidth } from "../lib/fitText";

let failed = 0;
function ok(name: string, cond: boolean, info = ""): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name} ${info}`);
  }
}

const TITLES: Record<string, string> = {
  en: "Injections",
  tr: "Enjeksiyonlar",
  de: "Injektionen",
  fr: "Injections",
  es: "Inyecciones",
  it: "Iniezioni",
  pt: "Aplicações",
  ar: "الحقن",
  ja: "注射",
};

// 375pt screen, px-4 gutters, help 32 + gap 10, profile pill with a 72pt name
// (24 padding + 18 icon + 12 margins + 14 chevron + 72) and an 8pt title gap.
const SCREEN = 375;
const AVAILABLE = SCREEN - 32 - 32 - 10 - (24 + 18 + 12 + 14 + 72) - 8;

for (const [lang, title] of Object.entries(TITLES)) {
  const size = fitFontSize({ text: title, availableWidth: AVAILABLE, maxSize: 24, minSize: 18 });
  ok(`${lang} within bounds`, size >= 18 && size <= 24, String(size));
  ok(
    `${lang} fits at chosen size or sits on the floor`,
    estimateTextWidth(title, size) <= AVAILABLE || size === 18,
    `size=${size}`,
  );
  console.log(`  ${lang} ${title} -> ${size}pt (est ${estimateTextWidth(title, size).toFixed(0)} / ${AVAILABLE})`);
}

ok("short title keeps max", fitFontSize({ text: "注射", availableWidth: 200, maxSize: 24, minSize: 18 }) === 24);
ok("zero width gives floor", fitFontSize({ text: "x", availableWidth: 0, maxSize: 24, minSize: 18 }) === 18);
ok(
  "bigger OS font scale never grows the size",
  fitFontSize({ text: "Enjeksiyonlar", availableWidth: 170, maxSize: 24, minSize: 14, fontScale: 1.3 }) <=
    fitFontSize({ text: "Enjeksiyonlar", availableWidth: 170, maxSize: 24, minSize: 14, fontScale: 1 }),
);
ok("never below min", fitFontSize({ text: "x".repeat(80), availableWidth: 100, maxSize: 24, minSize: 18 }) === 18);

if (failed) {
  console.log(`fitText: ${failed} failed`);
  process.exit(1);
}
console.log("fitText: all passed");
