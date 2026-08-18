#!/usr/bin/env python3
"""Central translated copy: per-frame headline/sub/chip, plus the synthetic
03-widget and 06-report scene labels.

The device-captured panels (01/02/04/05/07/08) come from
zerospike-store/composite-texts-2.0.0.json, which is the single source of
truth for them and covers 9 languages. The dict literal below only still
carries 03-widget and 06-report - those two panels are not re-produced for
2.0.0, so their 5 shipped languages stay frozen here; their 01/02/04/05/07
entries are overwritten by the JSON at import time."""
import json
import os

COMPOSITE_TEXTS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "zerospike-store", "composite-texts-2.0.0.json",
)

FRAME_COPY = {
    "tr": {
        "01-ring": ("Tek bakışta günün",
                    "Glukoz, öğün ve dozların tek ekranda; tokluk sayacı ve haftalık özet yanında",
                    "12 gün seri"),
        "02-bodymap": ("Her bölge haritada",
                       "Enjeksiyon noktalarını haritada izle; rotasyon ve en uzun kullanılmayan yer",
                       "Bölge rotasyonu"),
        "03-widget": ("Sayaç kilit ekranında",
                      "Tokluk sayacı kilit ekranında; 7 günlük ortalaman ana ekran widget'ında",
                      "Tokluk sayacı açık"),
        "04-food": ("Saniyeler içinde öğün",
                    "562 besin, barkod tarama ve hızlı ekleme; karbonhidratı saniyeler içinde kaydet",
                    "562 besin"),
        "05-insights": ("Eğilimlerini gör",
                        "Hedef aralıkta geçen süre, AGP profili ve eğilimler; 30 ve 90 günlük özetlerle",
                        "30 & 90 gün"),
        "06-report": ("Doktora hazır rapor",
                      "Her tarih aralığı için temiz PDF; özet, AGP ve zaman çizelgesiyle doktora hazır",
                      "PDF dışa aktar"),
        "07-spike": ("Sorulara Spike yanıt verir",
                     "Uygulama ve beslenme hakkında sorularına yanıt alır. Spike tıbbi tavsiye vermez, sağlık ekibinin yerini tutmaz.",
                     "Spike AI"),
    },
    "en": {
        "01-ring": ("Your day at a glance",
                    "Glucose, meals and doses on one screen; post-meal timer and weekly summary alongside",
                    "12-day streak"),
        "02-bodymap": ("Every site on the map",
                       "Track injection sites on the map; rotation and the longest-unused spot",
                       "Site rotation"),
        "03-widget": ("Timer on the lock screen",
                      "Post-meal timer on the lock screen; your 7-day average on the home screen widget",
                      "Post-meal timer on"),
        "04-food": ("Log a meal in seconds",
                    "562 foods, barcode scan and quick add; log carbs in seconds",
                    "562 foods"),
        "05-insights": ("See your patterns",
                        "Time in range, AGP profile and trends; with 30- and 90-day summaries",
                        "30 & 90 days"),
        "06-report": ("A report your doctor can read",
                      "A clean PDF for any date range; summary, AGP and timeline, ready for your doctor",
                      "Export PDF"),
        "07-spike": ("Spike answers your questions",
                     "Answers your questions about the app and nutrition. Spike doesn't give medical advice and isn't a substitute for your care team.",
                     "Spike AI"),
    },
    "de": {
        "01-ring": ("Dein Tag auf einen Blick",
                    "Glukose, Mahlzeiten und Dosen auf einem Bildschirm; Post-Meal-Timer und Wochenübersicht daneben",
                    "12 Tage in Folge"),
        "02-bodymap": ("Jede Stelle auf der Karte",
                       "Injektionsstellen auf der Karte verfolgen; Rotation und die am längsten nicht genutzte Stelle",
                       "Stellen-Rotation"),
        "03-widget": ("Timer auf dem Sperrbildschirm",
                      "Post-Meal-Timer auf dem Sperrbildschirm; dein 7-Tage-Durchschnitt im Homescreen-Widget",
                      "Post-Meal-Timer aktiv"),
        "04-food": ("Mahlzeit in Sekunden",
                    "562 Lebensmittel, Barcode-Scan und Schnelleingabe; Kohlenhydrate in Sekunden erfassen",
                    "562 Lebensmittel"),
        "05-insights": ("Erkenne deine Muster",
                        "Zeit im Zielbereich, AGP-Profil und Trends; mit 30- und 90-Tage-Übersichten",
                        "30 & 90 Tage"),
        "06-report": ("Ein Bericht für deinen Arzt",
                      "Ein sauberes PDF für jeden Zeitraum; Zusammenfassung, AGP und Zeitleiste, bereit für deinen Arzt",
                      "PDF exportieren"),
        "07-spike": ("Spike beantwortet deine Fragen",
                     "Beantwortet deine Fragen zu App und Ernährung. Spike gibt keine medizinische Beratung und ersetzt nicht dein Behandlungsteam.",
                     "Spike AI"),
    },
    "es": {
        "01-ring": ("Tu día de un vistazo",
                    "Glucosa, comidas y dosis en una pantalla; temporizador posprandial y resumen semanal al lado",
                    "Racha de 12 días"),
        "02-bodymap": ("Cada zona en el mapa",
                       "Sigue las zonas de inyección en el mapa; rotación y la zona sin usar hace más tiempo",
                       "Rotación de zona"),
        "03-widget": ("Temporizador en la pantalla de bloqueo",
                      "Temporizador posprandial en la pantalla de bloqueo; tu media de 7 días en el widget de inicio",
                      "Temporizador activo"),
        "04-food": ("Registra una comida en segundos",
                    "562 alimentos, escaneo de código de barras y registro rápido; registra carbohidratos en segundos",
                    "562 alimentos"),
        "05-insights": ("Observa tus patrones",
                        "Tiempo en rango, perfil AGP y tendencias; con resúmenes de 30 y 90 días",
                        "30 y 90 días"),
        "06-report": ("Un informe listo para tu médico",
                      "Un PDF claro para cualquier rango de fechas; resumen, AGP y cronología, listo para tu médico",
                      "Exportar PDF"),
        "07-spike": ("Spike responde tus preguntas",
                     "Responde tus preguntas sobre la app y la nutrición. Spike no da consejo médico ni sustituye a tu equipo de salud.",
                     "Spike AI"),
    },
    "fr": {
        "01-ring": ("Ta journée en un coup d'œil",
                    "Glycémie, repas et doses sur un seul écran ; minuteur postprandial et résumé hebdomadaire à côté",
                    "Série de 12 jours"),
        "02-bodymap": ("Chaque zone sur la carte",
                       "Suis les zones d'injection sur la carte ; rotation et la zone la moins utilisée récemment",
                       "Rotation des zones"),
        "03-widget": ("Minuteur sur l'écran verrouillé",
                      "Minuteur postprandial sur l'écran verrouillé ; votre moyenne sur 7 jours dans le widget d'accueil",
                      "Minuteur actif"),
        "04-food": ("Enregistre un repas en secondes",
                    "562 aliments, scan de code-barres et ajout rapide ; enregistre les glucides en quelques secondes",
                    "562 aliments"),
        "05-insights": ("Observe tes tendances",
                        "Temps dans la cible, profil AGP et tendances ; avec résumés sur 30 et 90 jours",
                        "30 et 90 jours"),
        "06-report": ("Un rapport prêt pour votre médecin",
                      "Un PDF clair pour toute période ; résumé, AGP et chronologie, prêt pour votre médecin",
                      "Exporter le PDF"),
        "07-spike": ("Spike répond à tes questions",
                     "Répond à vos questions sur l'appli et la nutrition. Spike ne donne pas de conseil médical et ne remplace pas votre équipe soignante.",
                     "Spike AI"),
    },
}

