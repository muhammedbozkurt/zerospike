/**
 * The Nightscout row on the data sources screen is always the third option while the build flag
 * is on, even without the secure store; a non-Pro tap goes to the paywall.
 * Run: npx -y tsx scripts/dataSourcesNightscoutRow.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const src = readFileSync(join(ROOT, "app/settings/data-sources.tsx"), "utf8").replace(/\/\/.*$/gm, "");

// Order: manual, cgm (only with a health provider), nightscout.
{
  const opts = src.slice(src.indexOf("const options: ModeOption[]"), src.indexOf("async function switchTo"));
  const m = opts.indexOf('mode: "manual"');
  const c = opts.indexOf('mode: "cgm"');
  const n = opts.indexOf('mode: "nightscout"');
  assert.ok(m >= 0 && c > m && n > c, "secenek sirasi manual, cgm, nightscout");
  assert.ok(/\.\.\.\(hasHealthProvider\(\)\s*\?\s*\[[\s\S]*?mode: "cgm"/.test(src), "cgm yalniz hasHealthProvider ile");
}

// Visibility is the flag alone, never the secure store.
{
  assert.ok(/const nsEnabled = nightscoutEnabled\(\);/.test(src), "nsEnabled yalniz bayrak");
  assert.ok(/\.\.\.\(nsEnabled\s*\?\s*\[[\s\S]*?mode: "nightscout"/.test(src), "satir nsEnabled arkasinda");
  assert.ok(!/nsEnabled\s*=[^;]*nightscoutAvailable/.test(src), "nsEnabled secure store'a bagli degil");
  assert.ok(!/nsAvailable/.test(src), "eski nsAvailable kapisi kalmadi");
}

// Without the secure store the tap shows the existing info key and opens no form.
{
  const choose = src.slice(src.indexOf("async function choose"));
  const guard = choose.indexOf("!nightscoutAvailable()");
  const open = choose.indexOf("setNsFormOpen(true)");
  assert.ok(guard > 0 && open > guard, "store kontrolu formdan once");
  assert.ok(/!nightscoutAvailable\(\)\)\s*\{\s*toast\(t\("nightscout\.errUnavailable"\)[^;]*;\s*return;/.test(choose), "store yoksa bilgi ve return");
}

// Non-Pro: lock badge, tap goes to the paywall, mode unchanged, no form.
{
  assert.ok(/badge: nightscoutAllowed\(isProUser\) \? undefined : t\("nightscout\.proTag"\)/.test(src), "Pro degilse Pro etiketi");
  assert.ok(/option\.badge \? \([\s\S]*?name="lock-closed"[\s\S]*?\{option\.badge\}/.test(src), "rozette kilit ikonu");
  const choose = src.slice(src.indexOf("async function choose"));
  const pro = choose.indexOf("!nightscoutAllowed(isProUser)");
  const form = choose.indexOf("setNsFormOpen(true)");
  assert.ok(pro > 0 && pro < form, "Pro kontrolu formdan once");
  assert.ok(
    /!nightscoutAllowed\(isProUser\)\)\s*\{[\s\S]*?router\.push\(\{ pathname: "\/paywall"[\s\S]*?return;/.test(choose),
    "Pro degilse paywall ve return (mod degismez)"
  );
}

console.log("dataSourcesNightscoutRow: OK");
