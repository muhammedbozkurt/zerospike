// Calistir: npx tsx scripts/widgetTheme.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WIDGET_THEME_KEY,
  effectiveWidgetScheme,
  publishWidgetThemePref,
  readWidgetThemePref,
  widgetPalettes,
  type WidgetThemeDeps,
  type WidgetThemeSink,
} from "../lib/services/widgetTheme";
import { WIDGET_DARK, WIDGET_LIGHT } from "../lib/services/widgetColors";

// Tercih + sistem -> etkin tema
for (const sys of ["light", "dark"] as const) {
  assert.equal(effectiveWidgetScheme("light", sys), "light");
  assert.equal(effectiveWidgetScheme("dark", sys), "dark");
  assert.equal(effectiveWidgetScheme("system", sys), sys);
}
assert.equal(effectiveWidgetScheme("system", null), "dark");
assert.equal(effectiveWidgetScheme("system", undefined), "dark");

// Android: sabitlenmis tercih iki agaca da ayni paleti verir
assert.deepEqual(widgetPalettes("light"), { light: WIDGET_LIGHT, dark: WIDGET_LIGHT });
assert.deepEqual(widgetPalettes("dark"), { light: WIDGET_DARK, dark: WIDGET_DARK });
assert.deepEqual(widgetPalettes("system"), { light: WIDGET_LIGHT, dark: WIDGET_DARK });

// Tercih okuma
const store = (v: string | null | Error) => ({
  getItem: async () => {
    if (v instanceof Error) throw v;
    return v;
  },
});
(async () => {
  assert.equal(await readWidgetThemePref(store("light")), "light");
  assert.equal(await readWidgetThemePref(store("dark")), "dark");
  assert.equal(await readWidgetThemePref(store("system")), "system");
  assert.equal(await readWidgetThemePref(store(null)), "system");
  assert.equal(await readWidgetThemePref(store("neon")), "system");
  assert.equal(await readWidgetThemePref(store(new Error("x"))), "system");

  // App Group yazimi (iOS) ve Android yenileme, mock bagimlilikla
  const makeDeps = (platform: string, stored: string | null = null) => {
    const calls: string[] = [];
    const sink: WidgetThemeSink = {
      get: (k) => {
        calls.push(`get:${k}`);
        return stored;
      },
      set: (k, v) => calls.push(`set:${k}=${v}`),
      reload: () => calls.push("reload"),
    };
    const deps: WidgetThemeDeps = {
      platform,
      openAppGroup: async () => sink,
      refreshAndroid: async (p) => {
        calls.push(`android:${p}`);
      },
    };
    return { deps, calls };
  };

  let m = makeDeps("ios");
  await publishWidgetThemePref("dark", {}, m.deps);
  assert.deepEqual(m.calls, [`set:${WIDGET_THEME_KEY}=dark`, "reload"]);

  m = makeDeps("ios", "dark");
  await publishWidgetThemePref("dark", { onlyIfChanged: true }, m.deps);
  assert.deepEqual(m.calls, [`get:${WIDGET_THEME_KEY}`], "ayni deger: yazma ve reload yok");

  m = makeDeps("ios", "light");
  await publishWidgetThemePref("dark", { onlyIfChanged: true }, m.deps);
  assert.deepEqual(m.calls, [`get:${WIDGET_THEME_KEY}`, `set:${WIDGET_THEME_KEY}=dark`, "reload"]);

  m = makeDeps("android");
  await publishWidgetThemePref("light", {}, m.deps);
  assert.deepEqual(m.calls, ["android:light"]);

  m = makeDeps("android");
  await publishWidgetThemePref("light", { onlyIfChanged: true }, m.deps);
  assert.deepEqual(m.calls, [], "acilista Android yenilemez");

  m = makeDeps("web");
  await publishWidgetThemePref("system", {}, m.deps);
  assert.deepEqual(m.calls, []);

  // Native modul yoksa atmaz
  await publishWidgetThemePref(
    "dark",
    {},
    {
      platform: "ios",
      openAppGroup: async () => {
        throw new Error("no module");
      },
      refreshAndroid: async () => {},
    },
  );

  // Swift sozlesmesi: ayni anahtar ve ayni cozum kurali
  const root = join(__dirname, "..");
  const colors = readFileSync(join(root, "targets/widget/WidgetColors.swift"), "utf8");
  assert.match(colors, new RegExp(`static let key = "${WIDGET_THEME_KEY}"`));
  assert.match(colors, /case "light": return \.light/);
  assert.match(colors, /case "dark": return \.dark/);
  assert.match(colors, /default: return system/);
  const small = readFileSync(join(root, "targets/widget/SmallWidgets.swift"), "utf8");
  const quick = readFileSync(join(root, "targets/widget/QuickAdd.swift"), "utf8");
  const index = readFileSync(join(root, "targets/widget/index.swift"), "utf8");
  const activity = readFileSync(join(root, "targets/widget/PostMealActivity.swift"), "utf8");
  for (const [name, src] of [["SmallWidgets", small], ["QuickAdd", quick], ["index", index]] as const) {
    assert.match(src, /\.widgetThemed\(\)/, `${name}.swift: widgetThemed yok`);
  }
  assert.match(activity, /\.activityThemed\(\)/);
  assert.ok(!/activityBackgroundTint\(WidgetPalette\.background\)/.test(activity));

  // Eski neon turkuaz hicbir widget kaynaginda kalmamali
  for (const f of [colors, small, quick, index, activity]) {
    assert.ok(!/2ee6ff/i.test(f), "eski #2EE6FF kalintisi");
  }
  console.log("widgetTheme.test OK");
})();
