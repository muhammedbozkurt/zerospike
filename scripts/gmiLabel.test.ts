/**
 * G252-GMI: the computed value is named "GMI" in all nine languages and carries
 * a one-line explanation; no locale calls it an estimated A1C, and the screen
 * and the PDF read the same two keys.
 * Run: npx tsx scripts/gmiLabel.test.ts
 */
declare const require: (m: string) => any;
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failed++;
    console.log(`FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
const ESTIMATE_A1C =
  /(estimated|tahmini|geschätzt\w*|estimé\w*|estimad[ao]s?|stimat[ao]|推定|تقدير)\s*(hba1c|a1c)|(hba1c|a1c)\s*(estimé\w*|estimad[ao]s?|stimat[ao]|geschätzt\w*)|eA1C/i;
const ESTIMATE_WORD =
  /tahmin|estimat|estimé|estimad|estimaç|estimativ|stima|schätz|geschätz|推定|تقدير|diagnos|\btan[ıi]\b|treatment|tedavi|dose|\bdoz\b|uyar/i;

for (const l of LANGS) {
  const mod = require(`../lib/i18n/locales/${l}`);
  const dict = mod.default ?? mod;
  const ins = dict.insights ?? {};
  ok(`${l}: insights.gmi is exactly GMI`, ins.gmi === "GMI", String(ins.gmi));
  ok(
    `${l}: insights.gmiExplain exists`,
    typeof ins.gmiExplain === "string" && ins.gmiExplain.trim().length > 0
  );
  ok(`${l}: gmiExplain has no estimate or medical-claim wording`, !ESTIMATE_WORD.test(ins.gmiExplain ?? ""), ins.gmiExplain);
  ok(`${l}: gmiExplain has no em dash`, !/—/.test(ins.gmiExplain ?? ""));
  ok(`${l}: gmiNeedMore names GMI`, /GMI/.test(ins.gmiNeedMore ?? ""), ins.gmiNeedMore);

  const raw = fs.readFileSync(path.join(root, `lib/i18n/locales/${l}.ts`), "utf8");
  const hit = raw.split("\n").find((ln: string) => ESTIMATE_A1C.test(ln));
  ok(`${l}: no estimated A1C wording left in the locale`, !hit, hit);
}

const screen = fs.readFileSync(path.join(root, "app/insights.tsx"), "utf8");
const report = fs.readFileSync(path.join(root, "lib/services/report.ts"), "utf8");
ok("screen reads insights.gmi and insights.gmiExplain", screen.includes('t("insights.gmi")') && screen.includes('t("insights.gmiExplain")'));
ok("PDF reads insights.gmi and insights.gmiExplain", report.includes('t("insights.gmi")') && report.includes('t("insights.gmiExplain")'));
ok("screen does not shrink the note to fit", !/adjustsFontSizeToFit/.test(screen.slice(screen.indexOf("insights.gmiExplain") - 600, screen.indexOf("insights.gmiExplain") + 200)));

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
