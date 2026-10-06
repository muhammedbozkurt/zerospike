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
 * purpose and are not scanned. The scanned files mix languages (English notes
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
const ALLOWLIST_FILE = path.join(__dirname, "reg-allowlist.json");
const STORE_DIR = path.join(ROOT, "zerospike-store");
const STORE_KEY_PREFIX = "zerospike-store/";

const LOCALES = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];

// ar and ja have no useful Latin-style word boundary; match them as raw
// substrings instead of trying to apply \p{L} boundary lookarounds.
const SUBSTRING_LOCALES = new Set(["ar", "ja"]);

// requiresContext: true means the pattern is only a finding when the SAME
// string also contains a glucose-context term (CONTEXT_TERMS below). This
// keeps the "alarm/alert" family from flagging the reminder-ringing feature
// (Health Connect declared, store-legal) while still catching it next to
// glucose wording. Verb phrases that already imply the app diagnoses,
// treats, doses, or warns/alerts about glucose are specific enough to
// always count.
const PATTERNS = {
  en: [
    { pattern: "alarm", requiresContext: true },
    { pattern: "alert", requiresContext: true },
    { pattern: "alerts you" },
    { pattern: "warns you" },
    { pattern: "will alert" },
    { pattern: "will warn" },
    { pattern: "diagnoses" },
    { pattern: "can diagnose" },
    { pattern: "diagnose you" },
    { pattern: "treat your" },
    { pattern: "treatment plan for you" },
    { pattern: "treats" },
    { pattern: "recommended dose" },
    { pattern: "suggested dose" },
    { pattern: "dose recommendation" },
    { pattern: "insulin recommendation" },
    { pattern: "you should inject" },
    { pattern: "take X units" },
  ],
  tr: [
    { pattern: "alarm", requiresContext: true },
    { pattern: "uyarır" },
    { pattern: "uyaracak" },
    { pattern: "sizi uyar" },
    { pattern: "tanı koyar" },
    { pattern: "teşhis eder" },
    { pattern: "tanı koyabilir" },
    { pattern: "tedavi eder" },
    { pattern: "tedavinizi belirler" },
    { pattern: "tedavi önerisi" },
    { pattern: "önerilen doz" },
    { pattern: "doz öner*" },
    { pattern: "tavsiye edilen doz" },
    { pattern: "yapmalısınız" },
    { pattern: "uygulamanız gereken" },
  ],
  de: [
    { pattern: "Alarm", requiresContext: true },
    { pattern: "warnt Sie" },
    { pattern: "alarmiert Sie" },
    { pattern: "diagnostiziert" },
    { pattern: "behandelt Sie" },
    { pattern: "Behandlungsempfehlung" },
    { pattern: "empfohlene Dosis" },
    { pattern: "Dosisempfehlung" },
    { pattern: "sollten Sie spritzen" },
  ],
  fr: [
    { pattern: "alerte", requiresContext: true },
    { pattern: "alarme", requiresContext: true },
    { pattern: "vous alerte" },
    { pattern: "vous avertit" },
    { pattern: "diagnostique" },
    { pattern: "traite votre" },
    { pattern: "recommandation de traitement" },
    { pattern: "dose recommandée" },
    { pattern: "dose conseillée" },
    { pattern: "vous devriez injecter" },
  ],
  es: [
    { pattern: "alarma", requiresContext: true },
    { pattern: "le alerta" },
    { pattern: "le avisa" },
    { pattern: "diagnostica" },
    { pattern: "trata su" },
    { pattern: "recomendación de tratamiento" },
    { pattern: "dosis recomendada" },
    { pattern: "dosis sugerida" },
    { pattern: "debería inyectar" },
  ],
  it: [
    { pattern: "allarme", requiresContext: true },
    { pattern: "La avvisa" },
    { pattern: "La allerta" },
    { pattern: "diagnostica" },
    { pattern: "tratta la Sua" },
    { pattern: "raccomandazione di trattamento" },
    { pattern: "dose consigliata" },
    { pattern: "dose raccomandata" },
  ],
  pt: [
    { pattern: "alarme", requiresContext: true },
    { pattern: "alerta você" },
    { pattern: "avisa você" },
    { pattern: "diagnostica" },
    { pattern: "trata sua" },
    { pattern: "recomendação de tratamento" },
    { pattern: "dose recomendada" },
    { pattern: "dose sugerida" },
  ],
  ar: [
    { pattern: "تنبيه", requiresContext: true },
    { pattern: "إنذار", requiresContext: true },
    { pattern: "ينبهك" },
    { pattern: "يحذرك" },
    { pattern: "يشخص" },
    { pattern: "يعالج" },
    { pattern: "توصية علاجية" },
    { pattern: "الجرعة الموصى بها" },
  ],
  ja: [
    { pattern: "アラーム", requiresContext: true },
    { pattern: "警報", requiresContext: true },
    { pattern: "警告します", requiresContext: true },
    { pattern: "お知らせします", requiresContext: true },
    { pattern: "診断します" },
    { pattern: "治療します" },
    { pattern: "治療を推奨" },
    { pattern: "推奨用量" },
    { pattern: "推奨量" },
  ],
};

