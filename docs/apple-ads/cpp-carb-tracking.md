# CPP 3: Karbonhidrat takibi (Carb Tracking)

**ASC referans adi:** `zerospike-carb-tracking`
**Bagli ad group'lar:** ZS-DE-Generic/Carbs-Food, ZS-FR-Generic/Carbs-Food, ZS-TR-Generic/Carbs-Food

Bu ad group'lar en genis kitleye sahip ama kitle ortusmesi en zayif olanlar: "kohlenhydrate zählen"
arayanin bir kismi diyet uygulamasi ariyor, diyabet gunlugu degil. CPP'nin isi, ilk ekranda ogun
kaydini gosterip ikinci ekranda diyabet baglamini kurmak; ilk iki hafta sonunda bu grubun donusum
orani digerlerinin yarisinin altinda kalirsa grup kapatilir.

## Ekran goruntusu sirasi

| Sira | Dosya | Neden bu sirada |
|---|---|---|
| 1 | `04-food.png` | Aranan seyin tam karsiligi; besin veritabani ve barkod ilk ekranda |
| 2 | `01-ring.png` | Diyabet baglami hemen ikinci ekranda kurulur, yanlis kitle burada elenir |
| 3 | `05-insights.png` | Ogun ile sonraki olcumun ayni gecmiste gorunmesi |
| 4 | `06-report.png` | Doktora hazir PDF |
| 5 | `03-widget.png` | Gunluk kullanim aliskanligi |

## Promotional Text (170 karakter siniri)

**de (Sie/Ihr):**
Mahlzeiten in Sekunden erfassen: über 1000 Lebensmittel, Barcode-Scan, Favoriten und Kohlenhydratwerte. Der Verlauf steht neben Ihren Blutzuckerwerten im Tagebuch.

**fr (vous/votre):**
Notez vos repas en quelques secondes: plus de 1000 aliments, scan de code-barres, favoris et glucides. L'historique figure à côté de vos glycémies dans le journal.

**tr (cogul-nazik):**
Öğünlerinizi saniyeler içinde kaydedin: 1000'den fazla besin, barkod tarama, favoriler ve karbonhidrat değerleri. Geçmiş, şeker kayıtlarınızın yanında görünür.

**en:**
Log meals in seconds: over 1000 foods, barcode scanning, favorites and carb counts. The history sits next to your glucose readings in the journal.

## Uyum kontrolu

- Besin sayisi "1000+" olarak yazildi (gercek veritabani 1152), ASO dokumanindaki muhafazakar ifadeye uyumlu.
- Karbonhidrat yalniz besin degeri olarak geciyor; doz turevi bir hesaplama ima edilmiyor.
- Sonuc vaadi, tani, tedavi dili yok. Apple Watch gecmiyor. Em-dash yok.
