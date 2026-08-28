#!/usr/bin/env python3
"""S9: rebuild composite-texts-2.0.0.json from the shipped composites.

Every string below was transcribed off a rendered panel (android-phone for
01/02/04/05/08/09, iphone for 07-spike, google-play-extras for the feature
graphic tagline), then corrected for the project's one-address-per-language
rule where the rendered copy used the informal form. No other wording changed.
"""
import json, collections

LANGS = ["tr", "en", "de", "es", "fr", "it", "pt", "ar", "ja"]
PANELS = ["01-ring", "02-bodymap", "04-food", "05-insights", "07-spike", "08-takip", "09-reminders"]

T = {}

T["01-ring"] = {
 "tr": ("Tek bakışta gününüz",
        "Halka son ölçümünüzü, seri şeridiniz haftanızı gösterir. Tokluk sayacı panelde canlı akar.",
        "12 gün seri"),
 "en": ("Your day at a glance",
        "The ring shows your latest reading and your week. The post-meal timer runs live on the dashboard.",
        "12-day streak"),
 "de": ("Ihr Tag auf einen Blick",
        "Der Ring zeigt Ihren letzten Wert und Ihre Woche. Der Timer nach dem Essen läuft live auf dem Dashboard.",
        "12-Tage-Serie"),
 "es": ("Su día de un vistazo",
        "El anillo muestra su última lectura y su semana. El temporizador posprandial corre en vivo en el panel.",
        "Racha de 12 días"),
 "fr": ("Votre journée en un coup d'œil",
        "L'anneau montre votre dernière mesure et votre semaine. Le minuteur post-repas s'affiche en direct.",
        "Série de 12 jours"),
 "it": ("La Sua giornata a colpo d'occhio",
        "L'anello mostra l'ultima misurazione e la settimana. Il timer post-prandiale scorre in diretta.",
        "Serie di 12 giorni"),
 "pt": ("Seu dia em um relance",
        "O anel mostra sua última medição e sua semana. O timer pós-refeição corre ao vivo no painel.",
        "12 dias seguidos"),
 "ar": ("يومك في لمحة",
        "تعرض الحلقة آخر قياس وأسبوعك كاملًا. مؤقت ما بعد الوجبة يعمل مباشرة على اللوحة.",
        "12 يومًا متتاليًا"),
 "ja": ("1日をひと目で",
        "リングが最新の血糖値と1週間の記録を表示。食後タイマーはダッシュボードでライブ表示されます。",
        "12日連続"),
}

T["02-bodymap"] = {
 "tr": ("Her bölge haritada",
        "Kaydettiğiniz enjeksiyonlar vücut haritasında. En uzun süredir kullanmadığınız nokta hep görünür.",
        "Bölge rotasyonu"),
 "en": ("Every site on the map",
        "Your logged injections on a body map. The point you have not used the longest is always visible.",
        "Site rotation"),
 "de": ("Jede Stelle auf der Karte",
        "Ihre protokollierten Injektionen auf einer Körperkarte. Der am längsten ungenutzte Punkt ist immer sichtbar.",
        "Stellen-Rotation"),
 "es": ("Cada zona en el mapa",
        "Sus inyecciones registradas en un mapa corporal. El punto que lleva más tiempo sin usar, siempre visible.",
        "Rotación de zonas"),
 "fr": ("Chaque site sur la carte",
        "Vos injections enregistrées sur une carte corporelle. Le point inutilisé depuis le plus longtemps reste visible.",
        "Rotation des sites"),
 "it": ("Ogni sito sulla mappa",
        "Le iniezioni registrate su una mappa corporea. Il punto non usato da più tempo resta sempre visibile.",
        "Rotazione dei siti"),
 "pt": ("Cada local no mapa",
        "Suas aplicações registradas em um mapa corporal. O ponto sem uso há mais tempo fica sempre visível.",
        "Rodízio de locais"),
 "ar": ("كل موضع على الخريطة",
        "حقنك المسجلة على خريطة للجسم. النقطة غير المستخدمة لأطول فترة تبقى ظاهرة دائمًا.",
        "تناوب المواضع"),
 "ja": ("注射部位をマップで",
        "記録した注射を体のマップに表示。最も長く使っていない部位がいつでも確認できます。",
        "部位ローテーション"),
}

