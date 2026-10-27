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
    { pattern: "real-time" },
    { pattern: "real time" },
    { pattern: "realtime" },
    { pattern: "live glucose" },
    { pattern: "hypoglycemic event*" },
    { pattern: "hypoglycemia event*" },
    { pattern: "hyperglycemic event*" },
    { pattern: "hypo event*" },
    { pattern: "live cgm" },
    { pattern: "live sensor" },
    { pattern: "live blood sugar" },
    { pattern: "live sugar", except: ["-"] },
    { pattern: "detects hypoglyc*" },
    { pattern: "detects hypos" },
    { pattern: "detects hyperglyc*" },
    { pattern: "detects hypers" },
    { pattern: "detects low glucose" },
    { pattern: "detects high glucose" },
    { pattern: "detects low blood sugar" },
    { pattern: "detects high blood sugar" },
  ],
  tr: [
    { pattern: "alarm*", requiresContext: true },
    { pattern: "uyarır*" },
    { pattern: "uyaracak*" },
    { pattern: "sizi uyar*" },
    { pattern: "uyar*", except: ["l"], requiresContext: true },
    { pattern: "tanı koy*" },
    { pattern: "tanı*", except: ["m", "t", "dık", "dığ", "ş", "yın", "yan", "yor", "nmış", "nan", "nma", "r"] },
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
    { pattern: "gerçek zamanlı" },
    { pattern: "canlı şeker*" },
    { pattern: "anlık şeker*" },
    { pattern: "canlı kan şeker*" },
    { pattern: "anlık kan şeker*" },
    { pattern: "hipoglisemi olay*" },
    { pattern: "hipoglisemik olay*" },
    { pattern: "hiperglisemi olay*" },
    { pattern: "hipoglisemi atak*" },
    { pattern: "anlık olarak", requiresContext: true },
    { pattern: "hipoglisemiyi algıl*" },
    { pattern: "hiperglisemiyi algıl*" },
    { pattern: "hipoglisemi algıl*" },
    { pattern: "hiperglisemi algıl*" },
    { pattern: "hipoglisemiyi tespit*" },
    { pattern: "hiperglisemiyi tespit*" },
    { pattern: "hipoglisemi tespit*" },
    { pattern: "hiperglisemi tespit*" },
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
    { pattern: "Echtzeit*" },
    { pattern: "Live-Glukose*" },
    { pattern: "Live-Blutzucker*" },
    { pattern: "Unterzuckerungsereignis*" },
    { pattern: "Hypoglykämie-Ereignis*" },
    { pattern: "hypoglykämisches Ereignis" },
    { pattern: "hypoglykämische Ereignisse" },
    { pattern: "erkennt Unterzucker*" },
    { pattern: "erkennt Überzucker*" },
    { pattern: "erkennt Hypoglyk*" },
    { pattern: "erkennt Hyperglyk*" },
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
    { pattern: "temps réel" },
    { pattern: "en direct", requiresContext: true },
    { pattern: "événement hypoglycémique" },
    { pattern: "événements hypoglycémiques" },
    { pattern: "détecte les hypoglyc*" },
    { pattern: "détecte les hypos" },
    { pattern: "détecte les hyperglyc*" },
    { pattern: "détecte les hypers" },
    { pattern: "détecte l'hypoglyc*" },
    { pattern: "détecte l'hyperglyc*" },
    { pattern: "détecte l\u2019hypoglyc*" },
    { pattern: "détecte l\u2019hyperglyc*" },
    { pattern: "détecte une hypoglyc*" },
    { pattern: "détecte une hypos" },
    { pattern: "détecte une hyperglyc*" },
    { pattern: "détecte une hypers" },
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
    { pattern: "tiempo real" },
    { pattern: "en vivo", requiresContext: true },
    { pattern: "evento hipoglucémico" },
    { pattern: "eventos hipoglucémicos" },
    { pattern: "detecta hipogli*" },
    { pattern: "detecta hipoglu*" },
    { pattern: "detecta hipergli*" },
    { pattern: "detecta hiperglu*" },
    { pattern: "detecta las hipogli*" },
    { pattern: "detecta las hipoglu*" },
    { pattern: "detecta las hipergli*" },
    { pattern: "detecta las hiperglu*" },
    { pattern: "detecta la hipogli*" },
    { pattern: "detecta la hipoglu*" },
    { pattern: "detecta la hipergli*" },
    { pattern: "detecta la hiperglu*" },
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
    { pattern: "tempo reale" },
    { pattern: "in diretta", requiresContext: true },
    { pattern: "evento ipoglicemico" },
    { pattern: "eventi ipoglicemici" },
    { pattern: "rileva ipoglic*" },
    { pattern: "rileva iperglic*" },
    { pattern: "rileva le ipoglic*" },
    { pattern: "rileva le iperglic*" },
    { pattern: "rileva l'ipoglic*" },
    { pattern: "rileva l'iperglic*" },
    { pattern: "rileva l\u2019ipoglic*" },
    { pattern: "rileva l\u2019iperglic*" },
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
    { pattern: "tempo real" },
    { pattern: "ao vivo", requiresContext: true },
    { pattern: "evento hipoglicêmico" },
    { pattern: "eventos hipoglicêmicos" },
    { pattern: "detecta hipoglic*" },
    { pattern: "detecta hiperglic*" },
    { pattern: "detecta as hipoglic*" },
    { pattern: "detecta as hiperglic*" },
    { pattern: "detecta a hipoglic*" },
    { pattern: "detecta a hiperglic*" },
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
    { pattern: "الوقت الفعلي" },
    { pattern: "الوقت الحقيقي" },
    { pattern: "حدث نقص سكر" },
    { pattern: "نوبة نقص سكر" },
    { pattern: "يكتشف نقص" },
    { pattern: "يكتشف انخفاض" },
    { pattern: "يكتشف ارتفاع" },
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
    { pattern: "リアルタイム" },
    { pattern: "低血糖イベント" },
    { pattern: "低血糖発作" },
    { pattern: "低血糖を検知" },
    { pattern: "高血糖を検知" },
    { pattern: "低血糖を検出" },
    { pattern: "高血糖を検出" },
    { pattern: "低血糖を察知" },
    { pattern: "高血糖を察知" },
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
  "hipogli*",
  "hipoglu*",
  "hipergli*",
  "hiperglu*",
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
  "sucre",
  "azúcar",
  "açúcar",
  "zucchero",
  "glucosio",
  "hipoglicemia",
  "hiperglicemia",
];
// "low"/"high" in Turkish also describe a battery or a volume ("düşük pil",
// "yüksek sesle"), so on their own they are not glucose context; they count
// only next to a word for a measured value.
const TR_WEAK_CONTEXT = ["düşük*", "yüksek*"];
const TR_WEAK_PARTNERS = ["değer*", "seviye*", "düzey*", "ölçüm*", "okuma*", "kan"];
const CONTEXT_TERMS_SUBSTR = ["سكر", "血糖", "低血糖", "高血糖"];

