/**
 * Regulation-language lint: zerospike is a diabetes journal, not a medical
 * device, and store review rejects copy that reads like one (alerts,
 * diagnosis, treatment, dosing advice). This scans every translated string
 * value (not key names) in lib/i18n/locales/*.ts for a per-language list of
 * banned words/phrases and reports every hit; it does not auto-fix or
 * auto-exempt anything, since only a human can judge whether a hit is real
 * regulatory language or a false positive (e.g. "alarm" used for the
 * reminder-ringing feature). Run via `npm run reg:check`.
 *
 * It also scans the local store copy that ships: zerospike-store/aso/<locale>.md,
 * aso-android/<locale>.md and the newest google-play-extras/whats-new-<version>.md.
 * That folder is gitignored, so CI does not have it and skips it silently. The
 * notes, research and check logs beside those files quote banned wording on
 * purpose and are not scanned. fastlane/metadata/<store locale>/*.txt (App Store)
 * and fastlane/metadata/android/<play locale>/{title,short_description,
 * full_description}.txt plus changelogs/*.txt are scanned the same way, for every
 * locale directory present (en-AU, en-CA included); a directory name maps to its
 * language by the part before the first "-" (en-AU -> en, es-419 -> es). That
 * folder is gitignored too, so CI skips it silently. A hit there is excused by a
 * "fastlane/metadata/<dir>/<file>.txt#<sentence>" key. The scanned files mix languages (English notes
 * next to the translated copy), so every line is checked against every locale's
 * list, and a hit is excused only by a
 * "zerospike-store/<dir>/<file>.md#<sentence>" key in reg-allowlist.json: the
 * matched text must sit inside that sentence, so a banned phrase added next to
 * it is still reported.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "lib/i18n/locales");
const STORE_DIR = path.join(ROOT, "zerospike-store");
const STORE_KEY_PREFIX = "zerospike-store/";
const METADATA_DIR = path.join(ROOT, "fastlane/metadata");
const METADATA_KEY_PREFIX = "fastlane/metadata/";

const {
  LOCALES,
  PATTERNS,
  SUBSTRING_LOCALES,
  KEY_EXEMPTIONS,
  isKeyExempt,
  anchorSpans,
  insideSpans,
  validateAllowlist,
  loadAllowlist,
  buildAllMatcher,
  contextOk,
  googleDisclosureSpans,
} = require("./regRules");

function scanLocaleEntries(locale, entries, opts = {}) {
  const patterns = opts.patterns || PATTERNS[locale] || [];
  const allowlist = opts.allowlist || {};
  const exemptions = opts.exemptions || KEY_EXEMPTIONS;
  const substringMode = SUBSTRING_LOCALES.has(locale);
  const allowAnchors = validateAllowlist(allowlist);
  const matchers = patterns.map((entry) => ({
    pattern: entry.pattern,
    entry,
    all: buildAllMatcher(entry.pattern, substringMode, { locale, except: entry.except }),
  }));
  const findings = [];
  let excused = 0;
  for (const [key, value] of entries) {
    const allowSpans = allowAnchors.has(`${locale}.${key}`)
      ? anchorSpans(locale, value, allowAnchors.get(`${locale}.${key}`))
      : [];
    for (const { pattern, entry, all } of matchers) {
      const hits = all(value);
      if (hits.length === 0) continue;
      if (!contextOk(entry, value, locale)) continue;
      for (const { index, length } of hits) {
        if (insideSpans(allowSpans, index, length) || isKeyExempt(exemptions, locale, key, value, index, length)) {
          excused++;
          continue;
        }
        findings.push({ locale, key, pattern, excerpt: excerpt(value, index, length) });
      }
    }
  }
  return { findings, excused };
}

function loadLocaleEntries(locale) {
  const file = path.join(LOCALES_DIR, `${locale}.ts`);
  const src = fs.readFileSync(file, "utf8");
  const re = new RegExp(
    `const ${locale}(?::[^=]+)?\\s*=\\s*(\\{[\\s\\S]*\\});\\s*export default ${locale};`
  );
  const m = src.match(re);
  if (!m) throw new Error(`Could not parse the translation object from ${locale}.ts`);
  // Locale files are our own trusted source; eval is safe here.
  // eslint-disable-next-line no-eval
  const obj = eval("(" + m[1] + ")");
  const entries = [];
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") walk(v, key);
      else if (typeof v === "string") entries.push([key, v]);
    }
  };
  walk(obj, "");
  return entries;
}

function excerpt(text, index, matchLen) {
  const WINDOW = 60;
  const pad = Math.floor((WINDOW - matchLen) / 2);
  let start = Math.max(0, index - pad);
  let end = Math.min(text.length, start + WINDOW);
  start = Math.max(0, end - WINDOW);
  const slice = text.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + slice + suffix;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// whats-new-<version>.md with the highest version. The watch app's notes
// (whats-new-wear-<version>.md) do not match the pattern, so they never win.
function newestWhatsNew(dir) {
  let best = null;
  for (const name of fs.readdirSync(dir)) {
    const m = /^whats-new-(\d+(?:\.\d+)*)\.md$/.exec(name);
    if (!m) continue;
    const version = m[1].split(".").map(Number);
    if (!best || compareVersions(version, best.version) > 0) best = { name, version };
  }
  return best ? best.name : null;
}

function listStoreFiles() {
  const files = [];
  const add = (sub, name) => {
    const abs = path.join(STORE_DIR, sub, name);
    const stat = fs.statSync(abs, { throwIfNoEntry: false });
    if (stat && stat.isFile()) files.push({ abs, key: `${STORE_KEY_PREFIX}${sub}/${name}` });
  };
  for (const sub of ["aso", "aso-android"]) {
    for (const locale of LOCALES) add(sub, `${locale}.md`);
  }
  const extras = path.join(STORE_DIR, "google-play-extras");
  const extrasStat = fs.statSync(extras, { throwIfNoEntry: false });
  const whatsNew = extrasStat && extrasStat.isDirectory() ? newestWhatsNew(extras) : null;
  if (whatsNew) add("google-play-extras", whatsNew);
  return files;
}

// Directory name -> language code of PATTERNS ("en-AU" -> "en", "ar" -> "ar", "it" -> "it").
function metadataLocale(dirName) {
  const lang = dirName.split("-")[0];
  return LOCALES.includes(lang) ? lang : null;
}

// App Store text files in fastlane/metadata/<locale>/ and Play text files in
// fastlane/metadata/android/<locale>/ (+ changelogs/). Images and other
// binaries are never opened.
function listMetadataFiles() {
  const files = [];
  const dirStat = fs.statSync(METADATA_DIR, { throwIfNoEntry: false });
  if (!dirStat || !dirStat.isDirectory()) return files;
  const addDir = (relDir, own) => {
    const abs = path.join(METADATA_DIR, relDir);
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isDirectory()) return;
    for (const name of fs.readdirSync(abs).sort()) {
      if (!name.endsWith(".txt")) continue;
      const file = path.join(abs, name);
      if (fs.statSync(file).isFile()) {
        files.push({ abs: file, key: `${METADATA_KEY_PREFIX}${relDir}/${name}`, own });
      }
    }
  };
  for (const name of fs.readdirSync(METADATA_DIR).sort()) {
    if (name === "android") continue;
    const own = metadataLocale(name);
    if (own) addDir(name, own);
  }
  const androidDir = path.join(METADATA_DIR, "android");
  const androidStat = fs.statSync(androidDir, { throwIfNoEntry: false });
  if (androidStat && androidStat.isDirectory()) {
    for (const name of fs.readdirSync(androidDir).sort()) {
      const own = metadataLocale(name);
      if (!own) continue;
      addDir(`android/${name}`, own);
      addDir(`android/${name}/changelogs`, own);
    }
  }
  return files;
}

// "<prefix><dir>/<file>#<sentence>" -> Map(file key -> sentences).
function loadStoreAnchors(allowlist) {
  const byFile = new Map();
  for (const entry of Object.keys(allowlist)) {
    if (!entry.startsWith(STORE_KEY_PREFIX) && !entry.startsWith(METADATA_KEY_PREFIX)) continue;
    const hash = entry.indexOf("#");
    if (hash === -1 || hash === entry.length - 1) {
      throw new Error(
        `reg-allowlist.json: "${entry}" must look like "${STORE_KEY_PREFIX}<dir>/<file>.md#<sentence>" or "${METADATA_KEY_PREFIX}<dir>/<file>.txt#<sentence>"`
      );
    }
    const file = entry.slice(0, hash);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(entry.slice(hash + 1));
  }
  return byFile;
}

// True when the matched text lies wholly inside an occurrence of an allowlisted sentence.
function insideAnchor(anchors, line, index, length) {
  for (const anchor of anchors) {
    for (let at = line.indexOf(anchor); at !== -1; at = line.indexOf(anchor, at + 1)) {
      if (index >= at && index + length <= at + anchor.length) return true;
    }
  }
  return false;
}

function scanStore(allowlist, findings) {
  const files = [...listStoreFiles(), ...listMetadataFiles()];
  if (files.length === 0) return { files: 0, excused: 0 };
  const anchorsByFile = loadStoreAnchors(allowlist);
  const matchers = LOCALES.map((locale) => ({
    locale,
    list: (PATTERNS[locale] || []).map((entry) => ({
      pattern: entry.pattern,
      entry,
      all: buildAllMatcher(entry.pattern, SUBSTRING_LOCALES.has(locale), { locale, except: entry.except }),
    })),
  }));
  let excused = 0;
  for (const file of files) {
    const { abs, key } = file;
    // The file's own language goes first so a word several languages share is
    // reported once, under that language.
    const own = file.own || path.basename(abs, ".md");
    const ordered = [...matchers.filter((m) => m.locale === own), ...matchers.filter((m) => m.locale !== own)];
    const anchors = anchorsByFile.get(key) || [];
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const seen = new Set();
      const disclosure = googleDisclosureSpans(own, line);
      for (const { locale, list } of ordered) {
        for (const { pattern, entry, all } of list) {
          for (const { index, length } of all(line)) {
            const span = `${index}:${length}`;
            if (seen.has(span)) continue;
            if (!contextOk(entry, line, locale)) continue;
            seen.add(span);
            if (insideAnchor(anchors, line, index, length) || insideSpans(disclosure, index, length)) {
              excused++;
              continue;
            }
            findings.push({
              locale,
              key: `${key}:${i + 1}`,
              pattern,
              excerpt: excerpt(line, index, length),
            });
          }
        }
      }
    });
  }
  return { files: files.length, excused };
}

function main() {
  const allowlist = loadAllowlist();
  const findings = [];
  let excusedCount = 0;

  for (const locale of LOCALES) {
    const result = scanLocaleEntries(locale, loadLocaleEntries(locale), { allowlist });
    findings.push(...result.findings);
    excusedCount += result.excused;
  }

  const store = scanStore(allowlist, findings);
  excusedCount += store.excused;
  const storeNote = store.files > 0 ? `, ${store.files} magaza ve metadata dosyasi` : "";

  if (findings.length === 0) {
    console.log(
      `reg-check: OK (${LOCALES.length} locale${storeNote}, 0 bulgu${
        excusedCount > 0 ? `, ${excusedCount} allowlist istisnasi` : ""
      })`
    );
    process.exit(0);
  }

  console.error(`reg-check: ${findings.length} bulgu`);
  for (const f of findings) {
    console.error(`  [${f.locale}] ${f.key}  <-  "${f.pattern}"`);
    console.error(`    ${f.excerpt}`);
  }

  const byLocale = {};
  for (const f of findings) byLocale[f.locale] = (byLocale[f.locale] || 0) + 1;
  console.error(
    `Toplam: ${findings.length} bulgu (${Object.entries(byLocale)
      .map(([l, c]) => `${l}:${c}`)
      .join(", ")})${excusedCount > 0 ? `, ${excusedCount} allowlist istisnasi` : ""}`
  );

  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  PATTERNS,
  KEY_EXEMPTIONS,
  scanLocaleEntries,
  loadLocaleEntries,
  LOCALES,
  metadataLocale,
  listMetadataFiles,
};