def _load_composite_texts():
    with open(COMPOSITE_TEXTS, encoding="utf-8") as fh:
        return json.load(fh)


_TEXTS = _load_composite_texts()

# panel chips already carry their own emoji inside the JSON string (e.g.
# "🔥 12 gün seri"), which would double up with CHIP_EMOJI's separate glyph
_CHIP_EMOJI_PREFIXES = tuple(sorted({c for c in "🔥🔄🍽📊📄✨📋"}))


def _split_chip(chip):
    for e in _CHIP_EMOJI_PREFIXES:
        if chip.startswith(e):
            return chip[len(e):].strip()
    return chip


for _panel, _by_lang in _TEXTS["panels"].items():
    for _lang, _entry in _by_lang.items():
        FRAME_COPY.setdefault(_lang, {})[_panel] = (
            _entry["title"], _entry["subtitle"], _split_chip(_entry["chip"]),
        )

FEATURE_TAGLINE = dict(_TEXTS["featureGraphicTagline"])

# canonical order, straight from the JSON matrix
LANGS = tuple(_TEXTS["panels"]["01-ring"].keys())

CHIP_EMOJI = {
    "01-ring": "🔥", "02-bodymap": "🔄", "03-widget": None,  # dot, not emoji
    "04-food": "🍽", "05-insights": "📊", "06-report": "📄", "07-spike": "✨",
    "08-takip": "📋",
}