// Glucose-context terms: a requiresContext pattern only counts when one of
// these also appears in the same string. Applied as one flat multilingual
// list regardless of the locale being scanned.
const CONTEXT_TERMS_LATIN = [
  "glucose",
  "sugar",
  "hypo",
  "hyper",
  "low",
  "high",
  "mg/dL",
  "mmol",
  "şeker",
  "hipo",
  "hiper",
  "düşük",
  "yüksek",
  "Blutzucker",
  "Unterzucker",
  "Überzucker",
  "glycémie",
  "hypoglycémie",
  "hyperglycémie",
  "glucosa",
  "hipoglucemia",
  "glicemia",
  "ipoglicemia",
  "iperglicemia",
  "glicose",
  "hipoglicemia",
  "hiperglicemia",
];
const CONTEXT_TERMS_SUBSTR = ["سكر", "血糖", "低血糖", "高血糖"];

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return {};
  const raw = fs.readFileSync(ALLOWLIST_FILE, "utf8").trim();
  if (raw === "") return {};
  return JSON.parse(raw);
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Unicode-aware word boundary: \b in JS only knows [A-Za-z0-9_], so it
// misfires around every accented/Turkish/German letter. Lookaround against
// \p{L}/\p{N} instead. A trailing "*" in a pattern is a stem (e.g.
// "diagnos*"), so it drops the right-hand boundary check.
function latinRegExp(pattern, flags) {
  const wildcard = pattern.endsWith("*");
  const base = wildcard ? pattern.slice(0, -1) : pattern;
  const left = "(?<![\\p{L}\\p{N}_])";
  const right = wildcard ? "" : "(?![\\p{L}\\p{N}_])";
  return new RegExp(left + escapeRegExp(base) + right, flags);
}

function buildLatinMatcher(pattern) {
  const re = latinRegExp(pattern, "iu");
  return (text) => re.exec(text);
}

function buildSubstringMatcher(pattern) {
  return (text) => {
    const idx = text.indexOf(pattern);
    return idx === -1 ? null : { index: idx, 0: pattern };
  };
}

// Every occurrence in a line, not just the first: the store scan excuses a hit
// by position, so a second occurrence must not hide behind an excused first one.
function buildAllMatcher(pattern, substringMode) {
  if (substringMode) {
    return (text) => {
      const hits = [];
      for (let i = text.indexOf(pattern); i !== -1; i = text.indexOf(pattern, i + pattern.length)) {
        hits.push({ index: i, length: pattern.length });
      }
      return hits;
    };
  }
  const re = latinRegExp(pattern, "giu");
  return (text) => Array.from(text.matchAll(re), (m) => ({ index: m.index, length: m[0].length }));
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

const contextMatchers = [
  ...CONTEXT_TERMS_LATIN.map((t) => buildLatinMatcher(t)),
  ...CONTEXT_TERMS_SUBSTR.map((t) => buildSubstringMatcher(t)),
];
function hasGlucoseContext(text) {
  return contextMatchers.some((match) => match(text) !== null);
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

// "zerospike-store/<dir>/<file>.md#<sentence>" -> Map(file key -> sentences).
function loadStoreAnchors(allowlist) {
  const byFile = new Map();
  for (const entry of Object.keys(allowlist)) {
    if (!entry.startsWith(STORE_KEY_PREFIX)) continue;
    const hash = entry.indexOf("#");
    if (hash === -1 || hash === entry.length - 1) {
      throw new Error(
        `reg-allowlist.json: "${entry}" must look like "${STORE_KEY_PREFIX}<dir>/<file>.md#<sentence>"`
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
  const files = listStoreFiles();
  if (files.length === 0) return { files: 0, excused: 0 };
  const anchorsByFile = loadStoreAnchors(allowlist);
  const matchers = LOCALES.map((locale) => ({
    locale,
    list: (PATTERNS[locale] || []).map(({ pattern, requiresContext }) => ({
      pattern,
      requiresContext: !!requiresContext,
      all: buildAllMatcher(pattern, SUBSTRING_LOCALES.has(locale)),
    })),
  }));
  let excused = 0;
  for (const { abs, key } of files) {
    // The file's own language goes first so a word several languages share is
    // reported once, under that language.
    const own = path.basename(abs, ".md");
    const ordered = [...matchers.filter((m) => m.locale === own), ...matchers.filter((m) => m.locale !== own)];
    const anchors = anchorsByFile.get(key) || [];
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const seen = new Set();
      for (const { locale, list } of ordered) {
        for (const { pattern, requiresContext, all } of list) {
          for (const { index, length } of all(line)) {
            const span = `${index}:${length}`;
            if (seen.has(span)) continue;
            if (requiresContext && !hasGlucoseContext(line)) continue;
            seen.add(span);
            if (insideAnchor(anchors, line, index, length)) {
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

const allowlist = loadAllowlist();
const findings = [];
let excusedCount = 0;

for (const locale of LOCALES) {
  const entries = loadLocaleEntries(locale);
  const patterns = PATTERNS[locale] || [];
  const substringMode = SUBSTRING_LOCALES.has(locale);
  const matchers = patterns.map(({ pattern, requiresContext }) => ({
    pattern,
    requiresContext: !!requiresContext,
    match: substringMode ? buildSubstringMatcher(pattern) : buildLatinMatcher(pattern),
  }));

  for (const [key, value] of entries) {
    for (const { pattern, requiresContext, match } of matchers) {
      const m = match(value);
      if (!m) continue;
      if (requiresContext && !hasGlucoseContext(value)) continue;
      const allowKey = `${locale}.${key}`;
      if (Object.prototype.hasOwnProperty.call(allowlist, allowKey)) {
        excusedCount++;
        continue;
      }
      findings.push({
        locale,
        key,
        pattern,
        excerpt: excerpt(value, m.index, m[0].length),
      });
    }
  }
}

const store = scanStore(allowlist, findings);
excusedCount += store.excused;
const storeNote = store.files > 0 ? `, ${store.files} magaza dosyasi` : "";

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
