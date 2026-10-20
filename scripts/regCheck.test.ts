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
  eq("exemption count (9 locales x 3 keys)", EXEMPTIONS.length, 27);
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
