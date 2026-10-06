# CPP 3: Karbonhidrat takibi (Carb Tracking)

**ASC referans adi:** `zerospike-carb-tracking`
**Bagli ad group'lar (docs/apple-ads/plan.md bolum 6, v2):** ZS-DE-Generic/Carbs-Food,
ZS-FR-Generic/Carbs-Food. v1'deki TR eslemesi v2'de yok.

Bu ad group'lar en genis kitleye sahip ama kitle ortusmesi en zayif olanlar: "kohlenhydrate zählen"
arayanin bir kismi diyet uygulamasi ariyor, diyabet gunlugu degil. CPP'nin isi, ilk ekranda ogun
kaydini gosterip ikinci ekranda diyabet baglamini kurmak; ilk iki hafta sonunda bu grubun donusum
orani digerlerinin yarisinin altinda kalirsa grup kapatilir. 2.3.7 turu (2026-10-06): promotional
text 2.3.7'deki kisa kurulumu (ogun kaydi ayarlari ilk ihtiyacta sorulur) one alacak sekilde yenilendi,
gorsel sirasi v2 setine tasindi. Onceki metinler ve sayimlar: `zerospike-store/aso/CHANGES-2.3.7.md`.

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
| 1 | `04-food.png` | Aranan seyin tam karsiligi; besin veritabani, barkod ve sablonlar ilk ekranda |
| 2 | `01-ring.png` | Diyabet baglami hemen ikinci ekranda kurulur, yanlis kitle burada elenir |
| 3 | `05-insights.png` | Ogunlerin olcumlerle ayni gecmiste gorunmesi |
| 4 | `03-widgets.png` | "Add meal" widget'i ve tokluk sayaci; gunluk kullanim aliskanligi |
| 5 | `06-spike.png` | Karbonhidrat sayimi gibi genel sorulara kaynakli cevap (2.3.7) |

Kullanilmayanlar: `02-bodymap.png`, `07-takip.png`, `08-reminders.png` (bu kitleye ikincil; ayrica
cip riski, CPP 1'deki nota bakin).

## Promotional Text (170 karakter siniri, 2.3.7)

**de (Sie/Ihr), 168/170:**
Nach kurzer Einrichtung Mahlzeiten in Sekunden erfassen: über 1000 Lebensmittel, Barcode-Scan, Vorlagen und Kohlenhydratwerte, neben Ihren Blutzuckerwerten, ohne Konto.

**fr (vous/votre), 164/170:**
Après une configuration courte, notez vos repas en quelques secondes: plus de 1000 aliments, code-barres, modèles et glucides, à côté de vos glycémies, sans compte.

**tr (cogul-nazik), 162/170:**
Kısa bir kurulumdan sonra öğünlerinizi saniyeler içinde kaydedin: 1000'den fazla besin, barkod, şablonlar ve karbonhidrat değerleri, şeker kayıtlarınızın yanında.

**en, 157/170:**
Log meals in seconds after a short setup: over 1000 foods, barcode scanning, templates and carb counts, right next to your glucose readings, with no account.

## Uyum kontrolu

- Besin sayisi "1000+" olarak yazildi; ASO dokumanindaki muhafazakar ifadeye uyumlu.
- Karbonhidrat yalniz besin degeri olarak geciyor; insulin hesabi ima edilmiyor.
- "Kisa kurulum" 2.3.7 kapsamindaki kurulum kisaltmasini anlatir; ozellik release build'de
  dogrulanmadan CPP yayina alinmaz.
- Sonuc vaadi yok, 2.3.7 yasakli kelime taramasi temiz. Apple Watch gecmiyor. Em-dash yok.
