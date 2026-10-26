/**
 * Regulation-language rules, shared by scripts/reg-check.js (the CLI) and the
 * store screenshot pipeline's selftests (zerospike-store/pipeline/v2/selftest-*.mjs),
 * so neither has to cut this source apart. No side effects on require.
 */
const fs = require("fs");
const path = require("path");

const ALLOWLIST_FILE = path.join(__dirname, "reg-allowlist.json");

const LOCALES = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];

// ar and ja have no useful Latin-style word boundary; match them as raw
// substrings instead of trying to apply \p{L} boundary lookarounds.
const SUBSTRING_LOCALES = new Set(["ar", "ja"]);

// Turkish inflects by suffix and its dotted/dotless I does not fold under JS
// /i ("I" -> "ı" only in the tr locale), so tr patterns are stems ("alarm*" also
// catches "alarmı", "alarmlar") and tr text is lower-cased with the tr locale
// before matching. `except` lists letters that, right after the stem, mark an
// innocent word ("tanı*" must not flag "tanım", "tanıtım", "tanıdık").
//
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
    { pattern: "alarm*", requiresContext: true },
    { pattern: "uyarır*" },
    { pattern: "uyaracak*" },
    { pattern: "sizi uyar*" },
    { pattern: "uyar*", except: ["l"], requiresContext: true },
    { pattern: "tanı koy*" },
    { pattern: "tanı*", except: ["m", "t", "d", "ş"] },
    { pattern: "teşhis*" },
    { pattern: "tedavi*", requiresContext: true },
    { pattern: "tedavi eder*" },
    { pattern: "tedavi öner*" },
    { pattern: "tedavi planı*" },
    { pattern: "tedavinizi belirler" },
    { pattern: "önerilen doz*" },
    { pattern: "doz öner*" },
    { pattern: "tavsiye edilen doz*" },
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
  "şeker*",
  "glisemi*",
  "glikoz*",
  "hipo*",
  "hiper*",
  "düşük*",
  "yüksek*",
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

// Narrow, reasoned exemptions for locale strings. An entry excuses a hit only
// when ALL hold: same locale, exact key path, and the matched text contains one
// of `terms`. The same word under any other key is still a finding, and so is
// any other banned phrase inside the excused key. `reason` is mandatory and is
// printed with the excused count so the exemption stays auditable. Store copy
// (aso, fastlane) gets no exemption here; it uses reg-allowlist.json anchors.
//
// Today the pattern list above has no bare "tedavi"/"tanı"/"treatment"
// entries, so these keys do not trigger a finding yet. The table documents the
// accepted wording and keeps those keys safe if a pattern ever widens.
const DISCLAIMER_REASON =
  "Medical disclaimer sentence (consult your doctor for treatment decisions): present since the first commit and accepted by store review; the banned word is allowed only in this disclaimer context";
const NO_DIAGNOSIS_REASON =
  "Onboarding diabetes-type option for people without a diagnosis (diagnosis-free tracking path); a user-chosen label, not diagnostic language";

const DISCLAIMER_TERMS = {
  en: ["treatment"],
  tr: ["tedavi"],
  de: ["behandlung"],
  fr: ["traitement"],
  es: ["tratamiento"],
  it: ["terap"],
  pt: ["tratamento"],
  ar: ["علاج"],
  ja: ["治療"],
};
const NO_DIAGNOSIS_TERMS = {
  en: ["diagnosis"],
  tr: ["tanı"],
  de: ["diagnose"],
  fr: ["diagnostic"],
  es: ["diagnóstico"],
  it: ["diagnosi"],
  pt: ["diagnóstico"],
  ar: ["تشخيص"],
  ja: ["診断"],
};

