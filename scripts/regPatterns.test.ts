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
      "Monitor your glucose.",
      "We'll send a notification if your blood sugar drops.",
      "Glucose trend analysis",
      "Notifications if your glucose is high",
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
      "Monitor resolution settings",
      "Notification if the timer ends",
      "Trend analysis of your workouts",
      "Works with your continuous glucose monitors",
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
      "Kan şekerinizi izleyin.",
      "Şekerinizi izleyebilirsiniz",
      "Glukoz trend analizi.",
      "Şeker eğilim analizi",
    ],
    clean: [
      "Besin değerleri tahminidir, tıbbi referans değildir.",
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
      "Reklam izle",
      "Trend analizi için tarih seçin",
      "Kan şekerinizi takip edin",
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
      "Überwachen Sie Ihren Blutzucker.",
      "Glukose Trendanalyse",
      "Benachrichtigung, falls der Blutzucker sinkt",
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
      "Überwachen Sie den Bildschirm",
      "Trendanalyse der Arbeitszeit",
      "Tragen Sie Ihren Blutzucker ein",
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
      "Surveillez votre glycémie.",
      "Analyse de tendance de la glycémie",
      "Notification si la glycémie baisse",
    ],
    clean: [
      "Notifications push",
      "Rappel avec notification",
      "Alerte de mise à jour",
      "Alarme du rappel",
      "Capteur de glycémie en continu",
      "Seuil de chargement",
      "Surveillance du réseau",
      "Suivez votre glycémie",
      "Notification si le minuteur se termine",
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
      "Monitorice su glucosa.",
      "Monitoree su azúcar",
      "Análisis de tendencias de glucosa",
    ],
    clean: [
      "Notificaciones",
      "Alarma del recordatorio",
      "El pronóstico del tiempo",
      "Alerta de actualización",
      "Umbral de brillo",
      "Monitor de pantalla",
      "Registre su glucosa diaria",
      "Análisis de tendencias del tiempo",
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
      "Monitori la Sua glicemia.",
      "Monitoraggio con la glicemia",
      "Analisi dei trend della glicemia",
    ],
    clean: ["Notifiche", "Allarme della sveglia", "Soglia di luminosità", "Previsioni del tempo", "Monitor del computer", "Registri la Sua glicemia", "Analisi dei trend di vendita"],
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
      "Monitore sua glicose.",
      "Monitorizar a glicose",
      "Análise de tendências da glicose",
    ],
    clean: ["Notificações", "Alarme do lembrete", "Previsão do tempo", "Limite de caracteres", "Alerta de atualização", "Monitor de tela", "Registre sua glicose", "Análise de tendências de vendas"],
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
      "تحليل الاتجاهات للجلوكوز",
    ],
    clean: ["إشعارات التذكير", "منبه التذكير", "عتبة الباب", "سجلك اليومي", "اتجاه القبلة"],
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
      "血糖のトレンド分析",
    ],
    clean: ["通知設定", "リマインダー通知", "予測変換", "緊急連絡先", "持続血糖モニターに対応", "血糖を記録します"],
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
  ok("monitor verb next to the device phrase is still caught", count("en", "Monitor your continuous glucose monitor") >= 1);
  eq("tr Pro-label code description stays clean", count("tr", "Pro etiketleri paywall kapılarını izler (içgörü, şeker)"), 0);
}

section("G. monitoring and trend analysis wording, the five review examples");
{
  for (const [locale, t] of [
    ["en", "Monitor your glucose."],
    ["tr", "Kan şekerinizi izleyin."],
    ["de", "Überwachen Sie Ihren Blutzucker."],
    ["fr", "Surveillez votre glycémie."],
    ["tr", "Glukoz trend analizi."],
    ["en", "We'll send a notification if your blood sugar drops."],
  ] as [string, string][]) {
    ok(`${locale} caught: ${t}`, count(locale, t) >= 1);
  }
}