# device-captured panels this round; 03-widget/06-report keep their 5-language
# 1.x composites and are not rebuilt here
PANELS_2_0_0 = ("01-ring", "02-bodymap", "04-food", "05-insights", "07-spike", "08-takip")

WIDGET_STRINGS = {
    "tr": dict(avg_glucose="ORT. GLUKOZ", last7="Son 7 gün", ongoing="zerospike · devam eden",
               timer_title="Tokluk Şekeri", min_left="{n} dk kaldı", min_unit="dk", date="26 Temmuz Pazar"),
    "en": dict(avg_glucose="AVG GLUCOSE", last7="Last 7 days", ongoing="zerospike · ongoing",
               timer_title="Post-meal glucose", min_left="{n} min left", min_unit="min", date="Sunday, July 26"),
    "de": dict(avg_glucose="Ø GLUKOSE", last7="Letzte 7 Tage", ongoing="zerospike · läuft",
               timer_title="Blutzucker nach dem Essen", min_left="noch {n} Min.", min_unit="Min.", date="Sonntag, 26. Juli"),
    "es": dict(avg_glucose="GLUCOSA MEDIA", last7="Últimos 7 días", ongoing="zerospike · en curso",
               timer_title="Glucosa posprandial", min_left="quedan {n} min", min_unit="min", date="domingo, 26 de julio"),
    "fr": dict(avg_glucose="GLYCÉMIE MOY.", last7="7 derniers jours", ongoing="zerospike · en cours",
               timer_title="Glycémie après repas", min_left="{n} min restantes", min_unit="min", date="dimanche 26 juillet"),
    # it/pt/ar/ja: every label below is the app's own widget string from
    # lib/i18n/locales/<lang>.ts (avgGlucose uppercased, avgWindow at n=7,
    # timerTitle, remaining at {{time}}="72 <minuteShort>", minuteShort), and the
    # date is Intl weekday/month/day for that locale on 2026-07-26. Only
    # `ongoing` is not app copy - it is Android's own notification-shade label,
    # which the app never ships a string for.
    # Two deliberate deviations from a literal template render:
    #  - ar last7: widget.avgWindow is "آخر {{n}} يوم", which at n=7 reads as a
    #    singular ("last 7 day"). Arabic 3-10 takes the plural, so the panel uses
    #    أيام. The app string itself still needs the plural fix.
    #  - ar/ja min_unit + min_left keep the app's own short forms (د / 分).
    "it": dict(avg_glucose="GLICEMIA MEDIA", last7="Ultimi 7 giorni", ongoing="zerospike · in corso",
               timer_title="Glicemia post-prandiale", min_left="Mancano {n} min", min_unit="min",
               date="domenica 26 luglio"),
    "pt": dict(avg_glucose="GLICEMIA MÉDIA", last7="Últimos 7 dias", ongoing="zerospike · em andamento",
               timer_title="Glicemia pós-refeição", min_left="faltam {n} min", min_unit="min",
               date="domingo, 26 de julho"),
    "ar": dict(avg_glucose="متوسط سكر الدم", last7="آخر 7 أيام", ongoing="zerospike · جارٍ",
               timer_title="سكر الدم بعد الوجبة", min_left="بقي {n} د", min_unit="د",
               date="الأحد، 26 يوليو"),
    "ja": dict(avg_glucose="平均血糖値", last7="直近7日", ongoing="zerospike · 実行中",
               timer_title="食後血糖", min_left="残り{n}分", min_unit="分",
               date="7月26日日曜日"),
}

