/**
 * Theme tests: default-pref rule, persistence, system resolution, and the
 * WCAG contrast of every semantic token pair in both palettes.
 * Run: npx tsx scripts/theme.test.ts   (add --report to print the full table)
 */
import assert from "node:assert/strict";

import { contrast, contrastTable } from "../lib/theme/contrast";
import {
  acquireRemountLock,
  heldScheme,
  isRemountLocked,
  subscribeRemountLock,
} from "../lib/theme/remountLock";
import {
  loadThemePref,
  resolveScheme,
  saveThemePref,
  THEME_PREF_KEY,
  ONBOARDED_KEY,
  type PrefStore,
} from "../lib/theme/themePref";
import {
  GLUCOSE_COLORS,
  THEME,
  getActiveScheme,
  setActiveScheme,
  DARK,
  LIGHT,
} from "../lib/theme/tokens";

function memStore(init: Record<string, string> = {}): PrefStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: async (k) => (k in data ? data[k] : null),
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
}

async function main() {
  const report = process.argv.includes("--report");
  let failed = 0;
  const check = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}: ${(e as Error).message}`);
    }
  };

  await check("onboarded user without pref -> dark", async () => {
    const s = memStore({ [ONBOARDED_KEY]: "true" });
    assert.equal(await loadThemePref(s), "dark");
  });
  await check("fresh user without pref -> light", async () => {
    assert.equal(await loadThemePref(memStore()), "light");
  });
  await check("stored pref beats onboarded flag", async () => {
    const s = memStore({ [ONBOARDED_KEY]: "true", [THEME_PREF_KEY]: "light" });
    assert.equal(await loadThemePref(s), "light");
    const t = memStore({ [THEME_PREF_KEY]: "system" });
    assert.equal(await loadThemePref(t), "system");
  });
  await check("invalid stored pref falls back to the rule", async () => {
    const s = memStore({ [THEME_PREF_KEY]: "purple", [ONBOARDED_KEY]: "true" });
    assert.equal(await loadThemePref(s), "dark");
  });
  await check("default is written at once (sticky)", async () => {
    const s = memStore();
    await loadThemePref(s);
    assert.equal(s.data[THEME_PREF_KEY], "light");
    s.data[ONBOARDED_KEY] = "true";
    assert.equal(await loadThemePref(s), "light");
  });
  await check("saveThemePref persists", async () => {
    const s = memStore();
    await saveThemePref(s, "system");
    assert.equal(await loadThemePref(s), "system");
  });
  await check("storage failure does not throw", async () => {
    const broken: PrefStore = {
      getItem: async () => {
        throw new Error("io");
      },
      setItem: async () => {
        throw new Error("io");
      },
    };
    assert.equal(await loadThemePref(broken), "light");
    await saveThemePref(broken, "dark");
  });
  await check("system resolution", () => {
    assert.equal(resolveScheme("system", "light"), "light");
    assert.equal(resolveScheme("system", "dark"), "dark");
    assert.equal(resolveScheme("system", null), "dark");
    assert.equal(resolveScheme("light", "dark"), "light");
    assert.equal(resolveScheme("dark", "light"), "dark");
  });
  await check("live THEME and GLUCOSE_COLORS follow the active palette", () => {
    const before = getActiveScheme();
    setActiveScheme("light");
    assert.equal(THEME.text, LIGHT.text);
    assert.equal(THEME.ink, LIGHT.text);
    assert.equal(THEME.bg.base, LIGHT.bg);
    assert.equal(GLUCOSE_COLORS.low, LIGHT.glucose.low);
    setActiveScheme("dark");
    assert.equal(THEME.text, DARK.text);
    assert.equal(THEME.glass, DARK.surface);
    assert.equal(GLUCOSE_COLORS.low, DARK.glucose.low);
    setActiveScheme(before);
  });

  await check("destructive fill pair: onDanger on dangerFill >= 4.5 in both schemes", () => {
    for (const p of [LIGHT, DARK]) {
      const r = contrast(p.onDanger, p.dangerFill, p.bg);
      assert.ok(r >= 4.5, `${p.scheme} ${r.toFixed(2)}`);
    }
    assert.equal(LIGHT.dangerFill, "#BE2F43");
    assert.equal(LIGHT.onDanger, "#FFFFFF");
  });

  await check("heatRamp: used tiers separate from the figure body, tiers 3 and 4 clearly apart", () => {
    const mix = (a: string, b: string, t: number) => {
      const ch = (h: string, k: number) => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16);
      return `#${[0, 1, 2]
        .map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t).toString(16).padStart(2, "0"))
        .join("")}`;
    };
    for (const p of [DARK, LIGHT]) {
      const body = mix(p.surfaceRaised, p.text, 0.05);
      const r = p.heatRamp.map((c) => contrast(c, body, p.bg));
      const floors = p.scheme === "dark" ? [3, 3, 3] : [1.5, 2.5, 3];
      [1, 2, 3].forEach((i) => assert.ok(r[i] >= floors[i - 1], `${p.scheme} tier${i} ${r[i].toFixed(2)}`));
      assert.ok(contrast(p.borderStrong, body, p.bg) >= 3, `${p.scheme} outline/body`);
      const step = contrast(p.heatRamp[3], p.heatRamp[2], p.bg);
      assert.ok(step >= 1.4, `${p.scheme} tier3/tier2 ${step.toFixed(2)}`);
    }
  });

  await check("remount lock: scheme change waits while locked, applies on release", () => {
    assert.equal(heldScheme("light", "dark", true), "dark");
    assert.equal(heldScheme("light", "dark", false), "light");
    assert.equal(heldScheme("light", null, true), "light");
    let fired = 0;
    const off = subscribeRemountLock(() => (fired += 1));
    const a = acquireRemountLock();
    const b = acquireRemountLock();
    assert.equal(isRemountLocked(), true);
    a();
    a();
    assert.equal(isRemountLocked(), true);
    assert.equal(fired, 0);
    b();
    assert.equal(isRemountLocked(), false);
    assert.equal(fired, 1);
    off();
  });

  const rows = contrastTable();
  const bad = rows.filter((r) => r.ratio < r.min);
  await check(`contrast: ${rows.length} pairs, ${bad.length} below threshold`, () => {
    assert.equal(
      bad.length,
      0,
      bad.map((r) => `${r.scheme} ${r.name} ${r.ratio.toFixed(2)}<${r.min}`).join("; "),
    );
  });
  if (report) {
    for (const r of rows) {
      console.log(
        `${r.ratio < r.min ? "LOW " : "    "}${r.scheme.padEnd(5)} ${r.name.padEnd(36)} ${r.ratio.toFixed(2)} (min ${r.min})`,
      );
    }
  }

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}

void main();
