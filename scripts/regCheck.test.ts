/**
 * scripts/reg-check.js key-based exemptions. No jest, standalone style.
 *
 * Property under test: an exemption is narrow. It excuses one word under one
 * exact locale key, never the same word under another key, and never a
 * different banned phrase inside the excused key. Every exemption carries a
 * non-empty reason. The bare words (treatment, diagnosis, ...) are injected as
 * patterns here because the shipped pattern list does not flag them today.
 *
 * Run: npx tsx scripts/regCheck.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const reg = require("./reg-check.js");

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

type Finding = { locale: string; key: string; pattern: string };
type Exemption = { locale: string; key: string; anchors: string[]; reason: string };

const LOCALES: string[] = reg.LOCALES;
const EXEMPTIONS: Exemption[] = reg.KEY_EXEMPTIONS;

const DISCLAIMER_WORD: Record<string, string> = {
  en: "treatment",
  tr: "tedavi",
  de: "Behandlung*",
  fr: "traitement",
  es: "tratamiento",
  it: "terap*",
  pt: "tratamento",
  ar: "علاج",
  ja: "治療",
};
const DIAGNOSIS_WORD: Record<string, string> = {
  en: "diagnosis",
  tr: "tanı",
  de: "Diagnose",
  fr: "diagnostic",
  es: "diagnóstico",
  it: "diagnosi",
  pt: "diagnóstico",
  ar: "تشخيص",
  ja: "診断",
};

console.log("zerospike reg-check exemption test");

section("A. every exemption has a reason and terms");
{
  eq("exemption count (9 locales x 3 keys + 9 locales x 5 Live Activity keys)", EXEMPTIONS.length, 72);
  for (const e of EXEMPTIONS) {
    ok(`reason ${e.locale}.${e.key}`, typeof e.reason === "string" && e.reason.length > 20);
    ok(`anchors ${e.locale}.${e.key}`, Array.isArray(e.anchors) && e.anchors.length > 0);
  }
}

section("B. exempt keys give no finding, other keys with the same word do");
for (const locale of LOCALES) {
  const entries: [string, string][] = reg.loadLocaleEntries(locale);
  const run = (pattern: string) =>
    reg.scanLocaleEntries(locale, entries, { patterns: [{ pattern }] }) as { findings: Finding[]; excused: number };

  const dis = run(DISCLAIMER_WORD[locale]);
  const disKeys = dis.findings.map((f) => f.key);
  ok(`${locale} disclaimer.body excused`, !disKeys.includes("disclaimer.body"));
  ok(`${locale} disclaimer.short excused`, !disKeys.includes("disclaimer.short"));
  ok(`${locale} disclaimer excused counted`, dis.excused >= 2, `excused ${dis.excused}`);
  ok(`${locale} same word elsewhere still a finding`, disKeys.includes("spike.consentScope"), disKeys.join(","));

  const dx = run(DIAGNOSIS_WORD[locale]);
  const dxKeys = dx.findings.map((f) => f.key);
  ok(`${locale} onboarding.diabetes_none excused`, !dxKeys.includes("onboarding.diabetes_none"));
  ok(`${locale} diabetes_none excused counted`, dx.excused >= 1, `excused ${dx.excused}`);
}

section("C. another banned phrase inside an excused key is still a finding");
{
  const entries: [string, string][] = [
    ["disclaimer.body", "Lütfen tedavi kararlarınız için doktorunuza danışınız. zerospike sizi uyarır."],
    ["onboarding.diabetes_none", "Tanı almadım"],
  ];
  const r = reg.scanLocaleEntries("tr", entries, {
    patterns: [{ pattern: "tedavi" }, { pattern: "uyarır" }, { pattern: "tanı" }],
  }) as { findings: Finding[]; excused: number };
  eq("one finding", r.findings.length, 1);
  eq("finding is uyarır", r.findings[0] && r.findings[0].pattern, "uyarır");
  eq("two excused", r.excused, 2);
}

section("D. a different locale does not inherit the exemption");
{
  const entries: [string, string][] = [["disclaimer.body", "Please consult your physician for any treatment decisions."]];
  const exemptions: Exemption[] = EXEMPTIONS.filter((e) => e.locale === "tr");
  const r = reg.scanLocaleEntries("en", entries, { patterns: [{ pattern: "treatment" }], exemptions }) as {
    findings: Finding[];
  };
  eq("en finding when only tr exempt", r.findings.length, 1);
}

section("E. an exemption without a reason does not excuse");
{
  const entries: [string, string][] = [["disclaimer.body", "treatment"]];
  const exemptions = [{ locale: "en", key: "disclaimer.body", anchors: ["treatment"], reason: "" }];
  const r = reg.scanLocaleEntries("en", entries, { patterns: [{ pattern: "treatment" }], exemptions }) as {
    findings: Finding[];
  };
  eq("finding without reason", r.findings.length, 1);
}

section("F. shipped patterns on the real locales: 0 findings");
for (const locale of LOCALES) {
  const r = reg.scanLocaleEntries(locale, reg.loadLocaleEntries(locale)) as { findings: Finding[] };
  eq(`${locale} real findings`, r.findings.length, 0);
}

section("G. fastlane/metadata directories map to a language and are all listed");
{
  const map: [string, string | null][] = [
    ["en-AU", "en"], ["en-CA", "en"], ["en-GB", "en"], ["en-US", "en"], ["es-419", "es"], ["es-MX", "es"],
    ["fr-CA", "fr"], ["ar", "ar"], ["ar-SA", "ar"], ["it", "it"], ["it-IT", "it"], ["ja", "ja"], ["ja-JP", "ja"],
    ["pt-BR", "pt"], ["tr-TR", "tr"], ["android", null], ["screenshots", null],
  ];
  for (const [dir, lang] of map) eq(`metadataLocale ${dir}`, reg.metadataLocale(dir), lang);

  const files = reg.listMetadataFiles() as { key: string; own: string }[];
  if (files.length === 0) {
    console.log("  (fastlane/metadata yok, liste testi atlandi)");
  } else {
    const keys = new Set(files.map((f) => f.key));
    for (const loc of ["en-AU", "en-CA", "en-GB"]) {
      for (const f of ["name", "subtitle", "keywords", "promotional_text", "description", "release_notes"]) {
        ok(`listed fastlane/metadata/${loc}/${f}.txt`, keys.has(`fastlane/metadata/${loc}/${f}.txt`));
      }
      for (const f of ["title", "short_description", "full_description"]) {
        ok(`listed android/${loc}/${f}.txt`, keys.has(`fastlane/metadata/android/${loc}/${f}.txt`));
      }
    }
    ok("no image or binary listed", files.every((f) => f.key.endsWith(".txt") && !f.key.includes("/images/")));
    ok("every file has a known language", files.every((f) => reg.LOCALES.includes(f.own)));
  }
}

section("H. Turkish inflection and dotted/dotless I are caught (tr only)");
{
  const scan = (text: string) =>
    (reg.scanLocaleEntries("tr", [["x", text]]) as { findings: Finding[] }).findings.length;
  const flagged = [
    "Hipoglisemi alarmı kurulur",
    "Kan şekeri alarmları",
    "KAN ŞEKERİ ALARMI",
    "Sizi uyarır",
    "SİZİ UYARIR",
    "UYARIR",
    "uyarır",
    "Uygulama düşük şekeri uyarıyla bildirir",
    "Tedavi önerisi sunar",
    "Tedavinizi belirler",
    "Tanıyı koyar",
    "TANI KOYAR",
    "ÖNERİLEN DOZ 4 ünite",
    "Önerilen dozu gösterir",
    "Bu tanıda insülin gerekir",
    "Tanıya göre doz",
    "Tanınızı doktorunuz koyar",
    "Tanıdan sonra doz",
    "Düşük değerde alarm çalar",
    "Kan şekeri düşükse uyarı gösterilir",
  ];
  for (const t of flagged) ok(`tr flagged: ${t}`, scan(t) >= 1);
  const clean = [
    "Hatırlatıcı alarmı kurulur",
    "Alarm sesi",
    "Tanım ekle",
    "Uygulamayı tanıtın",
    "Tanıdık yüz",
    "Öğünleri takip edin",
    "Uygulamayı tanıyın",
    "Tanınmış markalar",
    "Ses komutlarını tanır",
    "Hatırlatıcı alarmı yüksek sesle çalar",
    "Düşük pil uyarısı",
    "Tanıdığınız kişiler",
  ];
  for (const t of clean) ok(`tr clean: ${t}`, scan(t) === 0);
  const en = (reg.scanLocaleEntries("en", [["x", "UYARIR"]]) as { findings: Finding[] }).findings.length;
  eq("en text unaffected by tr folding", en, 0);
}

section("I. store scan matcher also folds tr text");
{
  const rules = require("./regRules.js");
  const hits = (text: string) =>
    rules.buildAllMatcher("uyarır*", false, { locale: "tr" })(text).length;
  eq("store UYARIR", hits("SİZİ UYARIR"), 1);
  eq("store uyarır", hits("sizi uyarır"), 1);
}

section("J. real-time claims and diagnostic event wording are caught in every language");
{
  const cases: [string, string[], string[]][] = [
    ["en", ["Real-time CGM readings", "See it in real time", "Live glucose on your lock screen", "Every hypoglycemic event is listed", "Hypoglycemia events from your sensor"], ["Your journal, in order", "Real estate", "Lives of others"]],
    ["tr", ["Gerçek zamanlı CGM", "GERÇEK ZAMANLI takip", "Hipoglisemi olayları listelenir", "Hipoglisemik olay sayısı", "Hipoglisemi atakları"], ["Gerçek bir kayıt", "Zaman çizelgesi"]],
    ["de", ["CGM-Werte in Echtzeit", "Unterzuckerungsereignisse werden gezählt", "Ein hypoglykämisches Ereignis", "Hypoglykämische Ereignisse"], ["Zeitverlauf des Tages"]],
    ["fr", ["Votre glycémie en temps réel", "Chaque événement hypoglycémique"], ["Votre journal du jour"]],
    ["es", ["Lecturas en tiempo real", "Eventos hipoglucémicos del día"], ["Su registro del día"]],
    ["it", ["Valori in tempo reale", "Ogni evento ipoglicemico", "Eventi ipoglicemici del giorno"], ["Registrazione con CGM", "Il Suo diario"]],
    ["pt", ["Leituras em tempo real", "Eventos hipoglicêmicos do dia"], ["Seu registro do dia"]],
    ["ar", ["قراءات في الوقت الفعلي", "حدث نقص سكر الدم", "نوبة نقص سكر"], ["سجلك اليومي"]],
    ["ja", ["リアルタイムの血糖値", "低血糖イベントの一覧", "低血糖発作の記録"], ["記録の一覧"]],
  ];
  for (const [locale, flagged, clean] of cases) {
    const scan = (text: string) =>
      (reg.scanLocaleEntries(locale, [["x", text]]) as { findings: Finding[] }).findings.length;
    for (const t of flagged) ok(`${locale} flagged: ${t}`, scan(t) >= 1);
    for (const t of clean) ok(`${locale} clean: ${t}`, scan(t) === 0);
  }
}

section("K. the Live Activity system names are excused only under their own keys, as anchored phrases");
{
  const names: Record<string, string> = {
    en: "Live Activity", tr: "Canlı Etkinlik", de: "Live-Aktivität", fr: "Activité en direct", es: "Actividad en vivo",
    it: "Attività in tempo reale", pt: "Atividade ao Vivo", ar: "النشاط المباشر", ja: "ライブアクティビティ",
  };
  const scan = (locale: string, key: string, text: string) =>
    reg.scanLocaleEntries(locale, [[key, text]], { patterns: [{ pattern: names[locale] }] }) as { findings: Finding[]; excused: number };
  for (const locale of LOCALES) {
    for (const key of ["widgetGuide.liveTitle", "widgetGuide.liveOn", "widgetGuide.liveOff", "widgetGuide.postMealBodyAndroid", "scWidgets.liveActivity"]) {
      const r = scan(locale, key, names[locale]);
      ok(`${locale} ${key} excused`, r.findings.length === 0 && r.excused === 1, JSON.stringify(r));
    }
    eq(`${locale} elsewhere still a finding`, scan(locale, "cgmHome.watching", names[locale]).findings.length, 1);
  }
  const mixed = reg.scanLocaleEntries("it", [["widgetGuide.liveTitle", "Valori in tempo reale su Attività in tempo reale"]]) as { findings: Finding[]; excused: number };
  eq("a second claim in an excused key is a finding", mixed.findings.length, 1);
  eq("the anchored name is still excused", mixed.excused, 1);
  const other = reg.scanLocaleEntries("tr", [["widgetGuide.liveTitle", "Gerçek zamanlı Canlı Etkinlik"]]) as { findings: Finding[] };
  eq("tr Canlı Etkinlik name alone is clean, the claim is not", other.findings.length, 1);
}

section("L. opus probes: extra banned wording inside an excused key is caught");
{
  const probes: [string, string, string][] = [
    ["it", "widgetGuide.liveTitle", "Glicemia in tempo reale sulla schermata di blocco"],
    ["it", "widgetGuide.liveOn", "Attività in tempo reale attiva: glicemia in tempo reale"],
    ["de", "disclaimer.body", "zerospike erstellt Ihre persönliche Behandlungsempfehlung."],
    ["de", "disclaimer.body", "Bitte wenden Sie sich bei allen Behandlungsentscheidungen an Ihre Ärztin. zerospike liefert eine Behandlungsempfehlung."],
    ["en", "disclaimer.body", "zerospike builds a treatment plan for you."],
    ["fr", "disclaimer.short", "zerospike vous donne une recommandation de traitement."],
    ["tr", "disclaimer.body", "zerospike diyabetinizi tedavi eder."],
    ["tr", "onboarding.diabetes_none", "Uygulama size tanı koyar"],
    ["ja", "disclaimer.body", "zerospikeが治療します。治療を推奨"],
    ["ja", "onboarding.diabetes_none", "アプリが診断します"],
    ["en", "disclaimer.body", "zerospike diagnoses diabetes."],
    ["de", "disclaimer.body", "Die App warnt Sie bei Unterzucker."],
  ];
  for (const [locale, key, text] of probes) {
    const r = reg.scanLocaleEntries(locale, [[key, text]]) as { findings: Finding[] };
    ok(`${locale}.${key} flagged: ${text}`, r.findings.length >= 1);
  }
  const legit: [string, string, string][] = [
    ["it", "widgetGuide.liveTitle", "Attività in tempo reale"],
    ["en", "disclaimer.body", "zerospike is not a medical device. Please consult your physician for any treatment decisions."],
    ["tr", "onboarding.diabetes_none", "Tanı almadım"],
  ];
  for (const [locale, key, text] of legit) {
    const r = reg.scanLocaleEntries(locale, [[key, text]]) as { findings: Finding[] };
    ok(`${locale}.${key} legit text stays clean`, r.findings.length === 0);
  }
}

section("M. locale-key allowlist needs an anchor and a reason");
{
  const text = "Real-time glucose alarm warns you and gives a recommended dose";
  const scan = (allowlist: Record<string, string>) =>
    reg.scanLocaleEntries("en", [["home.title", text]], { allowlist }) as { findings: Finding[]; excused: number };
  const throws = (allowlist: Record<string, string>) => {
    try {
      scan(allowlist);
      return false;
    } catch {
      return true;
    }
  };
  ok("empty reason throws", throws({ "en.home.title#Real-time glucose": "" }));
  ok("whitespace reason throws", throws({ "en.home.title#Real-time glucose": "   " }));
  ok("entry without anchor throws", throws({ "en.home.title": "Some long enough reason text here" }));
  ok("entry with empty anchor throws", throws({ "en.home.title#": "Some long enough reason text here" }));
  const r = scan({ "en.home.title#Real-time glucose": "Quoted competitor wording in a comparison, reviewed by hand" });
  ok("anchored entry excuses only its own match", r.excused === 1 && r.findings.length >= 3, JSON.stringify(r));
  ok("no whole-key escape", !r.findings.every((f) => f.pattern === "real-time"));
  const other = reg.scanLocaleEntries("en", [["home.other", text]], {
    allowlist: { "en.home.title#Real-time glucose": "Quoted competitor wording in a comparison, reviewed by hand" },
  }) as { findings: Finding[]; excused: number };
  ok("anchor of another key does not apply", other.excused === 0 && other.findings.length >= 4);
  const rules = require("./regRules.js");
  let threw = false;
  try {
    rules.validateAllowlist({ "zerospike-store/aso/it.md#x": "" });
  } catch {
    threw = true;
  }
  ok("store entry with empty reason throws", threw);
}

section("N. real-time and live wording gaps are caught in every language");
{
  const cases: [string, string[], string[]][] = [
    ["en", ["Realtime glucose on your lock screen", "Real-time values"], ["Live Activity on the Lock Screen", "A realtor visit"]],
    ["tr", ["Canlı şeker değeri kilit ekranında", "Anlık şeker takibi", "Canlı kan şekeri"], ["Canlı Etkinlik", "Anlık bildirim"]],
    ["de", ["Echtzeitwerte Ihres Blutzuckers", "Live-Glukosewerte auf dem Sperrbildschirm", "Live-Blutzucker im Blick"], ["Live-Aktivität", "Live-Aktivitäten sind aktiv"]],
    ["fr", ["Votre glycémie en direct sur l'écran verrouillé", "Glucose en direct"], ["Activité en direct", "Un événement en direct"]],
    ["es", ["Su glucosa en vivo en la pantalla de bloqueo", "Azúcar en vivo"], ["Actividad en vivo", "Un evento en vivo"]],
    ["it", ["La Sua glicemia in diretta sulla schermata di blocco", "Glucosio in diretta"], ["Attività Live", "Un evento in diretta"]],
    ["pt", ["Sua glicose ao vivo na tela de bloqueio", "Açúcar ao vivo"], ["Atividade ao Vivo", "Um evento ao vivo"]],
  ];
  for (const [locale, flagged, clean] of cases) {
    const scan = (text: string) =>
      (reg.scanLocaleEntries(locale, [["x", text]]) as { findings: Finding[] }).findings.length;
    for (const t of flagged) ok(`${locale} flagged: ${t}`, scan(t) >= 1);
    for (const t of clean) ok(`${locale} clean: ${t}`, scan(t) === 0);
  }
  const live: [string, string, string][] = [
    ["tr", "widgetGuide.liveTitle", "Canlı Etkinlik"],
    ["fr", "widgetGuide.liveOn", "Les activités en direct sont activées pour votre glycémie."],
  ];
  for (const [locale, key, text] of live) {
    const r = reg.scanLocaleEntries(locale, [[key, text]]) as { findings: Finding[] };
    ok(`${locale} ${key} Live Activity name does not flag`, r.findings.length === 0, text);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
