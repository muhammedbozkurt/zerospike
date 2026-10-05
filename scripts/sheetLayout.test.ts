/**
 * lib/sheetLayout.ts correctness harness. No jest, same standalone style as
 * scripts/postMealTimer.test.ts.
 *
 * The property under test: a bottom sheet's available height has to be
 * measured against the KEYBOARD, not just the window, or the sheet (and
 * whatever CTA sits at its bottom) ends up hidden behind it. Section B is the
 * regression oracle for that exact bug: the old post-meal "I started late"
 * sheet's custom-minutes Stepper, which opened a keyboard with no
 * keyboard-avoidance at all. That sheet has since been folded into
 * components/PostMealDurationSheet.tsx, which uses SheetShell.
 *
 * Run: npx tsx scripts/sheetLayout.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { sheetLayout, legacySheetBottomOverflowPx } from "../lib/sheetLayout";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike sheetLayout test");

interface Device {
  name: string;
  windowHeight: number;
  insetBottom: number;
  keyboardHeight: number;
}

/** Real device points, keyboard heights for a number-pad/full keyboard. */
const DEVICES: Device[] = [
  { name: "iPhone SE 2/3", windowHeight: 667, insetBottom: 0, keyboardHeight: 216 },
  { name: "iPhone 13 mini", windowHeight: 812, insetBottom: 34, keyboardHeight: 291 },
  { name: "iPhone 15/16", windowHeight: 852, insetBottom: 34, keyboardHeight: 291 },
  { name: "iPhone 16 Pro Max", windowHeight: 956, insetBottom: 34, keyboardHeight: 301 },
  { name: "Android orta", windowHeight: 800, insetBottom: 24, keyboardHeight: 280 },
];

/** A representative sheet body: title, hint, stepper/field, CTA. */
const CONTENT_HEIGHT = 460;

/** A fuller sheet body (custom field expanded + a warning banner), the shape
 *  that used to run into the legacy 90%-of-window cap on every device below. */
const CONTENT_HEIGHT_LEGACY = 650;

section("A. Klavye acikken sheet gorunur alanin icinde kalir");
for (const d of DEVICES) {
  const r = sheetLayout({
    windowHeight: d.windowHeight,
    keyboardHeight: d.keyboardHeight,
    insetBottom: d.insetBottom,
    contentHeight: CONTENT_HEIGHT,
  });
  const available = d.windowHeight - d.keyboardHeight;
  ok(
    `${d.name}: sheetMaxHeight <= windowHeight - keyboardHeight`,
    r.sheetMaxHeight <= available,
    `sheetMaxHeight=${r.sheetMaxHeight}, available=${available}`,
  );
  eq(`${d.name}: actionVisible`, r.actionVisible, true);
}

section("B. Regresyon: eski hesap klavyeyi ortuyor, yeni hesap ortmuyor");
for (const d of DEVICES) {
  const legacyInput = {
    windowHeight: d.windowHeight,
    keyboardHeight: d.keyboardHeight,
    insetBottom: d.insetBottom,
    contentHeight: CONTENT_HEIGHT_LEGACY,
  };
  const legacyOverflow = legacySheetBottomOverflowPx(legacyInput);
  const r = sheetLayout(legacyInput);
  // available - sheetMaxHeight: the clearance left above the keyboard once
  // the sheet respects its new cap. >= 0 means the new sheet never reaches
  // into the keyboard's strip, i.e. the new "ortme" (overlap) is always 0.
  const clearance = d.windowHeight - d.keyboardHeight - r.sheetMaxHeight;
  console.log(`  ${d.name}: eski ortme=${legacyOverflow}px, yeni ortme=0px (bosluk=${clearance}px)`);
  ok(`${d.name}: eski hesapta klavye sheet'i ortuyor (>0px)`, legacyOverflow > 0, `legacyOverflow=${legacyOverflow}`);
  ok(`${d.name}: yeni hesapta ortme yok (available >= sheetMaxHeight)`, clearance >= 0, `clearance=${clearance}`);
}

section("C. Buyuk Dynamic Type (1.3x icerik): scroll'a gider, aksiyon gorunur kalir");
for (const d of DEVICES) {
  const bigContent = CONTENT_HEIGHT * 1.3;
  const r = sheetLayout({
    windowHeight: d.windowHeight,
    keyboardHeight: d.keyboardHeight,
    insetBottom: d.insetBottom,
    contentHeight: bigContent,
  });
  ok(`${d.name}: buyumus icerik scroll gerektirir`, r.scrolls, `scrolls=${r.scrolls}`);
  eq(`${d.name}: aksiyon yine de gorunur kalir`, r.actionVisible, true);
}

section("D. Klavye kapaninca/acilinca paddingBottom degisir");
for (const d of DEVICES) {
  const closed = sheetLayout({
    windowHeight: d.windowHeight,
    keyboardHeight: 0,
    insetBottom: d.insetBottom,
    contentHeight: CONTENT_HEIGHT,
  });
  eq(`${d.name}: klavye kapali -> paddingBottom = insetBottom + 16`, closed.paddingBottom, d.insetBottom + 16);

  const open = sheetLayout({
    windowHeight: d.windowHeight,
    keyboardHeight: d.keyboardHeight,
    insetBottom: d.insetBottom,
    contentHeight: CONTENT_HEIGHT,
  });
  eq(`${d.name}: klavye acik -> paddingBottom = 16`, open.paddingBottom, 16);
}