T["04-food"] = {
 "tr": ("Saniyeler içinde öğün",
        "1000+ besinlik veritabanı, barkod tarama ve favoriler. Karbonhidrat değerleri hazır gelir.",
        "1000+ besin"),
 "en": ("Meals in seconds",
        "A 1000+ item food database with barcode scanning and favorites. Carb counts come ready.",
        "1000+ foods"),
 "de": ("Mahlzeiten in Sekunden",
        "Datenbank mit 1000+ Lebensmitteln, Barcode-Scan und Favoriten. Kohlenhydratwerte sind hinterlegt.",
        "1000+ Lebensmittel"),
 "es": ("Comidas en segundos",
        "Base de datos con más de 1000 alimentos, escáner de códigos y favoritos. Los carbohidratos vienen listos.",
        "1000+ alimentos"),
 "fr": ("Un repas en quelques secondes",
        "Base de plus de 1000 aliments avec scan de codes-barres et favoris. Les glucides sont déjà renseignés.",
        "1000+ aliments"),
 "it": ("Pasti in pochi secondi",
        "Database con oltre 1000 alimenti, scansione dei codici a barre e preferiti. I carboidrati sono già pronti.",
        "1000+ alimenti"),
 "pt": ("Refeições em segundos",
        "Banco com mais de 1000 alimentos, leitor de código de barras e favoritos. Os carboidratos já vêm prontos.",
        "1000+ alimentos"),
 "ar": ("الوجبات في ثوانٍ",
        "قاعدة تضم أكثر من 1000 صنف مع مسح الباركود والمفضلة. قيم الكربوهيدرات جاهزة.",
        "أكثر من 1000 صنف"),
 "ja": ("食事記録は数秒で",
        "1000品目以上のデータベース、バーコード読み取り、お気に入り。炭水化物量も入力済みです。",
        "1000品目以上"),
}

T["05-insights"] = {
 "tr": ("Eğilimlerinizi görün",
        "Haftalık karşılaştırma, saat şeridi, AGP yüzdelik bantları ve seriler; PDF rapora da girer.",
        "AGP yüzdelik bantları"),
 "en": ("See your trends",
        "Weekly comparison, a time-of-day band, AGP percentile bands and series; it all feeds the PDF report too.",
        "AGP percentile bands"),
 "de": ("Sehen Sie Ihre Trends",
        "Wochenvergleich, Tageszeit-Band, AGP-Perzentilbänder und Serien; alles fließt auch in den PDF-Bericht ein.",
        "AGP-Perzentilbänder"),
 "es": ("Mire sus tendencias",
        "Comparación semanal, franja horaria, bandas percentil AGP y series; todo aparece también en el PDF.",
        "Bandas percentil AGP"),
 "fr": ("Voyez vos tendances",
        "Comparaison hebdomadaire, bande horaire, bandes percentile AGP et séries ; tout figure aussi dans le PDF.",
        "Bandes percentile AGP"),
 "it": ("Veda i Suoi andamenti",
        "Confronto settimanale, fascia oraria, bande percentili AGP e serie; tutto confluisce anche nel PDF.",
        "Bande percentili AGP"),
 "pt": ("Veja suas tendências",
        "Comparação semanal, faixa horária, faixas percentis AGP e séries; tudo entra também no PDF.",
        "Faixas percentis AGP"),
 "ar": ("شاهد اتجاهاتك",
        "مقارنة أسبوعية، نطاق حسب وقت اليوم، نطاقات AGP المئوية والسلاسل الزمنية؛ كل ذلك في تقرير PDF أيضًا.",
        "نطاقات AGP المئوية"),
 "ja": ("傾向をチェック",
        "週間比較、時間帯別の帯、AGPパーセンタイル帯、系列。すべてPDFレポートにも反映されます。",
        "AGPパーセンタイル帯"),
}