REPORT_STRINGS = {
    "tr": dict(title="Kan Şekeri Raporu", summary="Özet", avg_label="Ort. glukoz (mg/dL)",
               gmi_label="Tahmini A1C (GMI)", inrange_label="Hedef aralığında",
               band_fmt="Düşük {lowp_pct}   ·   Aralıkta {tir_pct}   ·   Yüksek {high_pct}",
               agp_title="Saate göre glukoz profili (AGP)",
               agp_caption_fmt="{n} ölçüm · günün {hours} saatine dağılmış · medyan {median} mg/dL",
               footer_fmt="Günlük ort. doz {dose} ünite   ·   {inj} enjeksiyon",
               profile_label="Profil", range_label="Tarih aralığı", created_label="Oluşturulma",
               back_title="Günlük zaman çizelgesi",
               back_caption="Her gün 00-24. Nokta glukoz, üçgen yemek, alt nokta doz."),
    "en": dict(title="Blood Glucose Report", summary="Summary", avg_label="Avg. glucose (mg/dL)",
               gmi_label="Estimated A1C (GMI)", inrange_label="In target range",
               band_fmt="Low {lowp_pct}   ·   In range {tir_pct}   ·   High {high_pct}",
               agp_title="Glucose profile by hour (AGP)",
               agp_caption_fmt="{n} readings · spread across {hours}h of the day · median {median} mg/dL",
               footer_fmt="Daily avg. dose {dose} units   ·   {inj} injections",
               profile_label="Profile", range_label="Date range", created_label="Created",
               back_title="Daily timeline",
               back_caption="Every day 00-24. Dot = glucose, triangle = meal, small dot = dose."),
    "de": dict(title="Blutzuckerbericht", summary="Zusammenfassung", avg_label="Ø Glukose (mg/dL)",
               gmi_label="Geschätztes A1C (GMI)", inrange_label="Im Zielbereich",
               band_fmt="Niedrig {lowp_pct}   ·   Im Bereich {tir_pct}   ·   Hoch {high_pct}",
               agp_title="Glukoseprofil nach Stunde (AGP)",
               agp_caption_fmt="{n} Messungen · verteilt über {hours} Std. des Tages · Median {median} mg/dL",
               footer_fmt="Ø Tagesdosis {dose} Einheiten   ·   {inj} Injektionen",
               profile_label="Profil", range_label="Zeitraum", created_label="Erstellt",
               back_title="Tägliche Zeitleiste",
               back_caption="Jeder Tag 00-24 Uhr. Punkt = Glukose, Dreieck = Mahlzeit, kleiner Punkt = Dosis."),
    "es": dict(title="Informe de Glucosa", summary="Resumen", avg_label="Glucosa media (mg/dL)",
               gmi_label="A1C estimada (GMI)", inrange_label="En rango objetivo",
               band_fmt="Bajo {lowp_pct}   ·   En rango {tir_pct}   ·   Alto {high_pct}",
               agp_title="Perfil de glucosa por hora (AGP)",
               agp_caption_fmt="{n} mediciones · distribuidas en {hours} h del día · mediana {median} mg/dL",
               footer_fmt="Dosis media diaria {dose} unidades   ·   {inj} inyecciones",
               profile_label="Perfil", range_label="Rango de fechas", created_label="Creado",
               back_title="Cronología diaria",
               back_caption="Cada día 00-24. Punto = glucosa, triángulo = comida, punto pequeño = dosis."),
    "fr": dict(title="Rapport de Glycémie", summary="Résumé", avg_label="Glycémie moy. (mg/dL)",
               gmi_label="A1C estimée (GMI)", inrange_label="Dans la cible",
               band_fmt="Bas {lowp_pct}   ·   Dans la cible {tir_pct}   ·   Élevé {high_pct}",
               agp_title="Profil glycémique par heure (AGP)",
               agp_caption_fmt="{n} mesures · réparties sur {hours} h de la journée · médiane {median} mg/dL",
               footer_fmt="Dose quotidienne moy. {dose} unités   ·   {inj} injections",
               profile_label="Profil", range_label="Période", created_label="Créé",
               back_title="Chronologie quotidienne",
               back_caption="Chaque jour 00-24. Point = glycémie, triangle = repas, petit point = dose."),
    # it/pt/ar/ja: title/summary/profile/range/timeline/AGP labels are the app's
    # own report.* strings, the stat labels its insights.* strings
    # (avgGlucose, gmi, timeInRange) and the footer its avgDose / units /
    # injectionsCount strings. Only the connective wording of
    # agp_caption_fmt ("spread across ... of the day") and the back-page legend
    # is composed here - the app ships no equivalent sentence.
    "it": dict(title="Report glicemico", summary="Riepilogo", avg_label="Glicemia media (mg/dL)",
               gmi_label="HbA1c stimata (GMI)", inrange_label="Tempo in range",
               band_fmt="Bassa {lowp_pct}   ·   In range {tir_pct}   ·   Alta {high_pct}",
               agp_title="Profilo glicemico per ora del giorno (AGP)",
               agp_caption_fmt="{n} misurazioni · distribuite su {hours} h della giornata · mediana {median} mg/dL",
               footer_fmt="Dose media giornaliera {dose} unità   ·   {inj} iniezioni",
               profile_label="Profilo", range_label="Intervallo di date", created_label="Generato il",
               back_title="Cronologia giornaliera",
               back_caption="Ogni giorno 00-24. Punto = glicemia, triangolo = pasto, punto piccolo = dose."),
    "pt": dict(title="Relatório de glicemia", summary="Resumo", avg_label="Glicemia média (mg/dL)",
               gmi_label="A1c estimada (GMI)", inrange_label="Tempo no alvo",
               band_fmt="Baixa {lowp_pct}   ·   No alvo {tir_pct}   ·   Alta {high_pct}",
               agp_title="Perfil de glicemia por hora do dia (AGP)",
               agp_caption_fmt="{n} medições · distribuídas por {hours} h do dia · mediana {median} mg/dL",
               footer_fmt="Dose média diária {dose} unidades   ·   {inj} aplicações",
               profile_label="Perfil", range_label="Período", created_label="Gerado em",
               back_title="Linha do tempo diária",
               back_caption="Cada dia das 00 às 24. Ponto = glicemia, triângulo = refeição, ponto pequeno = dose."),
    "ar": dict(title="تقرير سكر الدم", summary="الملخص", avg_label="متوسط سكر الدم (mg/dL)",
               gmi_label="تقدير A1C (GMI)", inrange_label="الوقت داخل النطاق",
               band_fmt="منخفض {lowp_pct}   ·   داخل النطاق {tir_pct}   ·   مرتفع {high_pct}",
               agp_title="ملف سكر الدم بحسب وقت اليوم (AGP)",
               agp_caption_fmt="{n} قراءة · موزّعة على {hours} ساعات من اليوم · الوسيط {median} mg/dL",
               footer_fmt="متوسط الجرعة اليومية {dose} وحدة   ·   {inj} حقنة",
               profile_label="الملف الشخصي", range_label="النطاق الزمني", created_label="أُنشئ في",
               back_title="الخط الزمني اليومي",
               back_caption="كل يوم من 00 إلى 24. نقطة = سكر الدم، مثلث = وجبة، نقطة صغيرة = جرعة."),
    "ja": dict(title="血糖記録レポート", summary="まとめ", avg_label="平均血糖値 (mg/dL)",
               gmi_label="推定A1C(GMI)", inrange_label="目標範囲内の時間",
               band_fmt="低値 {lowp_pct}   ·   範囲内 {tir_pct}   ·   高値 {high_pct}",
               agp_title="時間帯別の血糖プロファイル(AGP)",
               agp_caption_fmt="{n}件の測定 · 1日の{hours}時間に分布 · 中央値 {median} mg/dL",
               footer_fmt="1日の平均量 {dose} 単位   ·   注射 {inj}回",
               profile_label="プロフィール", range_label="期間", created_label="作成日時",
               back_title="1日のタイムライン",
               back_caption="各日0-24時。点=血糖値、三角=食事、小さい点=インスリン量。"),
}

