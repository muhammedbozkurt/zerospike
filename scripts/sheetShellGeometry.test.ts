/**
 * Shared sheet shell geometry (lib/sheetLayout.ts sheetFrame) plus the source
 * contract that keeps the title row out of any keyboard-avoiding wrapper.
 * Run: npx tsx scripts/sheetShellGeometry.test.ts
 *
 * Proves, for four device classes (Dynamic Island, notch, no notch, iPad), six
 * sheets, keyboard closed and open on both platform behaviours (iOS: window not
 * resized, Android adjustResize: window already shrunk):
 *  - insets.top is counted once: the sheet's top edge never rises above it, so
 *    the title row and the close button are never under the status bar;
 *  - the gap above the title is the same constant on every class;
 *  - sheet height <= screen - insets.top - keyboard;
 *  - the two keyboard behaviours give the same sheet (no double lift).
 * Geometry only; the device screenshots are a separate pass.
 */
declare const require: (m: string) => any;
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;

import { keyboardOverlapPx, sheetFrame } from "../lib/sheetLayout";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

console.log("zerospike sheetShellGeometry test");

interface Device {
  name: string;
  w: number;
  h: number;
  top: number;
  bottom: number;
  kb: number;
}
const DEVICES: Device[] = [
  { name: "SE 375x667", w: 375, h: 667, top: 20, bottom: 0, kb: 216 },
  { name: "mini 375x812", w: 375, h: 812, top: 47, bottom: 34, kb: 291 },
  { name: "Pro Max 430x932", w: 430, h: 932, top: 59, bottom: 34, kb: 301 },
  { name: "iPad 13 1032x1376", w: 1032, h: 1376, top: 24, bottom: 20, kb: 420 },
];

interface Sheet {
  name: string;
  /** Share of the allowance the shell may take (maxHeightRatio). */
  ratio: number;
  fit: boolean;
  content: number;
}
// Title row + grabber + footer are inside `content` for the fit estimate.
const SHEETS: Sheet[] = [
  { name: "kan sekeri", ratio: 1, fit: true, content: 520 },
  { name: "ogun", ratio: 0.92, fit: false, content: 1200 },
  { name: "oran", ratio: 0.9, fit: true, content: 640 },
  { name: "geri bildirim", ratio: 0.92, fit: true, content: 600 },
  { name: "not", ratio: 1, fit: true, content: 420 },
  { name: "bolge", ratio: 0.92, fit: false, content: 900 },
];

/** SheetShell: paddingTop 8 + grabber 4 + mb-1.5 (6). */
const TITLE_GAP = 18;

function frameFor(d: Device, s: Sheet, kbOpen: "none" | "ios" | "android") {
  const input = {
    windowHeight: d.h,
    insetTop: d.top,
    insetBottom: d.bottom,
    contentHeight: s.content,
    maxHeightRatio: s.ratio,
  };
  if (kbOpen === "none") return { f: sheetFrame({ ...input, hostHeight: d.h, lift: 0, keyboardOpen: false }), lift: 0, host: d.h };
  if (kbOpen === "ios") {
    const lift = keyboardOverlapPx({ containerBottom: d.h, keyboardTop: d.h - d.kb });
    return { f: sheetFrame({ ...input, hostHeight: d.h, lift, keyboardOpen: true }), lift, host: d.h };
  }
  const host = d.h - d.kb;
  const lift = keyboardOverlapPx({ containerBottom: host, keyboardTop: d.h - d.kb });
  return { f: sheetFrame({ ...input, hostHeight: host, lift, keyboardOpen: true }), lift, host };
}

