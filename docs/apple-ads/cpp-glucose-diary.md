# CPP 1: Glukoz gunlugu (Glucose Diary)

**ASC referans adi:** `zerospike-glucose-diary`
**Bagli ad group'lar (docs/apple-ads/plan.md bolum 6, v2):** ZS-DE-Generic/Glucose-Diary,
ZS-DE-Generic/HbA1c-Report, ZS-DE-Generic/Reminders, ZS-FR-Generic/Glucose-Diary,
ZS-FR-Generic/HbA1c-Report, ZS-FR-Generic/Reminders. Brand, Comp-Core, Discovery, Condition,
Privacy ve Watch-Widget varsayilan urun sayfasina gider; v1'deki TR ve US eslemeleri v2'de yok.

Varsayilan urun sayfasina en yakin CPP budur. 2.3.7 turu (2026-10-06): promotional text 2.3.7
kapsamina gore yenilendi (Spike'in istege bagli 14 gunluk ozeti, Pro etiketi), gorsel sirasi v2
setine tasindi. Onceki metinler ve sayim tablosu: `zerospike-store/aso/CHANGES-2.3.7.md`.

## Onemli: CPP neyi degistirebilir

App Store Connect'te bir Custom Product Page yalniz **ekran goruntusu, app preview videosu ve
Promotional Text** alanlarini degistirir. **App name, Subtitle (yani CPP'nin basligi ve alt
basligi) ve Description degistirilemez**, varsayilan urun sayfasindan aynen gelir. Bu yuzden
asagida baslik/alt baslik onerisi YOKTUR; algilanan baslik ekran goruntusunun icine gomulu
metindir, onu degistirmek gorselin yeniden uretilmesini gerektirir (`zerospike-store/pipeline/v2`,
metinler `zerospike-store/pipeline/headlines/<dil>.json`).

Degismeyen alanlar (referans): de "zerospike: Blutzuckerwerte / Diabetes-Tagebuch & Insulin",
fr "zerospike: Carnet de glycémie / Diabète, insuline et repas",
tr "zerospike: Diyabet Günlüğü / Şeker, insülin, öğün takibi",
en "zerospike: Blood Sugar Diary / Glucose, insulin & carb log".

## Ekran goruntusu sirasi (2.3.7)

Kaynak: `zerospike-store/pipeline/out-v2/<dil>/iphone/` (1284x2778). en, de, fr, tr ve es
klasorlerinde ayni 8 dosya adi var (`ls` ile dogrulandi, 2026-10-06): `01-ring.png`,
`02-bodymap.png`, `03-widgets.png`, `04-food.png`, `05-insights.png`, `06-spike.png`,
`07-takip.png`, `08-reminders.png`. Her CPP lokalizasyonu kendi dil klasorunden ayni dosya
adlarini alir. Eski `zerospike-store/iphone-1284x2778/` klasoru artik yok; eski adlar
(`06-report.png`, `07-spike.png`, `08-takip.png`, `09-reminders.png`, `03-widget.png`) gecersiz.
v2 setinde ayri PDF rapor paneli yok; PDF, `05-insights.png` alt metninde geciyor.

| Sira | Dosya | Neden bu sirada |
|---|---|---|
| 1 | `01-ring.png` | Gunun ozeti ("Your day on one screen"); "gunluk tutma" niyetine en hizli cevap |
| 2 | `05-insights.png` | Hedef aralikta gecen sure, AGP, tahmini A1C (GMI); HbA1c-Report ad group'unun karsiligi, PDF'e atif |
| 3 | `04-food.png` | Ogun ve karbonhidrat kaydi; arama sonucundaki ilk uc karede kaydin hizini gosterir |
| 4 | `08-reminders.png` | Reminders ad group'unun karsiligi; cip riski yuzunden ilk uc karenin disinda |
| 5 | `06-spike.png` | 2.3.7'nin one cikan yeniligi; gorselin alt metni tibbi tavsiye vermedigini soyler |
| 6 | `03-widgets.png` | Kilit ekrani, Live Activity ve widget'lar; iOS'a ozgu farklilastirici |

Kullanilmayanlar: `02-bodymap.png` (CPP 2'nin ilk karesi), `07-takip.png` (Condition ad group'u
varsayilan sayfaya gider; baslik riski asagida).

Gorsel riski (2.3.7 kelime kurali): `08-reminders.png` cipi "iOS 26 alarm support" (de "iOS 26
Alarmunterstützung", fr "Compatible alarmes iOS 26", tr "iOS 26 alarm desteği") 2.3.7 yasakli
listesindeki kelimeyi tasiyor; bu yuzden ilk uc karenin (reklamda gorunen kareler) disinda tutuldu.
Kalici cozum: `headlines/<dil>.json` icinde 09-reminders cip metnini degistirip v2 ile yeniden
uretmek (bu kartin kapsami disi). `07-takip.png` basligi da ayni listedeki tani kelimesini
tasidigi icin hicbir CPP'de kullanilmiyor.

## Promotional Text (CPP'ye ozel, 170 karakter siniri, 2.3.7)

**de (Sie/Ihr), 169/170:**
Blutzucker, Essen, Insulin eintragen. Pro: Zeit im Zielbereich, HbA1c-Schätzung, PDF. Neu: Spike beschreibt auf Wunsch Ihre letzten 14 Tage. Keine medizinische Beratung.

**fr (vous/votre), 169/170:**
Notez glycémie, repas, insuline en secondes. Pro: temps dans la cible, HbA1c estimée, PDF. Nouveau: Spike (facultatif) décrit vos 14 derniers jours. Pas un avis médical.

**tr (cogul-nazik), 166/170:**
Şekeri, öğünleri ve insülini saniyeler içinde kaydedin. Aralıkta geçen süre, tahmini HbA1c ve doktor için PDF Pro'da. Yeni: Spike, isterseniz son 14 gününüzü özetler.

**en, 169/170:**
Log glucose, meals, insulin in seconds. Pro: time in range, A1C estimate, doctor-ready PDF. New: Spike describes your last 14 days if you turn it on. Not medical advice.

## Uyum kontrolu

- Sayimlar script ile olculdu (kod noktasi), tablo `zerospike-store/aso/CHANGES-2.3.7.md` icinde.
- Sonuc vaadi yok: yalniz eintragen / notez / kaydedin / log fiilleri.
- Spike cumlesi istege baglidir ("auf Wunsch", "(facultatif)", "isterseniz", "if you turn it on")
  ve yalniz betimler; tibbi oneri dili yok. de, fr ve en metinlerinde cumlenin yaninda kisa "tibbi
  tavsiye degildir" notu var (K20: keine medizinische Beratung, pas un avis médical, Not medical
  advice); tr bolumu bu kartin disinda.
- PDF ve uzun donem gorunumu Pro olarak etiketli (uygulamadaki paywall kilitleriyle ayni).
- 2.3.7 yasakli kelime taramasi bu dort metinde temiz. Apple Watch gecmiyor. Em-dash yok.
- Her dil kendi tek hitabini koruyor.
