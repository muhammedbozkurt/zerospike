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

// Alert/warning vocabulary per language. A "notif*" style pattern fires on
// glucose wording OR on one of the NOTIF_CONTEXT terms; "alarm" is left out
// there on purpose, because the reminder feature rings a real alarm and says
// "switch to a notification" (store-legal, not a glucose claim). An
// `onlyContext` pattern ("threshold*") fires only next to one of the wider
// ALERT_TERMS, never on glucose wording alone.
const NOTIF_CONTEXT = {
  en: ["alert*", "warn*"],
  tr: ["uyarı*", "uyarır*", "uyaran*"],
  de: ["Warn*", "Alert*"],
  fr: ["alert*", "avert*"],
  es: ["alert*", "advertenc*"],
  it: ["allert*", "avvertenz*"],
  pt: ["alert*"],
  ar: ["تنبيه", "تحذير"],
  ja: ["アラート", "警告", "警報"],
};
const ALERT_TERMS = {
  en: ["alert*", "alarm*", "warn*"],
  tr: ["uyarı*", "uyarır*", "uyaran*", "alarm*"],
  de: ["Warn*", "Alarm*", "Alert*"],
  fr: ["alert*", "alarm*", "avert*"],
  es: ["alert*", "alarm*", "avis*", "advertenc*"],
  it: ["allert*", "allarm*", "avvis*"],
  pt: ["alert*", "alarm*", "avis*"],
  ar: ["تنبيه", "إنذار", "تحذير"],
  ja: ["アラーム", "アラート", "警報", "警告"],
};

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
    { pattern: "alarm*", requiresContext: true },
    { pattern: "alert*", requiresContext: true },
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
    { pattern: "hyper event*" },
    { pattern: "live cgm" },
    { pattern: "live sensor" },
    { pattern: "live blood sugar" },
    { pattern: "live sugar", except: ["-"] },
    { pattern: "detects hypoglyc*" },
    { pattern: "detects hypo" },
    { pattern: "detects hypos" },
    { pattern: "detects hyper" },
    { pattern: "detects hyperglyc*" },
    { pattern: "detects hypers" },
    { pattern: "detects low glucose" },
    { pattern: "detects high glucose" },
    { pattern: "detects low blood sugar" },
    { pattern: "detects high blood sugar" },
    // G251: notification, monitoring and prediction wording, device-grade claims.
    { pattern: "notif*", requiresContext: true, onlyContext: NOTIF_CONTEXT.en, except: ["ications.ts"] },
    { pattern: "notifies you", requiresContext: true },
    { pattern: "notify you", requiresContext: true },
    { pattern: "notified when", requiresContext: true },
    { pattern: "notifications when", requiresContext: true },
    { pattern: "notification when", requiresContext: true },
    { pattern: "notifications for low", requiresContext: true },
    { pattern: "notifications for high", requiresContext: true },
    { pattern: "monitors your" },
    { pattern: "glucose monitoring" },
    { pattern: "blood sugar monitoring" },
    { pattern: "patient monitoring" },
    { pattern: "remote monitoring" },
    { pattern: "immediate awareness" },
    { pattern: "instant*", requiresContext: true },
    { pattern: "predict*", requiresContext: true },
    { pattern: "forecast*", requiresContext: true },
    { pattern: "going low" },
    { pattern: "going high" },
    { pattern: "low soon" },
    { pattern: "high soon" },
    { pattern: "prevent*", requiresContext: true },
    { pattern: "therap*", requiresContext: true },
    { pattern: "threshold*", requiresContext: true, onlyContext: ALERT_TERMS.en },
    { pattern: "urgent", requiresContext: true },
    { pattern: "emergency", requiresContext: true },
    { pattern: "life-threatening", requiresContext: true },
    { pattern: "follower*", requiresContext: true },
    { pattern: "caregiver*", requiresContext: true },
    { pattern: "diagnose" },
    { pattern: "diagnosis" },
    { pattern: "diagnostic*" },
    { pattern: "bolus calculator*" },
    { pattern: "dose calculator*" },
    { pattern: "dosing" },
    { pattern: "correction factor*" },
    { pattern: "clinical grade" },
    { pattern: "clinical-grade" },
    { pattern: "medical grade" },
    { pattern: "medical-grade" },
    { pattern: "clinically proven" },
    { pattern: "clinically validated" },
    { pattern: "FDA approved" },
    { pattern: "FDA-approved" },
    { pattern: "FDA cleared" },
    { pattern: "FDA-cleared" },
    { pattern: "CE mark*" },
    { pattern: "CE-mark*" },
    { pattern: "replace fingerstick*" },
    { pattern: "replaces fingerstick*" },
    { pattern: "replacing fingerstick*" },
    { pattern: "replace finger stick*" },
    { pattern: "replaces finger stick*" },
    { pattern: "replace finger prick*" },
    { pattern: "replaces finger prick*" },
    { pattern: "replace finger-prick*" },
    { pattern: "replaces finger-prick*" },
    { pattern: "instead of fingerstick*" },
    { pattern: "instead of finger stick*" },
    { pattern: "instead of finger prick*" },
    { pattern: "no more fingerstick*" },
    { pattern: "no more finger prick*" },
    { pattern: "without fingerstick*" },
    { pattern: "without finger prick*" },
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
    { pattern: "hipoyu algıl*" },
    { pattern: "hiperi algıl*" },
    { pattern: "hipo algıl*" },
    { pattern: "hiper algıl*" },
    { pattern: "hipoyu tespit*" },
    { pattern: "hiperi tespit*" },
    { pattern: "hipo tespit*" },
    { pattern: "hiper tespit*" },
    // G251: tr "tahmin*" is deliberately NOT a bare stem (the method and legal
    // texts say "tahmini"); only glucose/value prediction phrases are flagged.
    { pattern: "bildirim*", requiresContext: true, onlyContext: NOTIF_CONTEXT.tr },
    { pattern: "size bildirir", requiresContext: true },
    { pattern: "sizi bilgilendirir", requiresContext: true },
    { pattern: "bildirim gönderir", requiresContext: true },
    { pattern: "bildirim alırsınız", requiresContext: true },
    { pattern: "bildirim gelir", requiresContext: true },
    { pattern: "sizi izler" },
    { pattern: "şekerinizi izler" },
    { pattern: "glukozunuzu izler" },
    { pattern: "değerlerinizi izler" },
    { pattern: "kan şekerinizi izler" },
    { pattern: "glukoz izleme*" },
    { pattern: "glikoz izleme*" },
    { pattern: "şeker izleme*" },
    { pattern: "hasta izleme*" },
    { pattern: "uzaktan izleme*" },
    { pattern: "hemen haberdar" },
    { pattern: "anında", requiresContext: true },
    { pattern: "anlık*", requiresContext: true },
    { pattern: "öngör*", requiresContext: true },
    { pattern: "glukoz tahmin*" },
    { pattern: "glikoz tahmin*" },
    { pattern: "şeker tahmin*" },
    { pattern: "şekeri tahmin*" },
    { pattern: "şekerinizi tahmin*" },
    { pattern: "şekerinin tahmin*" },
    { pattern: "değer tahmin*", requiresContext: true },
    { pattern: "değeri tahmin*", requiresContext: true },
    { pattern: "değerleri tahmin*", requiresContext: true },
    { pattern: "değerini tahmin*", requiresContext: true },
    { pattern: "değerinizi tahmin*", requiresContext: true },
    { pattern: "değerlerinizi tahmin*", requiresContext: true },
    { pattern: "değerlerin tahmin*", requiresContext: true },
    { pattern: "tahmin eder*", requiresContext: true },
    { pattern: "düşmek üzere" },
    { pattern: "yakında düşük" },
    { pattern: "yakında düşecek" },
    { pattern: "önle*", except: ["m"], requiresContext: true },
    { pattern: "terapi*", requiresContext: true },
    { pattern: "eşik*", requiresContext: true, onlyContext: ALERT_TERMS.tr },
    { pattern: "acil*", requiresContext: true },
    { pattern: "hayati tehlike*", requiresContext: true },
    { pattern: "takipçi*", requiresContext: true },
    { pattern: "bakım veren*", requiresContext: true },
    { pattern: "bolus hesap*" },
    { pattern: "doz hesap*" },
    { pattern: "dozlama*" },
    { pattern: "düzeltme faktör*" },
    { pattern: "klinik düzey*" },
    { pattern: "klinik sınıf*" },
    { pattern: "klinik kalite*" },
    { pattern: "tıbbi düzey*" },
    { pattern: "tıbbi sınıf*" },
    { pattern: "tıbbi kalite*" },
    { pattern: "klinik olarak kanıtlan*" },
    { pattern: "klinik olarak doğrulan*" },
    { pattern: "FDA onaylı*" },
    { pattern: "FDA onayı*" },
    { pattern: "CE işareti*" },
    { pattern: "CE belgesi*" },
    { pattern: "parmak ucu yerine" },
    { pattern: "parmak ucu ölçümü yerine" },
    { pattern: "parmak ucu ölçümünün yerini" },
    { pattern: "parmak ucu testi yerine" },
    { pattern: "parmak ucu testinin yerini" },
    { pattern: "parmak ucu ölçümüne gerek" },
    { pattern: "parmak ucu ölçümü gerektirmez" },
    { pattern: "parmak ucu ölçümü olmadan" },
    { pattern: "parmak delme yerine" },
    { pattern: "parmak delmeye gerek" },
  ],
  de: [
    { pattern: "Alarm*", requiresContext: true },
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
    // G251
    { pattern: "Warnung*", requiresContext: true },
    { pattern: "Alert*", requiresContext: true },
    { pattern: "Benachrichtigung*", requiresContext: true, onlyContext: NOTIF_CONTEXT.de },
    { pattern: "benachrichtigt Sie", requiresContext: true },
    { pattern: "Benachrichtigung bei", requiresContext: true },
    { pattern: "Benachrichtigungen bei", requiresContext: true },
    { pattern: "Benachrichtigung, wenn", requiresContext: true },
    { pattern: "Benachrichtigungen, wenn", requiresContext: true },
    { pattern: "überwacht Ihre" },
    { pattern: "überwacht Sie" },
    { pattern: "überwachen Ihre" },
    { pattern: "Glukoseüberwachung*" },
    { pattern: "Blutzuckerüberwachung*" },
    { pattern: "Fernüberwachung*" },
    { pattern: "Patientenüberwachung*" },
    { pattern: "Glukosemonitoring*" },
    { pattern: "Blutzuckermonitoring*" },
    { pattern: "Fernmonitoring*" },
    { pattern: "Patientenmonitoring*" },
    { pattern: "Vorhersage*", requiresContext: true },
    { pattern: "vorhersag*", requiresContext: true },
    { pattern: "Prognose*", requiresContext: true },
    { pattern: "prognostizier*", requiresContext: true },
    { pattern: "verhinder*", requiresContext: true },
    { pattern: "Therapie*", requiresContext: true },
    { pattern: "Schwellenwert*", requiresContext: true, onlyContext: ALERT_TERMS.de },
    { pattern: "Notfall*", requiresContext: true },
    { pattern: "lebensbedrohlich*", requiresContext: true },
    { pattern: "Follower*", requiresContext: true },
    { pattern: "Diagnose*" },
    { pattern: "diagnostisch*" },
    { pattern: "Diagnostik*" },
    { pattern: "Bolusrechner*" },
    { pattern: "Dosisrechner*" },
    { pattern: "Korrekturfaktor*" },
    { pattern: "klinische Qualität" },
    { pattern: "medizinische Qualität" },
    { pattern: "klinisch bewiesen" },
    { pattern: "klinisch validiert" },
    { pattern: "FDA-zugelassen" },
    { pattern: "FDA zugelassen" },
    { pattern: "CE-Kennzeichen*" },
    { pattern: "CE-Zeichen*" },
    { pattern: "CE-zertifiziert" },
    { pattern: "ersetzt den Fingerstich" },
    { pattern: "ersetzt Fingerstiche" },
    { pattern: "anstelle von Fingerstichen" },
    { pattern: "statt Fingerstichen" },
    { pattern: "ohne Fingerstich*" },
  ],
  fr: [
    { pattern: "alerte*", requiresContext: true },
    { pattern: "alarme*", requiresContext: true },
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
    { pattern: "détecte les hypo" },
    { pattern: "détecte les hypos" },
    { pattern: "détecte les hyper" },
    { pattern: "détecte les hyperglyc*" },
    { pattern: "détecte les hypers" },
    { pattern: "détecte l'hypoglyc*" },
    { pattern: "détecte l'hyperglyc*" },
    { pattern: "détecte l\u2019hypoglyc*" },
    { pattern: "détecte l\u2019hyperglyc*" },
    { pattern: "détecte une hypoglyc*" },
    { pattern: "détecte une hypo" },
    { pattern: "détecte des hypos" },
    { pattern: "détecte une hyperglyc*" },
    { pattern: "détecte une hyper" },
    { pattern: "détecte des hypers" },
    { pattern: "détecte l'hypo" },
    { pattern: "détecte l'hyper" },
    { pattern: "détecte l\u2019hypo" },
    { pattern: "détecte l\u2019hyper" },
    // G251
    { pattern: "notification*", requiresContext: true, onlyContext: NOTIF_CONTEXT.fr, except: ["s.ts"] },
    { pattern: "vous notifie", requiresContext: true },
    { pattern: "notification en cas", requiresContext: true },
    { pattern: "notifications en cas", requiresContext: true },
    { pattern: "notification quand", requiresContext: true },
    { pattern: "notification lorsque", requiresContext: true },
    { pattern: "notifications lorsque", requiresContext: true },
    { pattern: "surveille votre" },
    { pattern: "surveille vos" },
    { pattern: "surveillance de la glycémie" },
    { pattern: "surveillance du glucose" },
    { pattern: "surveillance à distance" },
    { pattern: "surveillance des patients" },
    { pattern: "monitoring", requiresContext: true },
    { pattern: "vous prévient" },
    { pattern: "prédit*", requiresContext: true },
    { pattern: "prédire", requiresContext: true },
    { pattern: "prédiction*", requiresContext: true },
    { pattern: "prévision*", requiresContext: true },
    { pattern: "prévenir", requiresContext: true },
    { pattern: "thérap*", requiresContext: true },
    { pattern: "seuil*", requiresContext: true, onlyContext: ALERT_TERMS.fr },
    { pattern: "urgence*", requiresContext: true },
    { pattern: "diagnostic" },
    { pattern: "diagnostics" },
    { pattern: "calculateur de bolus" },
    { pattern: "calculateur de dose" },
    { pattern: "facteur de correction" },
    { pattern: "qualité clinique" },
    { pattern: "qualité médicale" },
    { pattern: "cliniquement prouvé*" },
    { pattern: "cliniquement validé*" },
    { pattern: "approuvé par la FDA" },
    { pattern: "autorisé par la FDA" },
    { pattern: "marquage CE" },
    { pattern: "remplace les piqûres" },
    { pattern: "remplace la piqûre" },
    { pattern: "sans piqûre au doigt" },
  ],
  es: [
    { pattern: "alarma*", requiresContext: true },
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
    { pattern: "detecta hipo" },
    { pattern: "detecta hipos" },
    { pattern: "detecta hiper" },
    { pattern: "detecta hipers" },
    { pattern: "detecta las hipos" },
    { pattern: "detecta las hipers" },
    { pattern: "detecta la hipo" },
    { pattern: "detecta la hiper" },
    { pattern: "detecta una hipo" },
    { pattern: "detecta una hiper" },
    { pattern: "detecta las hipogli*" },
    { pattern: "detecta las hipoglu*" },
    { pattern: "detecta las hipergli*" },
    { pattern: "detecta las hiperglu*" },
    { pattern: "detecta la hipogli*" },
    { pattern: "detecta la hipoglu*" },
    { pattern: "detecta la hipergli*" },
    { pattern: "detecta la hiperglu*" },
    // G251
    { pattern: "alerta*", requiresContext: true },
    { pattern: "notificaci*", requiresContext: true, onlyContext: NOTIF_CONTEXT.es },
    { pattern: "le notifica", requiresContext: true },
    { pattern: "le notificará", requiresContext: true },
    { pattern: "notificación cuando", requiresContext: true },
    { pattern: "notificaciones cuando", requiresContext: true },
    { pattern: "notificación si", requiresContext: true },
    { pattern: "notificaciones si", requiresContext: true },
    { pattern: "monitorea su" },
    { pattern: "monitorea sus" },
    { pattern: "monitoriza su" },
    { pattern: "monitoriza sus" },
    { pattern: "monitoreo de glucosa" },
    { pattern: "monitoreo de la glucosa" },
    { pattern: "monitorización de la glucosa" },
    { pattern: "monitoreo remoto" },
    { pattern: "monitorización remota" },
    { pattern: "monitoreo de pacientes" },
    { pattern: "monitorización de pacientes" },
    { pattern: "predice*", requiresContext: true },
    { pattern: "predecir", requiresContext: true },
    { pattern: "predicci*", requiresContext: true },
    { pattern: "pronóstic*", requiresContext: true },
    { pattern: "previene*", requiresContext: true },
    { pattern: "prevenir", requiresContext: true },
    { pattern: "terapia*", requiresContext: true },
    { pattern: "umbral*", requiresContext: true, onlyContext: ALERT_TERMS.es },
    { pattern: "urgencia*", requiresContext: true },
    { pattern: "emergencia*", requiresContext: true },
    { pattern: "diagnóstico*" },
    { pattern: "calculadora de bolo" },
    { pattern: "calculadora de dosis" },
    { pattern: "dosificación" },
    { pattern: "factor de corrección" },
    { pattern: "grado clínico" },
    { pattern: "grado médico" },
    { pattern: "clínicamente probado*" },
    { pattern: "clínicamente validado*" },
    { pattern: "aprobado por la FDA" },
    { pattern: "autorizado por la FDA" },
    { pattern: "marcado CE" },
    { pattern: "sustituye los pinchazos" },
    { pattern: "reemplaza los pinchazos" },
    { pattern: "en lugar de pinchazos" },
    { pattern: "sin pinchazos en el dedo" },
  ],
  it: [
    { pattern: "allarm*", requiresContext: true },
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
    { pattern: "rileva ipo" },
    { pattern: "rileva iper" },
    { pattern: "rileva le ipo" },
    { pattern: "rileva le iper" },
    { pattern: "rileva l'ipo" },
    { pattern: "rileva l'iper" },
    { pattern: "rileva l\u2019ipo" },
    { pattern: "rileva l\u2019iper" },
    // G251
    { pattern: "allert*", requiresContext: true },
    { pattern: "notific*", requiresContext: true, onlyContext: NOTIF_CONTEXT.it, except: ["ations.ts"] },
    { pattern: "La notifica", requiresContext: true },
    { pattern: "notifica quando", requiresContext: true },
    { pattern: "notifiche quando", requiresContext: true },
    { pattern: "notifica se", requiresContext: true },
    { pattern: "notifiche se", requiresContext: true },
    { pattern: "monitora la Sua" },
    { pattern: "monitora il Suo" },
    { pattern: "monitoraggio del glucosio" },
    { pattern: "monitoraggio della glicemia" },
    { pattern: "monitoraggio remoto" },
    { pattern: "monitoraggio dei pazienti" },
    { pattern: "predice*", requiresContext: true },
    { pattern: "previsione*", requiresContext: true },
    { pattern: "previene*", requiresContext: true },
    { pattern: "prevenire", requiresContext: true },
    { pattern: "terapi*", requiresContext: true },
    { pattern: "soglia*", requiresContext: true, onlyContext: ALERT_TERMS.it },
    { pattern: "urgenz*", requiresContext: true },
    { pattern: "diagnosi" },
    { pattern: "diagnostic*" },
    { pattern: "calcolatore di bolo" },
    { pattern: "calcolatore di dose" },
    { pattern: "calcolatore di insulina" },
    { pattern: "fattore di correzione" },
    { pattern: "grado clinico" },
    { pattern: "grado medico" },
    { pattern: "clinicamente provato" },
    { pattern: "clinicamente validato" },
    { pattern: "approvato dalla FDA" },
    { pattern: "approvato FDA" },
    { pattern: "marcatura CE" },
    { pattern: "marchio CE" },
    { pattern: "sostituisce il pungidito" },
    { pattern: "sostituisce i pungidito" },
    { pattern: "sostituisce la puntura" },
    { pattern: "senza pungidito" },
  ],
  pt: [
    { pattern: "alarme*", requiresContext: true },
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
    { pattern: "detecta hipo" },
    { pattern: "detecta hipos" },
    { pattern: "detecta hiper" },
    { pattern: "detecta hipers" },
    { pattern: "detecta as hipos" },
    { pattern: "detecta as hipers" },
    { pattern: "detecta a hipo" },
    { pattern: "detecta a hiper" },
    // G251
    { pattern: "alerta*", requiresContext: true },
    { pattern: "notifica*", requiresContext: true, onlyContext: NOTIF_CONTEXT.pt, except: ["tions.ts"] },
    { pattern: "notifica você", requiresContext: true },
    { pattern: "notificação quando", requiresContext: true },
    { pattern: "notificações quando", requiresContext: true },
    { pattern: "notificação se", requiresContext: true },
    { pattern: "notificações se", requiresContext: true },
    { pattern: "monitora sua" },
    { pattern: "monitora suas" },
    { pattern: "monitoramento de glicose" },
    { pattern: "monitoramento da glicose" },
    { pattern: "monitoramento da glicemia" },
    { pattern: "monitoramento remoto" },
    { pattern: "monitoramento de pacientes" },
    { pattern: "monitorização de glicose" },
    { pattern: "monitorização remota" },
    { pattern: "prevê", requiresContext: true },
    { pattern: "prediz*", requiresContext: true },
    { pattern: "previsão", requiresContext: true },
    { pattern: "previsões", requiresContext: true },
    { pattern: "previne*", requiresContext: true },
    { pattern: "prevenir", requiresContext: true },
    { pattern: "terapia*", requiresContext: true },
    { pattern: "limiar*", requiresContext: true, onlyContext: ALERT_TERMS.pt },
    { pattern: "urgente*", requiresContext: true },
    { pattern: "emergência*", requiresContext: true },
    { pattern: "diagnóstico*" },
    { pattern: "calculadora de bolus" },
    { pattern: "calculadora de dose" },
    { pattern: "calculadora de insulina" },
    { pattern: "fator de correção" },
    { pattern: "grau clínico" },
    { pattern: "grau médico" },
    { pattern: "clinicamente comprovado*" },
    { pattern: "clinicamente validado*" },
    { pattern: "aprovado pela FDA" },
    { pattern: "marcação CE" },
    { pattern: "marca CE" },
    { pattern: "substitui as picadas" },
    { pattern: "substitui a picada" },
    { pattern: "sem picada no dedo" },
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
    // G251
    { pattern: "إشعار", requiresContext: true, onlyContext: NOTIF_CONTEXT.ar },
    { pattern: "يخطرك", requiresContext: true },
    { pattern: "إشعار عند", requiresContext: true },
    { pattern: "إشعارات عند", requiresContext: true },
    { pattern: "يراقب", requiresContext: true },
    { pattern: "مراقبة الجلوكوز" },
    { pattern: "مراقبة السكر" },
    { pattern: "مراقبة المرضى" },
    { pattern: "مراقبة عن بعد" },
    { pattern: "رصد الجلوكوز" },
    { pattern: "يتنبأ", requiresContext: true },
    { pattern: "التنبؤ", requiresContext: true },
    { pattern: "تنبؤ", requiresContext: true },
    { pattern: "يمنع", requiresContext: true },
    { pattern: "عتبة", requiresContext: true, onlyContext: ALERT_TERMS.ar },
    { pattern: "تشخيص" },
    { pattern: "حاسبة الجرعة" },
    { pattern: "حاسبة البولس" },
    { pattern: "عامل التصحيح" },
    { pattern: "درجة سريرية" },
    { pattern: "جودة طبية" },
    { pattern: "مثبت سريريًا" },
    { pattern: "معتمد من FDA" },
    { pattern: "موافقة FDA" },
    { pattern: "علامة CE" },
    { pattern: "يحل محل وخز الإصبع" },
    { pattern: "بديل عن وخز الإصبع" },
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
    // G251
    { pattern: "アラート", requiresContext: true },
    { pattern: "通知", requiresContext: true, onlyContext: NOTIF_CONTEXT.ja },
    { pattern: "通知します", requiresContext: true },
    { pattern: "通知が届", requiresContext: true },
    { pattern: "モニタリング" },
    { pattern: "を監視" },
    { pattern: "予測", requiresContext: true },
    { pattern: "予報", requiresContext: true },
    { pattern: "即時", requiresContext: true },
    { pattern: "即座", requiresContext: true },
    { pattern: "防ぎます", requiresContext: true },
    { pattern: "予防", requiresContext: true },
    { pattern: "診断" },
    { pattern: "治療", requiresContext: true },
    { pattern: "緊急", requiresContext: true },
    { pattern: "ボーラス計算" },
    { pattern: "用量計算" },
    { pattern: "補正係数" },
    { pattern: "臨床グレード" },
    { pattern: "医療グレード" },
    { pattern: "臨床的に証明" },
    { pattern: "臨床的に検証" },
    { pattern: "FDA承認" },
    { pattern: "FDA認可" },
    { pattern: "CEマーク" },
    { pattern: "指先採血の代わり" },
    { pattern: "指先穿刺の代わり" },
    { pattern: "指先採血が不要" },
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
  "hypos",
  "hipo",
  "hiper",
  "hipos",
  "ipo",
  "iper",
  "low",
  "lows",
  "high",
  "highs",
  "glukoz*",
  "glukose*",
  "mg/dL",
  "mmol",
  "şeker*",
  "glisemi*",
  "glikoz*",
  "hipogli*",
  "hipoglu*",
  "hipergli*",
  "hiperglu*",
  "Blutzucker*",
  "Unterzucker*",
  "Überzucker*",
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

// Google Play's Health Content policy requires non-device health apps to say
// in the store description that the app "is not a medical device and does not
// diagnose, treat, cure, or prevent any medical condition". That sentence has
// to contain words this lint bans everywhere else ("diagnose", "treat",
// "prevent"), and its translations ("ne diagnostique pas", "no diagnostica",
// "teşhis koymaz", ...) hit the per-language lists too.
//
// The exemption is deliberately the narrowest possible: only the matched text
// that lies wholly inside an occurrence of one of these exact sentences is
// excused, in store files (zerospike-store, fastlane/metadata) of the SAME
// language, case-insensitively. It is never applied to in-app strings (the
// app has its own disclaimer anchors above), never to a file of another
// language, and a banned phrase next to the sentence is still a finding, so
// "diagnose" anywhere outside the sentence is still reported.
//
// Add each language's approved translation here (exact text, without the
// leading "<app> is" subject so the sentence stays valid after any subject)
// when the store-text card lands. An empty list excuses nothing.
const GOOGLE_DISCLOSURE_REASON =
  "Google Play Health Content policy: non-device health apps must state in the store description that the app is not a medical device and does not diagnose, treat, cure, or prevent any medical condition; the banned words are allowed only inside this exact sentence";
const GOOGLE_DISCLOSURE_SENTENCES = {
  en: ["not a medical device and does not diagnose, treat, cure, or prevent any medical condition"],
  tr: [],
  de: [],
  fr: [],
  es: [],
  it: [],
  pt: [],
  ar: [],
  ja: [],
};

// [start, end) spans of the Google disclosure sentence in a store line whose
// file language is `locale`.
function googleDisclosureSpans(locale, line) {
  const sentences = GOOGLE_DISCLOSURE_SENTENCES[locale] || [];
  return sentences.length > 0 ? anchorSpans(locale, line, sentences) : [];
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

const termMatcherCache = new Map();
function termMatchers(terms, locale) {
  const key = locale + "\u0000" + terms.join("\u0001");
  let list = termMatcherCache.get(key);
  if (!list) {
    list = terms.map((t) => (SUBSTRING_LOCALES.has(locale) ? buildSubstringMatcher(t) : buildLatinMatcher(t, { locale })));
    termMatcherCache.set(key, list);
  }
  return list;
}

// Whether a pattern entry's context condition holds for `text`:
//   requiresContext: glucose wording (or, with orContext, one of those terms)
//   onlyContext:     one of those terms; glucose wording alone is not enough
// An entry with neither is unconditional. onlyContext entries also carry
// requiresContext: true so a consumer that only knows the glucose-context
// flag (the store pipeline selftests) still treats them as conditional.
function contextOk(entry, text, locale) {
  const { requiresContext, onlyContext, orContext } = entry;
  const anyTerm = (terms) => termMatchers(terms, locale).some((match) => match(text) !== null);
  if (onlyContext) return anyTerm(onlyContext);
  if (!requiresContext) return true;
  if (hasGlucoseContext(text, locale)) return true;
  return !!orContext && anyTerm(orContext);
}

module.exports = {
  contextOk,
  GOOGLE_DISCLOSURE_REASON,
  GOOGLE_DISCLOSURE_SENTENCES,
  googleDisclosureSpans,
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