# settings.defaultName in each locale - the seeded demo profile's own name
PROFILE_NAME = {"tr": "Kendi Profilim", "en": "My Profile", "de": "Mein Profil", "es": "Mi Perfil",
                "fr": "Mon Profil", "it": "Il mio profilo", "pt": "Meu perfil",
                "ar": "ملفي الشخصي", "ja": "マイプロフィール"}

# ---------------------------------------------------------------------------
# 03-widget / 06-report: synthetic panels (no device capture), so their copy and
# their number formatting live here rather than in composite-texts-2.0.0.json.
# ---------------------------------------------------------------------------

PANELS_SYNTHETIC = ("03-widget", "06-report")

_SYNTHETIC_COPY = {
    "it": {
        "03-widget": ("Timer sulla schermata di blocco",
                      "Il conto alla rovescia post-prandiale in Live Activity; l'ultima misurazione nel widget, sempre in vista.",
                      "Timer attivo"),
        "06-report": ("Referto pronto per il medico",
                      "Un PDF pulito per qualsiasi intervallo di date: riepilogo, AGP e cronologia da portare alla visita.",
                      "Esporta PDF"),
    },
    "pt": {
        "03-widget": ("Timer na tela de bloqueio",
                      "A contagem pós-refeição na Live Activity; sua última medição no widget, sempre à vista.",
                      "Timer ativo"),
        "06-report": ("Relatório pronto para o médico",
                      "Um PDF limpo para qualquer período: resumo, AGP e histórico para levar à consulta.",
                      "Exportar PDF"),
    },
    "ar": {
        "03-widget": ("المؤقت على شاشة القفل",
                      "عدّاد ما بعد الوجبة في النشاط المباشر، وآخر قياس في الأداة أمامك دائمًا.",
                      "المؤقت مفعّل"),
        "06-report": ("تقرير جاهز للطبيب",
                      "ملف PDF منظم لأي فترة تختارها: ملخص وAGP وسجل كامل تصطحبه إلى الموعد.",
                      "تصدير PDF"),
    },
    "ja": {
        "03-widget": ("ロック画面にタイマー",
                      "食後カウントダウンをライブアクティビティに表示。最新の血糖値もウィジェットでいつでも確認。",
                      "タイマー表示中"),
        "06-report": ("医師に見せられるレポート",
                      "期間を選ぶだけで整ったPDFに。サマリー、AGP、履歴をそのまま診察へ。",
                      "PDF出力"),
    },
}