// Narrow, reasoned exemptions for locale strings. An entry excuses ONE match
// only when ALL hold: same locale, exact key path, and the matched text lies
// wholly inside an occurrence of one of `anchors` (a full phrase, compared
// case-insensitively) in that string. A second banned phrase in the same string,
// or the same word outside the anchor, is still a finding, so wording added
// next to an excused phrase never hides behind it. `reason` is mandatory and
// is printed with the excused count so the exemption stays auditable. Store
// copy (aso, fastlane) uses reg-allowlist.json anchors instead.
//
// Today the pattern list above has no bare "tedavi"/"tanı"/"treatment"
// entries, so the disclaimer and diagnosis keys do not trigger a finding yet.
// The table documents the accepted wording and keeps those keys safe if a
// pattern ever widens.
const DISCLAIMER_REASON =
  "Medical disclaimer sentence (consult your doctor for treatment decisions): present since the first commit and accepted by store review; the banned word is allowed only inside this exact sentence";
const NO_DIAGNOSIS_REASON =
  "Onboarding diabetes-type option for people without a diagnosis (diagnosis-free tracking path); a user-chosen label, not diagnostic language";
const LIVE_ACTIVITY_REASON =
  "The platform's own localized name of the iOS Live Activities feature (as shown in iOS settings); the words name a system feature, not a claim about glucose data";

const DISCLAIMER_ANCHORS = {
  en: ["Please consult your physician for any treatment decisions"],
  tr: ["Lütfen tedavi kararlarınız için doktorunuza danışınız"],
  de: [
    "Bitte wenden Sie sich bei allen Behandlungsentscheidungen an Ihre Ärztin oder Ihren Arzt",
    "Bitte wenden Sie sich bei Behandlungsentscheidungen an Ihre Ärztin oder Ihren Arzt",
  ],
  fr: ["Veuillez consulter votre médecin pour toute décision de traitement"],
  es: ["Por favor, consulte a su médico para cualquier decisión de tratamiento"],
  it: ["Per qualsiasi decisione terapeutica consulti il Suo medico"],
  pt: ["Consulte seu médico para qualquer decisão de tratamento"],
  ar: ["يرجى استشارة طبيبك في أي قرار يتعلق بالعلاج"],
  ja: ["治療に関する判断は主治医にご相談ください"],
};
const NO_DIAGNOSIS_ANCHORS = {
  en: ["No diagnosis"],
  tr: ["Tanı almadım"],
  de: ["Keine Diagnose"],
  fr: ["Aucun diagnostic"],
  es: ["Sin diagnóstico"],
  it: ["Nessuna diagnosi"],
  pt: ["Sem diagnóstico"],
  ar: ["بلا تشخيص"],
  ja: ["診断は受けていません"],
};
const LIVE_ACTIVITY_ANCHORS = {
  en: ["Live Activity", "Live Activities"],
  tr: ["Canlı Etkinlik"],
  de: ["Live-Aktivität"],
  fr: ["Activité en direct", "activités en direct"],
  es: ["Actividad en vivo", "Actividades en vivo"],
  it: ["Attività in tempo reale", "Attività Live"],
  pt: ["Atividade ao Vivo", "Atividades ao Vivo"],
  ar: ["النشاط المباشر", "الأنشطة المباشرة"],
  ja: ["ライブアクティビティ"],
};
const LIVE_ACTIVITY_KEYS = [
  "widgetGuide.postMealBodyAndroid",
  "widgetGuide.liveTitle",
  "widgetGuide.liveOn",
  "widgetGuide.liveOff",
  "scWidgets.liveActivity",
];

