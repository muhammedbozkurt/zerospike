/**
 * i18n key audit: every STATIC t("...") / i18n.t("...") key used in the app must
 * exist in the translation schema (lib/i18n/locales/tr.ts). Locale-to-locale
 * parity is already enforced by TypeScript (each locale is typed as
 * TranslationSchema = typeof tr), but TS does NOT check that a t() call-site key
 * actually exists in the schema, so a typo or wrong namespace (e.g.
 * "common.continue" when the key lives under "onboarding") ships as a raw key.
 * This script closes that gap. Dynamic keys (template literals with ${...}) are
 * skipped; run it in CI via `npm run i18n:check`.
 *
 * It also audits the NATIVE permission strings, which no TypeScript type covers:
 * every *UsageDescription declared in app.json's ios.infoPlist must have a
 * translation in every file listed under expo.locales. An iOS permission prompt
 * that falls back to the English base string is invisible in the JS bundle, so it
 * only ever surfaced on a device in a non-English locale.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_FILE = path.join(ROOT, "lib/i18n/locales/tr.ts");
const APP_CONFIG = path.join(ROOT, "app.json");
const SCAN_DIRS = ["app", "lib", "components"];

function loadSchemaKeys() {
  const src = fs.readFileSync(SCHEMA_FILE, "utf8");
  const m = src.match(/const tr = (\{[\s\S]*\});\s*export default tr;/);
  if (!m) throw new Error("Could not parse the translation schema object from tr.ts");
  // The object literal is our own trusted source; eval is safe here.
  // eslint-disable-next-line no-eval
  const obj = eval("(" + m[1] + ")");
  const keys = new Set();
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") walk(v, key);
      else keys.add(key);
    }
  };
  walk(obj, "");
  return keys;
}

function listSourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * app.json ios.infoPlist vs. ios-locales/*.json. Returns a list of problem lines
 * (empty when the two key sets agree for every declared locale).
 */
function checkIosLocales() {
  const problems = [];
  const cfg = JSON.parse(fs.readFileSync(APP_CONFIG, "utf8")).expo || {};
  const infoPlist = (cfg.ios && cfg.ios.infoPlist) || {};
  const locales = cfg.locales || {};

  const expected = Object.keys(infoPlist)
    .filter((k) => k.endsWith("UsageDescription"))
    .sort();

  if (expected.length === 0) {
    problems.push("app.json ios.infoPlist declares no *UsageDescription keys");
    return problems;
  }
  if (Object.keys(locales).length === 0) {
    problems.push("app.json declares no expo.locales, so no permission prompt is localized");
    return problems;
  }

  for (const [lang, relPath] of Object.entries(locales)) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) {
      problems.push(`${lang}: ${relPath} is missing`);
      continue;
    }
    let ios;
    try {
      ios = (JSON.parse(fs.readFileSync(abs, "utf8")) || {}).ios;
    } catch (err) {
      problems.push(`${lang}: ${relPath} is not valid JSON (${err.message})`);
      continue;
    }
    if (!ios || typeof ios !== "object") {
      problems.push(`${lang}: ${relPath} has no "ios" object`);
      continue;
    }
    const have = new Set(Object.keys(ios));
    const absent = expected.filter((k) => !have.has(k));
    const extra = [...have].filter((k) => !expected.includes(k)).sort();
    if (absent.length > 0) {
      problems.push(`${lang}: ${relPath} is missing ${absent.join(", ")}`);
    }
    if (extra.length > 0) {
      problems.push(
        `${lang}: ${relPath} translates ${extra.join(", ")}, which app.json ios.infoPlist does not declare`
      );
    }
    for (const key of expected) {
      if (have.has(key) && String(ios[key]).trim() === "") {
        problems.push(`${lang}: ${relPath} has an empty ${key}`);
      }
    }
  }
  return problems;
}

// Static t("...") / t('...') / i18n.t("...") keys. Skips template literals.
const CALL_RE = /(?:\bi18n)?\.?\bt\(\s*(["'])([A-Za-z0-9_.]+)\1/g;

const schema = loadSchemaKeys();
const missing = new Map(); // key -> [file:line]

for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of listSourceFiles(abs)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      let m;
      CALL_RE.lastIndex = 0;
      while ((m = CALL_RE.exec(line)) !== null) {
        const key = m[2];
        if (!key.includes(".")) continue; // bare identifiers are not i18n keys
        if (!schema.has(key)) {
          if (!missing.has(key)) missing.set(key, []);
          missing.get(key).push(`${rel}:${i + 1}`);
        }
      }
    });
  }
}

const nativeProblems = checkIosLocales();

if (missing.size > 0) {
  console.error(`i18n-check: ${missing.size} missing key(s):`);
  for (const [key, locs] of missing) {
    console.error(`  ${key}  <-  ${locs.join(", ")}`);
  }
}

if (nativeProblems.length > 0) {
  console.error(`i18n-check: ${nativeProblems.length} native permission string problem(s):`);
  for (const line of nativeProblems) console.error(`  ${line}`);
}

if (missing.size === 0 && nativeProblems.length === 0) {
  console.log(
    `i18n-check: OK (${schema.size} schema keys, no missing static t() keys, ios-locales match app.json)`
  );
  process.exit(0);
}
process.exit(1);
