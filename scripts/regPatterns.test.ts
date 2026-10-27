/**
 * G251 reg-check patterns: every new banned phrase has a positive example
 * (caught) and a negative one (ordinary wording stays clean), plus the
 * Google Play disclosure-sentence exemption, which is anchored to the full
 * sentence and only in store files of the same language.
 *
 * Run: npx tsx scripts/regPatterns.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: any;
declare function require(id: string): any;

const reg = require("./reg-check.js");
const rules = require("./regRules.js");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

type Finding = { locale: string; key: string; pattern: string };
const count = (locale: string, text: string): number =>
  (reg.scanLocaleEntries(locale, [["x", text]]) as { findings: Finding[] }).findings.length;

const cases: Record<string, { flagged: string[]; clean: string[] }> = {
  en: {
    flagged: [
      "Alarms for low glucose",
      "Alerts when your glucose is high",
      "Alerting you about low sugar",
      "Notifies you when your glucose is low",
      "Get notified when glucose drops",
      "Alert notifications for readings",
      "The app monitors your glucose",
      "Glucose monitoring made simple",
      "Blood sugar monitoring on your wrist",
      "Patient monitoring dashboard",
      "Remote monitoring for families",
      "Immediate awareness of lows",
      "Instant glucose readings",
      "Predicts your glucose",
      "A glucose forecast for tonight",
      "Going low? Know early",
      "You may be low soon",
      "Prevents lows overnight",
      "Therapy settings for high glucose",
      "Threshold alerts for readings",
      "Urgent low glucose",
      "Emergency low sugar screen",
      "Life-threatening lows",
      "A follower sees your glucose",
      "Caregivers see low glucose",
      "Diagnosis support",
      "Diagnostic tool",
      "It can diagnose you",
      "Bolus calculator",
      "Dose calculators",
      "Dosing help",
      "Your correction factor",
      "Clinical grade accuracy",
      "Medical-grade sensor",
      "Clinically proven",
      "Clinically validated results",
      "FDA approved",
      "FDA-cleared",
      "CE marked",
      "Replaces fingersticks",
      "Use it instead of finger pricks",
    ],
    clean: [
      "Notification settings",
      "Daily reminder notification",
      "Notifications when your timer ends",
      "Switch any reminder between alarm and notification",
      "Reminder alarms",
      "Connect your continuous glucose monitor",
      "Supported continuous glucose monitors",
      "Instant messaging app",
      "Prevent the screen from sleeping",
      "A threshold for sync retries",
      "Threshold for glucose targets",
      "Urgent update available",
      "Emergency contact",
      "Follower count",
      "Caregiver contact",
      "Diagnosed in 2019",
      "Weather forecast",
      "Predictable schedule",
      "Going lower on battery",
      "Log a finger prick reading",
      "Fingerstick readings are logged",
      "Time in range",
    ],
  },
  tr: {
    flagged: [
      "Düşük şeker alarmları",
      "Uyarı bildirimleri",
      "Şekeriniz düşünce size bildirir",
      "Şekerinizi izler",
      "Glukoz izleme",
      "Hasta izleme paneli",
      "Uzaktan izleme",
      "Anında kan şekeri",
      "Anlık glukoz değeri",
      "Şeker değerini tahmin eder",
      "Şeker tahmini",
      "Glukoz tahmini",
      "Düşük şekeri önler",
      "Eşik uyarısı",
      "Hayati tehlike taşıyan düşük şeker",
      "Bolus hesaplayıcı",
      "Doz hesaplayıcı",
      "Düzeltme faktörü",
      "Klinik olarak kanıtlanmış",
      "FDA onaylı",
      "CE işareti",
      "Parmak ucu ölçümünün yerini tutar",
      "Düşmek üzere",
      "Tıbbi sınıf doğruluk",
      "Şeker için terapi önerisi",
    ],
    clean: [
      "Besin değerleri tahminidir, tıbbi referans değildir.",
      "Tahmini HbA1c",
      "Bildirim ayarları",
      "Hatırlatıcı bildirimi",
      "Pro etiketleri paywall kapılarını izler",
      "Önlem al",
      "Şeker için önlem al",
      "Acil durum kişisi",
      "Eşik ayarı",
      "Takipçi sayısı",
      "Öngörülebilir program",
      "Hatırlatıcı alarmı",
    ],
  },
  de: {
    flagged: [
      "Alarme bei niedrigem Blutzucker",
      "Warnungen bei Blutzucker unter 70",
      "Benachrichtigt Sie bei niedrigem Blutzucker",
      "Benachrichtigung bei hohem Blutzucker",
      "Blutzuckerüberwachung rund um die Uhr",
      "Fernüberwachung",
      "Überwacht Ihre Werte",
      "Vorhersage Ihres Blutzuckers",
      "Verhindert Unterzucker",
      "Diagnose Typ 1",
      "Bolusrechner",
      "Dosisrechner",
      "Korrekturfaktor",
      "FDA-zugelassen",
      "CE-Kennzeichen",
      "Ersetzt Fingerstiche",
      "Klinisch bewiesen",
    ],
    clean: [
      "Benachrichtigungen",
      "Erinnerungs-Benachrichtigung",
      "Warnung: Datenverlust",
      "Wecker-Alarm für Erinnerungen",
      "Notfallkontakt",
      "Die Prognose ist sonnig",
      "Schwellenwert für Sync",
      "Kontinuierliches Glukosemessgerät",
    ],
  },
  fr: {
    flagged: [
      "Alertes de glycémie basse",
      "Alarmes de glycémie",
      "Notification quand la glycémie est basse",
      "Surveille votre glycémie",
      "Surveillance de la glycémie",
      "Surveillance à distance",
      "Prédit votre glycémie",
      "Prévision de la glycémie",
      "Pour prévenir une hypoglycémie",
      "Diagnostic du diabète",
      "Calculateur de bolus",
      "Calculateur de dose",
      "Facteur de correction",
      "Approuvé par la FDA",
      "Marquage CE",
      "Remplace les piqûres au doigt",
      "Cliniquement prouvé",
    ],
    clean: [
      "Notifications push",
      "Rappel avec notification",
      "Alerte de mise à jour",
      "Alarme du rappel",
      "Capteur de glycémie en continu",
      "Seuil de chargement",
    ],
  },
  es: {
    flagged: [
      "Alarmas de glucosa baja",
      "Alertas de glucosa",
      "Le notifica cuando la glucosa baja",
      "Monitorea su glucosa",
      "Monitoreo de glucosa",
      "Monitorización remota",
      "Predice su glucosa",
      "Pronóstico de glucosa",
      "Previene la hipoglucemia",
      "Diagnóstico de diabetes",
      "Calculadora de dosis",
      "Calculadora de bolo",
      "Factor de corrección",
      "Aprobado por la FDA",
      "Marcado CE",
      "Sustituye los pinchazos",
      "Clínicamente probado",
    ],
    clean: [
      "Notificaciones",
      "Alarma del recordatorio",
      "El pronóstico del tiempo",
      "Alerta de actualización",
      "Umbral de brillo",
    ],
  },
  it: {
    flagged: [
      "Allarmi per glicemia bassa",
      "Allerta per la glicemia",
      "La notifica quando la glicemia scende",
      "Monitora la Sua glicemia",
      "Monitoraggio della glicemia",
      "Previsione della glicemia",
      "Predice la glicemia",
      "Previene l'ipoglicemia",
      "Diagnosi del diabete",
      "Calcolatore di bolo",
      "Calcolatore di dose",
      "Fattore di correzione",
      "Approvato dalla FDA",
      "Marcatura CE",
      "Sostituisce i pungidito",
      "Clinicamente provato",
    ],
    clean: ["Notifiche", "Allarme della sveglia", "Soglia di luminosità", "Previsioni del tempo"],
  },
  pt: {
    flagged: [
      "Alarmes de glicemia baixa",
      "Alertas de glicemia",
      "Notificação quando a glicemia cair",
      "Monitora sua glicemia",
      "Monitoramento da glicemia",
      "Previsão da glicemia",
      "Prediz sua glicemia",
      "Previne hipoglicemia",
      "Diagnóstico de diabetes",
      "Calculadora de dose",
      "Calculadora de bolus",
      "Fator de correção",
      "Aprovado pela FDA",
      "Marcação CE",
      "Substitui as picadas no dedo",
      "Clinicamente comprovado",
    ],
    clean: ["Notificações", "Alarme do lembrete", "Previsão do tempo", "Limite de caracteres", "Alerta de atualização"],
  },
  ar: {
    flagged: [
      "مراقبة السكر باستمرار",
      "مراقبة الجلوكوز",
      "يراقب سكرك",
      "يتنبأ بمستوى السكر",
      "التنبؤ بالسكر",
      "يخطرك عند انخفاض السكر",
      "يمنع نقص السكر",
      "تشخيص السكري",
      "حاسبة الجرعة",
      "عامل التصحيح",
      "معتمد من FDA",
      "علامة CE",
    ],
    clean: ["إشعارات التذكير", "منبه التذكير", "عتبة الباب", "سجلك اليومي"],
  },
  ja: {
    flagged: [
      "低血糖アラート",
      "血糖を通知します",
      "血糖モニタリング",
      "血糖値を予測",
      "低血糖を防ぎます",
      "診断します",
      "診断の補助",
      "ボーラス計算",
      "用量計算",
      "補正係数",
      "FDA承認済み",
      "CEマーク",
      "指先採血の代わりになります",
    ],
    clean: ["通知設定", "リマインダー通知", "予測変換", "緊急連絡先", "持続血糖モニターに対応"],
  },
};

section("A. every new pattern family: positive caught, ordinary wording clean");
for (const [locale, { flagged, clean }] of Object.entries(cases)) {
  for (const t of flagged) ok(`${locale} flagged: ${t}`, count(locale, t) >= 1);
  for (const t of clean) ok(`${locale} clean: ${t}`, count(locale, t) === 0);
}

section("B. plural and inflected alarm/alert forms are caught next to glucose (root fix)");
{
  const roots: [string, string[], string][] = [
    ["en", ["Alarms for glucose", "Alerts for glucose", "Alerting on glucose", "Glucose alerted"], "Reminder alarms and alerts"],
    ["de", ["Alarme bei Blutzucker", "Alarms zu Blutzucker"], "Wecker-Alarme für Erinnerungen"],
    ["fr", ["Alertes de glycémie", "Alarmes de glycémie"], "Alertes et alarmes de rappel"],
    ["es", ["Alarmas de glucosa"], "Alarmas de recordatorio"],
    ["it", ["Allarmi di glicemia"], "Allarmi della sveglia"],
    ["pt", ["Alarmes de glicemia"], "Alarmes do lembrete"],
  ];
  for (const [locale, flagged, clean] of roots) {
    for (const t of flagged) ok(`${locale} flagged: ${t}`, count(locale, t) >= 1);
    eq(`${locale} clean without glucose: ${clean}`, count(locale, clean), 0);
  }
}

section("C. context modes: onlyContext needs an alert term, orContext widens glucose context");
{
  const entries = (locale: string) => rules.PATTERNS[locale] as { pattern: string; onlyContext?: string[] }[];
  const thr = entries("en").find((p) => p.pattern === "threshold*");
  ok("threshold* is onlyContext", !!thr && Array.isArray(thr.onlyContext));
  eq("threshold + alert caught", count("en", "Threshold alerts"), 1);
  eq("threshold + glucose alone clean", count("en", "Glucose threshold setting"), 0);
  eq("notif* + alert caught without glucose", count("en", "Alert notifications"), 1);
  eq("notif* + alarm only is clean (reminder feature)", count("en", "Switch from alarm to notification"), 0);
  ok(
    "contextOk exported",
    typeof rules.contextOk === "function" &&
      rules.contextOk({ requiresContext: true }, "low glucose", "en") === true &&
      rules.contextOk({ requiresContext: true }, "hello", "en") === false &&
      rules.contextOk({}, "hello", "en") === true
  );
}

section("D. tr tahmin* is only caught as a glucose/value prediction phrase");
{
  eq("bare 'tahmini' stays clean", count("tr", "Bu bir tahmini değerdir"), 0);
  eq("method text stays clean", count("tr", "GMI, ortalama glukozdan tahmini bir değerdir"), 0);
  eq("legal estimate stays clean", count("tr", "Besin değerleri tahminidir, tıbbi referans değildir."), 0);
  ok("glucose prediction caught", count("tr", "Glukoz tahmini yapar") >= 1);
  ok("value prediction with glucose caught", count("tr", "Kan şekeri değerlerini tahmin eder") >= 1);
  ok("shipped patterns contain no bare tahmin*", !rules.PATTERNS.tr.some((p: { pattern: string }) => p.pattern === "tahmin*"));
}

section("E. continuous glucose monitor stays allowed as a device category");
{
  for (const [locale, t] of [
    ["en", "Works with your continuous glucose monitor"],
    ["en", "Supported continuous glucose monitors: Dexcom, Libre"],
    ["en", "Ads: continuous glucose monitor app"],
  ] as [string, string][]) {
    eq(`${locale} allowed: ${t}`, count(locale, t), 0);
  }
  ok("monitoring is banned", count("en", "Continuous glucose monitoring app") >= 1);
  ok("monitors your is banned", count("en", "It monitors your readings") >= 1);
}

section("F. Google Play disclosure sentence: narrow, anchored, same-language store files only");
{
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { execFileSync } = require("child_process");
  const SENTENCE = "not a medical device and does not diagnose, treat, cure, or prevent any medical condition";

  eq("reason is non-empty", typeof rules.GOOGLE_DISCLOSURE_REASON === "string" && rules.GOOGLE_DISCLOSURE_REASON.length > 40, true);
  eq("one entry per locale", Object.keys(rules.GOOGLE_DISCLOSURE_SENTENCES).sort().join(","), [...rules.LOCALES].sort().join(","));
  eq("en sentence is the full Google wording", rules.GOOGLE_DISCLOSURE_SENTENCES.en[0], SENTENCE);
  ok(
    "every sentence is a full sentence (>= 40 chars)",
    Object.values(rules.GOOGLE_DISCLOSURE_SENTENCES).every((list: string[]) => list.every((x) => x.length >= 40))
  );
  eq("spans: sentence found, case-insensitive", rules.googleDisclosureSpans("en", `Zerospike is Not a medical device and does not diagnose, treat, cure, or prevent any medical condition.`).length, 1);
  eq("spans: other language has no exemption yet", rules.googleDisclosureSpans("de", SENTENCE).length, 0);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reg-g251-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    for (const f of ["reg-check.js", "regRules.js", "reg-allowlist.json"]) {
      fs.copyFileSync(path.join(process.cwd(), "scripts", f), path.join(root, "scripts", f));
    }
    fs.symlinkSync(path.join(process.cwd(), "lib"), path.join(root, "lib"));
    fs.mkdirSync(path.join(root, "zerospike-store", "aso"), { recursive: true });
    const run = (file: string, text: string): { status: number; out: string } => {
      fs.writeFileSync(path.join(root, "zerospike-store", "aso", file), text);
      try {
        const out = execFileSync("node", [path.join(root, "scripts", "reg-check.js")], { encoding: "utf8", stdio: "pipe" });
        return { status: 0, out };
      } catch (e: any) {
        return { status: e.status, out: String(e.stderr) + String(e.stdout) };
      }
    };
    const sentence = `zerospike is ${SENTENCE}.`;
    const bare = run("en.md", "Track your day.\n");
    eq("baseline clean", bare.status, 0);
    eq("full sentence passes", run("en.md", `${sentence}\n`).status, 0);
    eq("capitalised sentence passes", run("en.md", `Zerospike is Not a medical device and does not diagnose, treat, cure, or prevent any medical condition.\n`).status, 0);
    eq("sentence next to glucose wording passes", run("en.md", `Log glucose and meals. ${sentence}\n`).status, 0);
    const outside = run("en.md", "This app can diagnose your type.\n");
    ok("diagnose outside the sentence is caught", outside.status === 1 && /diagnose/.test(outside.out), outside.out);
    const mixed = run("en.md", `${sentence} It will diagnose lows.\n`);
    ok("diagnose after the sentence is still caught", mixed.status === 1 && /1 bulgu/.test(mixed.out), mixed.out);
    const before = run("en.md", `It will diagnose lows. ${sentence}\n`);
    ok("diagnose before the sentence is still caught", before.status === 1 && /1 bulgu/.test(before.out), before.out);
    const partial = run("en.md", "zerospike does not diagnose, treat, cure, or prevent any medical condition.\n");
    ok("a shortened sentence is not excused", partial.status === 1, partial.out);
    const other = run("de.md", `${sentence}\n`);
    ok("the English sentence in a de file is not excused", other.status === 1, other.out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