T["07-spike"] = {
 "tr": ("Sorulara Spike yanıt verir",
        "Genel diyabet eğitimi ve uygulama yardımı için sohbet. Tıbbi tavsiye vermez, kararlar sağlık ekibinindir.",
        "Spike AI"),
 "en": ("Spike answers your questions",
        "Chat for general diabetes education and app help. It does not give medical advice; care stays with your team.",
        "Spike AI"),
 "de": ("Spike beantwortet Fragen",
        "Chat für allgemeine Diabetes-Bildung und App-Hilfe. Gibt keinen medizinischen Rat; Entscheidungen bleiben beim Behandlungsteam.",
        "Spike AI"),
 "es": ("Spike responde sus preguntas",
        "Chat de educación general sobre diabetes y ayuda con la app. No da consejo médico; las decisiones son de su equipo.",
        "Spike AI"),
 "fr": ("Spike répond à vos questions",
        "Un chat d'information générale sur le diabète et d'aide sur l'app. Sans avis médical; les décisions restent à votre équipe.",
        "Spike AI"),
 "it": ("Spike risponde alle domande",
        "Chat di educazione generale sul diabete e aiuto sull'app. Nessun consiglio medico; le decisioni restano al Suo team.",
        "Spike AI"),
 "pt": ("Spike responde às perguntas",
        "Chat de educação geral sobre diabetes e ajuda no app. Não dá orientação médica; as decisões são da sua equipe.",
        "Spike AI"),
 "ar": ("سبايك يجيب عن الأسئلة",
        "محادثة للتثقيف العام حول السكري والمساعدة في التطبيق. لا يقدم نصيحة طبية؛ القرار لفريقك الصحي.",
        "Spike AI"),
 "ja": ("質問にはSpikeが回答",
        "糖尿病の一般的な知識とアプリの使い方をチャットで。医学的な助言は行わず、判断は医療チームに委ねます。",
        "Spike AI"),
}

T["08-takip"] = {
 "tr": ("Tanı olmadan takip",
        "Kurulumda tanı almadığınızı söyleyin; insülin ekranları gizlenir, sade bir şeker ve öğün günlüğü kalır.",
        "Sade görünüm"),
 "en": ("Tracking without a diagnosis",
        "Say you have no diagnosis during setup; insulin screens stay hidden, a simple glucose and meal journal remains.",
        "Simple view"),
 "de": ("Tracking ohne Diagnose",
        "Geben Sie bei der Einrichtung an, keine Diagnose zu haben; Insulin-Bildschirme bleiben verborgen, ein einfaches Tagebuch bleibt.",
        "Einfache Ansicht"),
 "es": ("Seguimiento sin diagnóstico",
        "Indique en la configuración que no tiene diagnóstico; las pantallas de insulina quedan ocultas y queda un diario sencillo.",
        "Vista sencilla"),
 "fr": ("Suivi sans diagnostic",
        "Indiquez à la configuration que vous n'avez pas de diagnostic; les écrans d'insuline restent masqués, un carnet simple demeure.",
        "Vue simple"),
 "it": ("Monitoraggio senza diagnosi",
        "Indichi durante la configurazione di non avere una diagnosi; le schermate insulina restano nascoste, resta un diario semplice.",
        "Vista semplice"),
 "pt": ("Acompanhamento sem diagnóstico",
        "Informe na configuração que você não tem diagnóstico; as telas de insulina ficam ocultas e resta um diário simples.",
        "Visão simples"),
 "ar": ("متابعة من دون تشخيص",
        "حدد أثناء الإعداد أنه لا يوجد تشخيص؛ تبقى شاشات الإنسولين مخفية ويبقى دفتر بسيط للسكر والوجبات.",
        "عرض مبسط"),
 "ja": ("診断前でも記録を",
        "設定で「診断なし」を選ぶと、インスリン画面は非表示に。血糖値と食事のシンプルな記録だけが残ります。",
        "シンプル表示"),
}