const KEY_EXEMPTIONS = LOCALES.flatMap((locale) => [
  ...["disclaimer.body", "disclaimer.short"].map((key) => ({
    locale,
    key,
    terms: DISCLAIMER_TERMS[locale],
    reason: DISCLAIMER_REASON,
  })),
  {
    locale,
    key: "onboarding.diabetes_none",
    terms: NO_DIAGNOSIS_TERMS[locale],
    reason: NO_DIAGNOSIS_REASON,
  },
]);

function isKeyExempt(exemptions, locale, key, matchedText) {
  const lower = matchedText.toLowerCase();
  return exemptions.some(
    (e) =>
      e.locale === locale &&
      e.key === key &&
      typeof e.reason === "string" &&
      e.reason.length > 0 &&
      e.terms.some((t) => lower.includes(t.toLowerCase()))
  );
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return {};
  const raw = fs.readFileSync(ALLOWLIST_FILE, "utf8").trim();
  if (raw === "") return {};
  return JSON.parse(raw);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Unicode-aware word boundary: \b in JS only knows [A-Za-z0-9_], so it
// misfires around every accented/Turkish/German letter. Lookaround against
// \p{L}/\p{N} instead. A trailing "*" in a pattern is a stem (e.g.
// "diagnos*"), so it drops the right-hand boundary check.
function foldTr(locale, text) {
  return locale === "tr" ? text.toLocaleLowerCase("tr") : text;
}

function latinRegExp(pattern, flags, opts = {}) {
  const wildcard = pattern.endsWith("*");
  const base = foldTr(opts.locale, wildcard ? pattern.slice(0, -1) : pattern);
  const left = "(?<![\\p{L}\\p{N}_])";
  const right = wildcard ? "" : "(?![\\p{L}\\p{N}_])";
  const except =
    opts.except && opts.except.length
      ? `(?!${opts.except.map((x) => escapeRegExp(foldTr(opts.locale, x))).join("|")})`
      : "";
  return new RegExp(left + escapeRegExp(base) + except + right, flags);
}

// opts: { locale, except }. For tr the text is folded first; folding keeps the
// string length, so match indexes still point into the original text.
function buildLatinMatcher(pattern, opts = {}) {
  const re = latinRegExp(pattern, "iu", opts);
  return (text) => re.exec(foldTr(opts.locale, text));
}

function buildSubstringMatcher(pattern) {
  return (text) => {
    const idx = text.indexOf(pattern);
    return idx === -1 ? null : { index: idx, 0: pattern };
  };
}

// Every occurrence in a line, not just the first: the store scan excuses a hit
// by position, so a second occurrence must not hide behind an excused first one.
function buildAllMatcher(pattern, substringMode, opts = {}) {
  if (substringMode) {
    return (text) => {
      const hits = [];
      for (let i = text.indexOf(pattern); i !== -1; i = text.indexOf(pattern, i + pattern.length)) {
        hits.push({ index: i, length: pattern.length });
      }
      return hits;
    };
  }
  const re = latinRegExp(pattern, "giu", opts);
  return (text) =>
    Array.from(foldTr(opts.locale, text).matchAll(re), (m) => ({ index: m.index, length: m[0].length }));
}

const contextMatchers = [
  ...CONTEXT_TERMS_LATIN.map((t) => buildLatinMatcher(t)),
  ...CONTEXT_TERMS_SUBSTR.map((t) => buildSubstringMatcher(t)),
];
const trContextMatchers = CONTEXT_TERMS_LATIN.map((t) => buildLatinMatcher(t, { locale: "tr" }));
function hasGlucoseContext(text, locale) {
  if (contextMatchers.some((match) => match(text) !== null)) return true;
  return locale === "tr" && trContextMatchers.some((match) => match(text) !== null);
}

module.exports = {
  LOCALES,
  PATTERNS,
  SUBSTRING_LOCALES,
  KEY_EXEMPTIONS,
  ALLOWLIST_FILE,
  isKeyExempt,
  loadAllowlist,
  buildLatinMatcher,
  buildSubstringMatcher,
  buildAllMatcher,
  hasGlucoseContext,
};
