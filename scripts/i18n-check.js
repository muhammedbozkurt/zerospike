/**
 * i18n key audit: every STATIC t("...") / i18n.t("...") key used in the app must
 * exist in the translation schema (lib/i18n/locales/tr.ts). Locale-to-locale
 * parity is already enforced by TypeScript (each locale is typed as
 * TranslationSchema = typeof tr), but TS does NOT check that a t() call-site key
 * actually exists in the schema, so a typo or wrong namespace (e.g.
 * "common.continue" when the key lives under "onboarding") ships as a raw key.
 * This script closes that gap. Dynamic keys (template literals with ${...}) are
 * skipped; run it in CI via `npm run i18n:check`.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_FILE = path.join(ROOT, "lib/i18n/locales/tr.ts");
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

if (missing.size === 0) {
  console.log(`i18n-check: OK (${schema.size} schema keys, no missing static t() keys)`);
  process.exit(0);
}

console.error(`i18n-check: ${missing.size} missing key(s):`);
for (const [key, locs] of missing) {
  console.error(`  ${key}  <-  ${locs.join(", ")}`);
}
process.exit(1);