const KEY_EXEMPTIONS = LOCALES.flatMap((locale) => [
  ...["disclaimer.body", "disclaimer.short"].map((key) => ({
    locale,
    key,
    anchors: DISCLAIMER_ANCHORS[locale],
    reason: DISCLAIMER_REASON,
  })),
  {
    locale,
    key: "onboarding.diabetes_none",
    anchors: NO_DIAGNOSIS_ANCHORS[locale],
    reason: NO_DIAGNOSIS_REASON,
  },
  ...LIVE_ACTIVITY_KEYS.map((key) => ({
    locale,
    key,
    anchors: LIVE_ACTIVITY_ANCHORS[locale],
    reason: LIVE_ACTIVITY_REASON,
  })),
]);

// [start, end) spans of every occurrence of any anchor in `text`. Case-
// insensitive; tr text is folded first (length-preserving) so "I"/"ı" match.
function anchorSpans(locale, text, anchors) {
  const spans = [];
  const folded = foldTr(locale, text);
  for (const anchor of anchors) {
    const re = new RegExp(escapeRegExp(foldTr(locale, anchor)), "giu");
    for (const m of folded.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function insideSpans(spans, index, length) {
  return spans.some(([start, end]) => index >= start && index + length <= end);
}

function isKeyExempt(exemptions, locale, key, text, index, length) {
  return exemptions.some(
    (e) =>
      e.locale === locale &&
      e.key === key &&
      typeof e.reason === "string" &&
      e.reason.trim().length > 0 &&
      Array.isArray(e.anchors) &&
      insideSpans(anchorSpans(locale, text, e.anchors), index, length)
  );
}

const STORE_ENTRY_PREFIXES = ["zerospike-store/", "fastlane/metadata/"];

// Every allowlist entry is "<where>#<anchor>" with a non-empty reason. A locale
// entry is "<locale>.<key>#<anchor>" and excuses only matches inside the anchor.
// There is no whole-key escape: an entry without an anchor or a reason is an
// error. Returns Map("<locale>.<key>" -> anchors) for the locale entries.
function validateAllowlist(allowlist) {
  const byKey = new Map();
  for (const [entry, reason] of Object.entries(allowlist)) {
    const hash = entry.indexOf("#");
    if (hash === -1 || hash === entry.length - 1) {
      throw new Error(`reg-allowlist.json: "${entry}" needs an anchor: "<where>#<phrase>"`);
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error(`reg-allowlist.json: "${entry}" needs a non-empty reason`);
    }
    if (STORE_ENTRY_PREFIXES.some((p) => entry.startsWith(p))) continue;
    const where = entry.slice(0, hash);
    const dot = where.indexOf(".");
    if (dot === -1 || dot === where.length - 1 || !LOCALES.includes(where.slice(0, dot))) {
      throw new Error(`reg-allowlist.json: "${entry}" must look like "<locale>.<key>#<phrase>"`);
    }
    if (!byKey.has(where)) byKey.set(where, []);
    byKey.get(where).push(entry.slice(hash + 1));
  }
  return byKey;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return {};
  const raw = fs.readFileSync(ALLOWLIST_FILE, "utf8").trim();
  if (raw === "") return {};
  const allowlist = JSON.parse(raw);
  validateAllowlist(allowlist);
  return allowlist;
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
const trWeakMatchers = TR_WEAK_CONTEXT.map((t) => buildLatinMatcher(t, { locale: "tr" }));
const trPartnerMatchers = TR_WEAK_PARTNERS.map((t) => buildLatinMatcher(t, { locale: "tr" }));
function hasGlucoseContext(text, locale) {
  if (contextMatchers.some((match) => match(text) !== null)) return true;
  if (locale !== "tr") return false;
  if (trContextMatchers.some((match) => match(text) !== null)) return true;
  return (
    trWeakMatchers.some((match) => match(text) !== null) &&
    trPartnerMatchers.some((match) => match(text) !== null)
  );
}

module.exports = {
  LOCALES,
  PATTERNS,
  SUBSTRING_LOCALES,
  KEY_EXEMPTIONS,
  ALLOWLIST_FILE,
  isKeyExempt,
  anchorSpans,
  insideSpans,
  validateAllowlist,
  loadAllowlist,
  buildLatinMatcher,
  buildSubstringMatcher,
  buildAllMatcher,
  hasGlucoseContext,
};
