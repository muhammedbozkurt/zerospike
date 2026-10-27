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
type Exemption = { locale: string; key: string; terms: string[]; reason: string };

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
  eq("exemption count (9 locales x 3 keys + 5 it Live Activity keys)", EXEMPTIONS.length, 32);
  for (const e of EXEMPTIONS) {
    ok(`reason ${e.locale}.${e.key}`, typeof e.reason === "string" && e.reason.length > 20);
    ok(`terms ${e.locale}.${e.key}`, Array.isArray(e.terms) && e.terms.length > 0);
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
  const exemptions = [{ locale: "en", key: "disclaimer.body", terms: ["treatment"], reason: "" }];
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

section("K. the Italian Live Activity name is excused only under its own keys");
{
  const name = "Attività in tempo reale";
  const it = (key: string) =>
    (reg.scanLocaleEntries("it", [[key, name]]) as { findings: Finding[]; excused: number });
  for (const key of ["widgetGuide.liveTitle", "widgetGuide.liveOn", "widgetGuide.liveOff", "widgetGuide.postMealBodyAndroid", "scWidgets.liveActivity"]) {
    const r = it(key);
    ok(`it ${key} excused`, r.findings.length === 0 && r.excused === 1);
  }
  eq("it elsewhere still a finding", it("cgmHome.watching").findings.length, 1);
  const mixed = reg.scanLocaleEntries("it", [["widgetGuide.liveTitle", "Valori in tempo reale su Attività in tempo reale"]]) as { findings: Finding[]; excused: number };
  ok("a second claim in an excused key is still excused by term (documented limit)", mixed.findings.length === 0);
  const other = reg.scanLocaleEntries("tr", [["widgetGuide.liveTitle", "Gerçek zamanlı Canlı Etkinlik"]]) as { findings: Finding[] };
  eq("tr Canlı Etkinlik name alone is clean, the claim is not", other.findings.length, 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