section("E. Kucuk icerik: sheet tavana degil icerige gore kalir, tavan asilmaz");
for (const d of DEVICES) {
  const small = sheetLayout({
    windowHeight: d.windowHeight,
    keyboardHeight: d.keyboardHeight,
    insetBottom: d.insetBottom,
    contentHeight: 120,
  });
  const available = d.windowHeight - d.keyboardHeight;
  ok(`${d.name}: kucuk icerik scroll gerektirmez`, !small.scrolls, `scrolls=${small.scrolls}`);
  ok(
    `${d.name}: sheetMaxHeight varsayilan orani asmaz (<= available * 0.9)`,
    small.sheetMaxHeight <= available * 0.9 + 0.001,
    `sheetMaxHeight=${small.sheetMaxHeight}, ceiling=${available * 0.9}`,
  );
}

section("F. Dejenere girdiler: throw yok, negatif yukseklik yok");
{
  const r1 = sheetLayout({ windowHeight: 0, keyboardHeight: 0, insetBottom: 0, contentHeight: 0 });
  eq("windowHeight 0 -> sheetMaxHeight 0", r1.sheetMaxHeight, 0);
  ok("windowHeight 0 -> negatif degil", r1.sheetMaxHeight >= 0);
  eq("windowHeight 0 -> actionVisible false (imkansiz durum)", r1.actionVisible, false);

  const r2 = sheetLayout({ windowHeight: 500, keyboardHeight: 900, insetBottom: 34, contentHeight: 300 });
  ok("keyboardHeight > windowHeight -> negatif degil", r2.sheetMaxHeight >= 0, `sheetMaxHeight=${r2.sheetMaxHeight}`);
  eq("keyboardHeight > windowHeight -> sheetMaxHeight 0", r2.sheetMaxHeight, 0);
  eq("keyboardHeight > windowHeight -> actionVisible false (imkansiz durum)", r2.actionVisible, false);

  const legacy = legacySheetBottomOverflowPx({ windowHeight: 0, keyboardHeight: 300, insetBottom: 0, contentHeight: 0 });
  ok("legacy fn windowHeight 0 -> throw yok, negatif degil", legacy >= 0, `legacy=${legacy}`);

  // A very tall content on a tiny window: minVisible floor still respected
  // once available itself is above it, and never negative once it is not.
  const r3 = sheetLayout({ windowHeight: 300, keyboardHeight: 0, insetBottom: 0, contentHeight: 5000 });
  ok("kucuk pencere -> sheetMaxHeight negatif degil", r3.sheetMaxHeight >= 0, `sheetMaxHeight=${r3.sheetMaxHeight}`);
  ok("kucuk pencere -> scroll gerekir", r3.scrolls, `scrolls=${r3.scrolls}`);
}

{
  const { keyboardOverlapPx } = require("../lib/sheetLayout");
  ok("overlap: pencere kuculduyse 0", keyboardOverlapPx({ containerBottom: 800, keyboardTop: 800 }) === 0, "");
  ok("overlap: klavye ustte kalirsa fark", keyboardOverlapPx({ containerBottom: 2400, keyboardTop: 1500 }) === 900, "");
  ok("overlap: negatif/NaN -> 0", keyboardOverlapPx({ containerBottom: 700, keyboardTop: 800 }) === 0 && keyboardOverlapPx({ containerBottom: NaN, keyboardTop: 1 }) === 0, "");
}

{
  const { measureHostInWindow } = require("../lib/measureHost");
  const { keyboardOverlapPx } = require("../lib/sheetLayout");
  // Old logic: direct call on a ref without measureInWindow throws.
  let threw = false;
  try {
    (({ current: {} }.current as any) as { measureInWindow: () => void }).measureInWindow();
  } catch {
    threw = true;
  }
  ok("eski dogrudan cagri fonksiyonsuz ref'te throw eder", threw, "");
  let called = 0;
  let r: unknown = "x";
  try {
    r = measureHostInWindow({ current: {} }, () => called++);
  } catch {
    r = "threw";
  }
  ok("fonksiyonsuz ref -> cagrilmaz, hata yok", r === false && called === 0, String(r));
  ok("null ref -> false", measureHostInWindow({ current: null }, () => called++) === false && measureHostInWindow(null, () => called++) === false && called === 0, "");
  let lift = -1;
  const host = { measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) { cb(0, 100, 400, 2300); } };
  const started = measureHostInWindow({ current: host }, (m: { y: number; height: number }) => {
    lift = keyboardOverlapPx({ containerBottom: m.y + m.height, keyboardTop: 1500 });
  });
  ok("olcum doner -> overlap hesaplanir", started === true && lift === 900, `lift=${lift}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