for _lang, _panels in _SYNTHETIC_COPY.items():
    FRAME_COPY.setdefault(_lang, {}).update(_panels)

# Live Activity is an iOS-only surface and naming it on a Play listing is a
# platform-language violation, so the Android canvases swap in a subtitle that
# describes the same thing as a home-screen widget. Only the four languages
# whose iOS subtitle names Live Activity need an override; the older five never
# mention it.
ANDROID_SUB = {
    "03-widget": {
        "it": "Il conto alla rovescia post-prandiale e l'ultima misurazione nel widget della schermata Home.",
        "pt": "A contagem pós-refeição e sua última medição no widget da tela inicial.",
        "ar": "عدّاد ما بعد الوجبة وآخر قياس في أداة الشاشة الرئيسية.",
        "ja": "食後カウントダウンと最新の血糖値をホーム画面のウィジェットで確認できます。",
    },
}


def frame_copy(lang, panel, platform="ios"):
    """(headline, subtitle, chip) for a panel, with the Android subtitle swapped
    in on Play canvases."""
    headline, sub, chip = FRAME_COPY[lang][panel]
    if platform == "android":
        sub = ANDROID_SUB.get(panel, {}).get(lang, sub)
    return headline, sub, chip


# --- number/date shapes, mirroring lib/format.ts and lib/i18n date output ---

_COMMA_DECIMAL = frozenset({"tr", "de", "es", "fr", "it", "pt"})
_SPACED_PCT = frozenset({"de", "fr", "es"})
# toLocaleDateString for each app language (ar with -u-nu-latn, matching
# lib/format.formatLocale, and without the RLM marks Intl inserts around the
# separators - the report page is laid out left to right).
DATE_PATTERN = {
    "tr": "%d.%m.%Y", "en": "%-m/%-d/%Y", "de": "%-d.%-m.%Y", "es": "%-d/%-m/%Y",
    "fr": "%d/%m/%Y", "it": "%d/%m/%Y", "pt": "%d/%m/%Y", "ar": "%-d/%-m/%Y",
    "ja": "%Y/%-m/%-d",
}


def num(value, lang, decimals=0):
    s = f"{value:.{decimals}f}"
    return s.replace(".", ",") if lang in _COMMA_DECIMAL else s


def pct(value, lang, decimals=0):
    """Turkish writes %92, German/French/Spanish 92 %, the rest 92% - the same
    rule lib/format.pct() enforces inside the app."""
    n = num(value, lang, decimals)
    if lang == "tr":
        return f"%{n}"
    return f"{n} %" if lang in _SPACED_PCT else f"{n}%"


def fmt_date(d, lang):
    return d.strftime(DATE_PATTERN.get(lang, "%d.%m.%Y"))
