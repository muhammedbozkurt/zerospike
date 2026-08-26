# CPP 1: Glukoz gunlugu (Glucose Diary)

**ASC referans adi:** `zerospike-glucose-diary`
**Bagli ad group'lar:** ZS-DE-Generic/Glucose-Diary, ZS-DE-Generic/HbA1c-Trends, ZS-DE-Generic/Condition,
ZS-FR-Generic/Glucose-Diary, ZS-FR-Generic/HbA1c-Trends, ZS-FR-Generic/Condition,
ZS-TR-Generic/Diary-Core, ZS-TR-Generic/HbA1c-Trends, ZS-TR-Generic/Condition,
ZS-US-Generic/Diary-Core, tum Brand ve Discovery kampanyalari

Bu, varsayilan urun sayfasina en yakin CPP'dir; Brand ve Discovery de buraya baglanir.

## Onemli: CPP neyi degistirebilir

App Store Connect'te bir Custom Product Page yalniz **ekran goruntusu, app preview videosu ve
Promotional Text** alanlarini degistirir. **App name, Subtitle ve Description degistirilemez**, varsayilan
urun sayfasindan aynen gelir. Bu yuzden asagida baslik/alt baslik onerisi YOKTUR; algilanan baslik
ekran goruntusunun icine gomulu metindir, onu degistirmek gorselin yeniden uretilmesini gerektirir
(hypershots skill'i, `zerospike-store/composite-texts-2.0.0.json`).

Degismeyen alanlar (referans): de "zerospike: Blutzuckerwerte / Diabetes-Tagebuch & Insulin",
fr "zerospike: Carnet de glycémie / Diabète, insuline et repas",
tr "zerospike: Diyabet Günlüğü / Şeker, insülin, öğün takibi",
en "zerospike: Blood Sugar Diary / Glucose, insulin & carb log".

## Ekran goruntusu sirasi

Kaynak: `zerospike-store/iphone-1284x2778/<dil>/` (mevcut gorseller, yeniden uretim gerekmez).

| Sira | Dosya | Neden bu sirada |
|---|---|---|
| 1 | `01-ring.png` | Gunun ozeti; arama niyeti "gunluk tutma" oldugu icin en hizli taniyacagi ekran |
| 2 | `09-reminders.png` | Aliskanlik kurma; D7 tutunma zayif oldugu icin hatirlaticiyi one aliyoruz |
| 3 | `05-insights.png` | Gecmis veri gorunumu, Pro'nun ana degeri |
| 4 | `06-report.png` | Doktora hazir PDF; randevu oncesi arayan kitlenin karar tetigi |
| 5 | `03-widget.png` | Kilit ekrani ve ana ekran widget'i, iOS'a ozgu farklilastirici |
| 6 | `04-food.png` | Ogun kaydi, kapsam genisligini gosterir |

`07-spike.png` KULLANILMAZ: Spike sohbet ekrani `docs/aso-appstore.md` icinde store paketinin disinda
birakilmis, reklamda da kullanilmaz. `02-bodymap.png` ve `08-takip.png` kendi CPP'lerine ait.

## Promotional Text (CPP'ye ozel, 170 karakter siniri)

**de (Sie/Ihr):**
Blutzucker, Mahlzeiten und Insulin in Sekunden erfassen. Farbcodiertes Tagebuch, Verlauf über 30 und 90 Tage, arztfertiges PDF. Ohne Konto, alles bleibt auf dem Gerät.

**fr (vous/votre):**
Notez glycémie, repas et insuline en secondes. Journal en couleurs, historique sur 30 et 90 jours, PDF pour votre médecin. Sans compte, tout reste sur l'appareil.

**tr (cogul-nazik):**
Şekeri, öğünleri ve insülini saniyeler içinde kaydedin. Renkli günlük, 30 ve 90 günlük geçmiş, doktora hazır PDF. Hesap yok, veriler cihazınızda kalır.

**en:**
Log glucose, meals and insulin in seconds. A color-coded journal, 30 and 90 day history and a doctor-ready PDF. No account; everything stays on your device.

## Uyum kontrolu

- Sonuc vaadi yok: yalniz erfassen / notez / kaydedin / log fiilleri kullanildi.
- "insulin calculator" ve turevleri yok; insulin yalniz kaydedilen bir deger olarak geciyor.
- Tani, tedavi, uyari, hipoglisemi alarmi dili yok.
- Apple Watch gecmiyor.
- Em-dash yok; ayirici olarak virgul, iki nokta ve noktali virgul kullanildi.
- Her dil kendi tek hitabini koruyor.