const rows: string[] = [];
for (const d of DEVICES) {
  for (const s of SHEETS) {
    const closed = frameFor(d, s, "none");
    const ios = frameFor(d, s, "ios");
    const andr = frameFor(d, s, "android");

    for (const [label, r] of [["kapali", closed], ["ios klavye", ios], ["android klavye", andr]] as const) {
      const sheetH = s.fit ? Math.min(r.f.sheetMaxHeight, s.content + r.f.paddingBottom) : r.f.sheetMaxHeight;
      const top = r.host - r.lift - sheetH;
      const tag = `${d.name} / ${s.name} / ${label}`;
      ok(`${tag}: sheet ust kenari insets.top altina inmez`, top >= d.top - 0.001, `top=${top} inset=${d.top}`);
      ok(`${tag}: yukseklik <= ekran - insets.top - klavye`, sheetH <= d.h - d.top - (label === "kapali" ? 0 : d.kb) + 0.001, `h=${sheetH}`);
      ok(`${tag}: yukseklik pozitif`, sheetH > 0);
    }

    eq(`${d.name} / ${s.name}: ios ve android klavyede ayni sheet (cift kaldirma yok)`, ios.f.sheetMaxHeight, andr.f.sheetMaxHeight);
    eq(`${d.name} / ${s.name}: android resize lift 0`, andr.lift, 0);
    eq(`${d.name} / ${s.name}: ios lift = klavye`, ios.lift, d.kb);
    eq(`${d.name} / ${s.name}: ayni alt dolgu`, ios.f.paddingBottom, andr.f.paddingBottom);
    eq(`${d.name} / ${s.name}: klavye acikken home inset eklenmez`, ios.f.paddingBottom, 16);

    if (s.ratio === 1) {
      // Full allowance: the title row starts exactly at the inset, not below a doubled one.
      eq(`${d.name} / ${s.name}: tam izinde ust = insets.top (bir kez)`, closed.f.sheetTop, d.top);
    }

    const sheetH = s.fit ? Math.min(closed.f.sheetMaxHeight, s.content + closed.f.paddingBottom) : closed.f.sheetMaxHeight;
    rows.push(
      `| ${d.name} | ${s.name} | ${d.top} | ${Math.round(d.h - sheetH)} | ${Math.round(d.h - sheetH - d.top)} | ${TITLE_GAP} | ${Math.round(sheetH)} | ${
        s.content + closed.f.paddingBottom > closed.f.sheetMaxHeight ? "evet" : "hayir"
      } |`,
    );
  }
}

// Insets are not summed: raising insets.top by N shrinks the allowance by exactly N.
{
  const a = sheetFrame({ hostHeight: 812, windowHeight: 812, lift: 0, keyboardOpen: false, insetTop: 20, insetBottom: 34, contentHeight: 900, maxHeightRatio: 1 });
  const b = sheetFrame({ hostHeight: 812, windowHeight: 812, lift: 0, keyboardOpen: false, insetTop: 59, insetBottom: 34, contentHeight: 900, maxHeightRatio: 1 });
  eq("insets.top bir kez: +39 inset = -39 yukseklik", a.sheetMaxHeight - b.sheetMaxHeight, 39);
}
// hostHeight 0 (not measured yet) falls back to the window.
eq(
  "olculmemis host pencereye duser",
  sheetFrame({ hostHeight: 0, windowHeight: 800, lift: 0, keyboardOpen: false, insetTop: 40, insetBottom: 0, contentHeight: 0, maxHeightRatio: 1 }).sheetMaxHeight,
  760,
);

