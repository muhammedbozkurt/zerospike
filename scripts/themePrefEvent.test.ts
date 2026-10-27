// Calistir: npx tsx scripts/themePrefEvent.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadThemePref, THEME_PREF_KEY, ONBOARDED_KEY } from "../lib/theme/themePref";

const mem = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
  };
};

(async () => {
  // Resolved default (no stored choice): reported once, with the value.
  const seen: string[] = [];
  assert.equal(await loadThemePref(mem({}), null, (p) => seen.push(p)), "light");
  assert.deepEqual(seen, ["light"]);

  const seen2: string[] = [];
  assert.equal(await loadThemePref(mem({ [ONBOARDED_KEY]: "true" }), null, (p) => seen2.push(p)), "dark");
  assert.deepEqual(seen2, ["dark"]);

  // Second launch: the stored default is not a new default.
  const store = mem({});
  await loadThemePref(store, null);
  const seen3: string[] = [];
  assert.equal(await loadThemePref(store, null, (p) => seen3.push(p)), "light");
  assert.deepEqual(seen3, []);

  // A stored explicit choice and a forced (screenshot) one never report.
  const seen4: string[] = [];
  await loadThemePref(mem({ [THEME_PREF_KEY]: "system" }), null, (p) => seen4.push(p));
  await loadThemePref(mem({}), "dark", (p) => seen4.push(p));
  assert.deepEqual(seen4, []);

  // Wiring: provider reports the default as initial, a settings change as not initial.
  const src = readFileSync(join(__dirname, "..", "lib/theme/ThemeProvider.tsx"), "utf8");
  assert.match(src, /logEvent\("theme_pref_set",\s*\{\s*pref:\s*\w+,\s*initial:\s*true\s*\}\)/);
  assert.match(src, /logEvent\("theme_pref_set",\s*\{\s*pref:\s*next,\s*initial:\s*false\s*\}\)/);
  // Only a real change counts.
  assert.match(src, /next !== prefRef\.current/);

  // Payload carries the choice only.
  const schema = readFileSync(join(__dirname, "..", "lib/analytics/eventSchema.ts"), "utf8");
  assert.match(schema, /theme_pref_set: \{ pref: \["light", "dark", "system"\], initial: "bool" \}/);

  console.log("themePrefEvent: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