section("H. G252: an estimated A1C is banned in both word orders, GMI and the lab A1C field are not");
{
  const a1c: Record<string, { flagged: string[]; clean: string[] }> = {
    en: {
      flagged: ["Estimated A1C (GMI)", "an estimated HbA1c", "Your A1C estimate", "HbA1c estimation", "Estimate your A1C", "eA1C"],
      clean: ["GMI", "Glucose Management Indicator (GMI)", "Your latest lab A1C", "Enter the A1C from your lab report", "Goal A1C"],
    },
    tr: {
      flagged: ["Tahmini A1C (GMI)", "tahmini HbA1c", "A1C tahmini", "A1C tahmin edilir", "Tahmin edilen A1C"],
      clean: ["GMI", "Laboratuvar A1C sonucunuz", "A1C değeriniz", "Son A1C sonucunu girin"],
    },
    de: {
      flagged: ["Geschätzter A1C (GMI)", "Geschätzter HbA1c", "A1C-Schätzung", "Schätzung des HbA1c", "A1C geschätzt"],
      clean: ["GMI", "Ihr Labor-A1C", "Tragen Sie Ihren HbA1c ein", "Letzter A1C-Wert"],
    },
    fr: {
      flagged: ["HbA1c estimée", "A1C estimée", "estimation de l'HbA1c", "estimation de l’HbA1c", "Estimation de la A1C"],
      clean: ["GMI", "Votre HbA1c de laboratoire", "Saisissez votre A1C", "Dernière HbA1c"],
    },
    es: {
      flagged: ["A1C estimada", "HbA1c estimada", "estimación de A1C", "Estimación de la A1C"],
      clean: ["GMI", "Su A1C de laboratorio", "Registre su última A1C"],
    },
    it: {
      flagged: ["HbA1c stimata", "Stima della HbA1c", "stima dell'HbA1c", "A1C stimata"],
      clean: ["GMI", "La Sua HbA1c di laboratorio", "Inserisca l'ultima HbA1c"],
    },
    pt: {
      flagged: ["A1c estimada", "Estimativa da A1c", "estimativa de HbA1c", "HbA1c estimada"],
      clean: ["GMI", "Sua A1c de laboratório", "Informe sua última A1c"],
    },
    ar: {
      flagged: ["تقدير A1C (GMI)", "A1C المقدر", "تقدير HbA1c", "A1c التقديري"],
      clean: ["GMI", "نتيجة A1C من المختبر", "أدخل آخر A1C لديك"],
    },
    ja: {
      flagged: ["推定A1C(GMI)", "A1C推定", "推定HbA1c", "A1Cの推定値", "HbA1cを推定"],
      clean: ["GMI", "検査のA1C結果", "直近のA1Cを入力"],
    },
  };
  for (const [locale, { flagged, clean }] of Object.entries(a1c)) {
    for (const t of flagged) ok(`${locale} A1C flagged: ${t}`, count(locale, t) >= 1);
    for (const t of clean) ok(`${locale} A1C clean: ${t}`, count(locale, t) === 0);
  }
}

section("I. G252: up to three words between the estimate word and A1C, both orders, nine languages");
{
  const gapped: Record<string, { flagged: string[]; clean: string[] }> = {
    en: {
      flagged: ["an estimate based on your A1C", "A1C shown here as estimate"],
      clean: [
        "an estimate based on all your lab A1C",
        "Estimated carbs, then your lab A1C",
        "Your lab A1C: carbs are estimates",
        "estimate of carbs",
      ],
    },
    tr: {
      flagged: ["tahmini olarak hesaplanan A1C", "A1C sonucunuz için tahmin"],
      clean: ["tahmini karbonhidrat", "Tahmini karbonhidrat değeri", "Besin değerleri tahminidir, tıbbi referans değildir."],
    },
    de: {
      flagged: ["geschätzt für Ihren aktuellen HbA1c", "HbA1c laut Ihrem Durchschnitt geschätzt"],
      clean: ["Schätzung der Kohlenhydrate", "geschätzte Kohlenhydrate"],
    },
    fr: {
      flagged: ["estimée à partir de HbA1c", "HbA1c de votre bilan estimée"],
      clean: ["l'estimation des glucides", "Une estimation des glucides, votre HbA1c reste la vôtre"],
    },
    es: {
      flagged: ["estimada según su promedio A1C", "A1C de su laboratorio estimada"],
      clean: ["estimación de carbohidratos", "carbohidratos estimados"],
    },
    it: {
      flagged: ["stima calcolata dalla media HbA1c", "HbA1c della media stimata"],
      clean: ["stima dei carboidrati", "carboidrati stimati"],
    },
    pt: {
      flagged: ["uma estimativa do seu A1C", "estimativa calculada da sua A1c"],
      clean: ["estimativa de carboidratos", "carboidratos estimados", "estimativa baseada na média do A1C"],
    },
    ar: {
      flagged: [
        "تقدير للسكر التراكمي A1C",
        "تقدير تقريبي لقيمة A1C",
        "السكر التراكمي المقدر",
        "A1C لديك خلال الفترة تقدير",
        "تقدير السكر التراكمي",
      ],
      clean: [
        "تقدير الإنسولين",
        "التقديرات",
        "تقديرية",
        "القيم الغذائية تقديرية وليست مرجعًا طبيًا.",
        "تقدير الجرعة",
        "تقديرات الإنسولين والكربوهيدرات المعروضة لغرض المعلومات فقط",
        "السكر التراكمي",
        "نتيجة A1C من المختبر",
      ],
    },
    ja: {
      flagged: ["推定された血液A1C", "A1Cの目安となる推定"],
      clean: ["炭水化物の推定", "検査のA1C結果"],
    },
  };
  for (const [locale, { flagged, clean }] of Object.entries(gapped)) {
    for (const t of flagged) ok(`${locale} gap flagged: ${t}`, count(locale, t) >= 1);
    for (const t of clean) ok(`${locale} gap clean: ${t}`, count(locale, t) === 0);
  }
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