// Source contract: only the body scrolls, title row never inside an avoiding view.
const root = path.join(__dirname, "..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
{
  const shell = read("components/SheetShell.tsx");
  ok("SheetShell: KeyboardAvoidingView import yok", !/KeyboardAvoidingView,|<KeyboardAvoidingView/.test(shell));
  const titleAt = shell.indexOf("numberOfLines={2}");
  const scrollAt = shell.indexOf("<ScrollView");
  ok("SheetShell: baslik satiri ScrollView'dan once ve disinda", titleAt > 0 && scrollAt > titleAt);
  ok("SheetShell: yalniz govde ScrollView icinde", /<ScrollView[\s\S]*\{children\}[\s\S]*<\/ScrollView>/.test(shell));
  ok("SheetShell: tablet kutusu korunur", shell.includes("sheetBoxStyle(layoutWidth, isWide, windowHeight)"));
  ok("SheetShell: tablet dialog ortalanir", shell.includes('dialog ? "center" : "flex-end"'));
  ok("SheetShell: kapatma dugmesi baslik satirinda", /closeLabel[\s\S]*name="close"/.test(shell));
  ok("SheetShell: ust bosluk sabitleri", shell.includes("paddingTop: 8") && shell.includes("height: 4") && shell.includes("mb-1.5"));
}
for (const f of ["SavedMedEditSheet", "ReminderEditSheet", "MedEditSheet", "InjectionEditSheet", "QuickAddSheet"]) {
  const src = read(`components/${f}.tsx`);
  ok(`${f}: <KeyboardAvoidingView> kalmadi`, !src.includes("<KeyboardAvoidingView"));
  ok(`${f}: useSheetKeyboard ile olculen kaldirma`, src.includes("useSheetKeyboard(visible)") && src.includes("paddingBottom: liftAnim"));
  ok(`${f}: sheet yuksekligi insets.top ile sinirli`, src.includes("insetTop: insets.top") && /sheetAvail/.test(src));
}
{
  const g = read("components/GlucoseInputSheet.tsx");
  ok("Glucose: ust cap insets.top", g.includes("paddingTop: insets.top"));
  ok("Glucose: baslik sheet icinde, govde ScrollView", g.indexOf("dashboard.logGlucose") < g.indexOf("<ScrollView"));
  const m = read("components/MealComposeSheet.tsx");
  ok("MealCompose: insetTop bir kez", (m.match(/insetTop: insets\.top/g) ?? []).length === 1);
  ok("MealCompose: baslik ScrollView'dan once", m.indexOf('t("mealCompose.title")') < m.indexOf("ref={scrollRef}"));
  const site = read("components/InjectionSiteSheet.tsx");
  ok("InjectionSiteSheet: SheetShell fit=false + kapat dugmesi", site.includes("<SheetShell") && site.includes("fit={false}") && site.includes("footer="));
  ok("InjectionSiteSheet: harita ve lejant ayni govdede", site.includes("<InjectionBodyMap"));
  const calc = read("app/calculator.tsx");
  ok("calculator: bolge sheet'i ayri dosyadan", calc.includes("<InjectionSiteSheet") && !calc.includes("SitePickerModal"));
}

// 241-FC source contract.
{
  const shell = read("components/SheetShell.tsx");
  ok("241-FC SheetShell: dialogda surukleme tutamaci yok", shell.includes("{dialog ? null : (") && shell.indexOf("{dialog ? null : (") < shell.indexOf("width: 38, height: 4"));
  const g = read("components/GlucoseInputSheet.tsx");
  ok("241-FC Glucose: dis kutu yalniz cerceve (surface false)", g.includes("availH > 0 ? availH : undefined, false)"));
  ok("241-FC Glucose: dialogda kart dialogCardStyle ile dolar", g.includes("isDialog") && g.includes("...dialogCardStyle"));
  ok("241-FC Glucose: dialogda alt bosluk 24 yok", /isDialog\s*\?\s*\{[\s\S]*?\}\s*:\s*isWide[\s\S]*?marginBottom: SPACE\.xl/.test(g));
  ok("241-FC Glucose: alt sinir ustunde aralik satiri", g.includes('valueState === "below"') && g.includes("wholeBad || pasteBad || aboveBad || belowBad"));
  const m = read("components/MealComposeSheet.tsx");
  ok("241-FC MealCompose: ayni clearance kutuya da gecer", m.includes("{ clearance: dialogClearance }") && m.includes("dialogHeights(rootHeight, dialogRoom, dialogClearance)"));
  for (const f of ["components/Feedback.tsx", "components/QuickAddSheet.tsx", "components/onboarding/LanguageChip.tsx"]) {
    ok(`241-FC ${f}: minRatio 0`, read(f).includes("{ minRatio: 0 }"));
  }
  for (const f of ["components/CarbEstimateSheet.tsx", "components/MealComposeSheet.tsx"]) {
    ok(`241-FC ${f}: min %50 kalir`, !read(f).includes("minRatio"));
  }
  ok("241-FC calculator: olu sheetBoxStyle importu yok", !read("app/calculator.tsx").includes("sheetBoxStyle"));
  const home = read("app/(tabs)/index.tsx");
  ok("241-FC index: kesim anahtarla tutulur", home.includes("splitHomeByKeys(") && home.includes("splitCutRef.current = columnSplit.cutKey"));
}

console.log("\n| cihaz | sheet | insets.top | sheet ust y | ust bosluk (y - inset) | baslik ustu | yukseklik | kayar mi |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
