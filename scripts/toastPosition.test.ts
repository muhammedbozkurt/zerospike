/** Run: npx tsx scripts/toastPosition.test.ts */
import assert from "node:assert/strict";

import {
  isTabRoute,
  tabBarHeightFor,
  toastBottomOffset,
  TOAST_GAP,
} from "../lib/toastPosition";

const base = {
  platform: "ios" as const,
  insetBottom: 34,
  tabBarVisible: true,
  compactTabBar: false,
  keyboardHeight: 0,
};

const cases: Array<[string, () => void]> = [
  ["tab routes: the four tabs, with or without trailing slash; stack and modal routes are not", () => {
    for (const p of ["/", "/food", "/injection", "/settings", "/food/"]) assert.equal(isTabRoute(p), true, p);
    for (const p of ["/calculator", "/settings/reminders", "/paywall", "/journal", "/foodx"]) {
      assert.equal(isTabRoute(p), false, p);
    }
  }],
  ["tab bar height: 49 + home indicator, 32 + inset when compact", () => {
    assert.equal(tabBarHeightFor({ insetBottom: 34, compact: false }), 83);
    assert.equal(tabBarHeightFor({ insetBottom: 0, compact: false }), 49);
    assert.equal(tabBarHeightFor({ insetBottom: 21, compact: true }), 53);
  }],
  ["with tab bar: sits just above the bar", () => {
    assert.equal(toastBottomOffset(base), 83 + TOAST_GAP);
  }],
  ["without tab bar: sits above the bottom safe area", () => {
    assert.equal(toastBottomOffset({ ...base, tabBarVisible: false }), 34 + TOAST_GAP);
    assert.equal(toastBottomOffset({ ...base, tabBarVisible: false, insetBottom: 0 }), TOAST_GAP);
  }],
  ["iOS keyboard open: above the keyboard, tab bar ignored", () => {
    assert.equal(toastBottomOffset({ ...base, keyboardHeight: 336 }), 336 + TOAST_GAP);
    assert.equal(toastBottomOffset({ ...base, tabBarVisible: false, keyboardHeight: 336 }), 336 + TOAST_GAP);
  }],
  ["Android keyboard open: window already resized, so the keyboard height is not added", () => {
    const a = { ...base, platform: "android" as const, insetBottom: 0, keyboardHeight: 300 };
    assert.equal(toastBottomOffset(a), 49 + TOAST_GAP);
    assert.equal(toastBottomOffset({ ...a, tabBarVisible: false }), TOAST_GAP);
  }],
  ["landscape iPhone compact bar", () => {
    assert.equal(toastBottomOffset({ ...base, insetBottom: 21, compactTabBar: true }), 53 + TOAST_GAP);
  }],
  ["the toast always clears the tab bar", () => {
    for (const inset of [0, 20, 34]) {
      assert.ok(toastBottomOffset({ ...base, insetBottom: inset }) >= tabBarHeightFor({ insetBottom: inset, compact: false }) + 8);
    }
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
if (failed) process.exit(1);
console.log("all passed");