T["09-reminders"] = {
 "tr": ("Hatırlatıcılar, tam sizin saatinizde",
        "Ölçüm, ilaç ve bazal hatırlatıcılarınızı kurarsınız; her profilin kendi listesi olur. İlaç hatırlatıcısı kayıtlı ilaçlarınızdan seçilir.",
        "iOS 26'da gerçek alarm", "İlaçlarım"),
 "en": ("Reminders, right on your time",
        "You set glucose, medication and basal reminders in one place; each profile has its own list, drawn from your saved meds.",
        "Real alarm on iOS 26", "My medications"),
 "de": ("Erinnerungen, genau zu Ihrer Zeit",
        "Mess-, Medikamenten- und Basal-Erinnerungen richten Sie ein; jedes Profil hat seine eigene Liste aus Ihren Medikamenten.",
        "Echter Alarm unter iOS 26", "Meine Medikamente"),
 "es": ("Recordatorios, justo a su hora",
        "Configura recordatorios de glucosa, medicamento e insulina basal; cada perfil tiene su lista de medicamentos guardados.",
        "Alarma real en iOS 26", "Mis medicamentos"),
 "fr": ("Des rappels, pile à votre heure",
        "Vous réglez vos rappels de mesure, médicament et insuline basale ; chaque profil a sa liste, tirée de vos médicaments.",
        "Alarme réelle sous iOS 26", "Mes médicaments"),
 "it": ("Promemoria, proprio alla Sua ora",
        "Imposti i promemoria di glicemia, farmaco e insulina basale; ogni profilo ha il proprio elenco, scelto tra i farmaci salvati.",
        "Sveglia reale su iOS 26", "I miei farmaci"),
 "pt": ("Lembretes, na sua hora certa",
        "Você configura lembretes de glicemia, medicamento e insulina basal; cada perfil tem sua lista de medicamentos salvos.",
        "Alarme real no iOS 26", "Meus medicamentos"),
 "ar": ("تذكيرات في وقتك تمامًا",
        "تُعدّ تذكيرات القياس والدواء والإنسولين القاعدي؛ لكل ملف تعريف قائمته الخاصة. تذكير الدواء يقترح من أدويتك المسجّلة.",
        "منبّه حقيقي في iOS 26", "أدويتي"),
 "ja": ("リマインダーはいつもの時間に",
        "測定・お薬・基礎インスリンのリマインダーを一括管理。お薬のリマインダーは登録済みのお薬から選べます。",
        "iOS 26の本物のアラーム", "自分のお薬"),
}

TAGLINE = {
 "tr": "Şeker, öğün ve insülin günlüğü",
 "en": "Glucose, meal & insulin logbook",
 "de": "Blutzucker-, Mahlzeiten- und Insulin-Tagebuch",
 "es": "Diario de glucosa, comidas e insulina",
 "fr": "Carnet de glycémie, repas et insuline",
 "it": "Diario di glicemia, pasti e insulina",
 "pt": "Diário de glicemia, refeições e insulina",
 "ar": "يوميات السكر والوجبات والإنسولين",
 "ja": "血糖値・食事・インスリンの記録",
}

panels = collections.OrderedDict()
for p in PANELS:
    by_lang = collections.OrderedDict()
    for l in LANGS:
        entry = T[p][l]
        d = collections.OrderedDict([("title", entry[0]), ("subtitle", entry[1]), ("chip", entry[2])])
        if len(entry) > 3:
            d["chip2"] = entry[3]
        by_lang[l] = d
    panels[p] = by_lang

doc = collections.OrderedDict([
    ("panels", panels),
    ("featureGraphicTagline", collections.OrderedDict((l, TAGLINE[l]) for l in LANGS)),
])

OUT = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/composite-texts-2.0.0.json"
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print("wrote", OUT)
