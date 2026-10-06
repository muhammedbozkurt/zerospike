# CPP 2: Enjeksiyon rotasyonu (Injection Rotation)

**ASC referans adi:** `zerospike-injection-rotation`
**Bagli ad group'lar (docs/apple-ads/plan.md bolum 6, v2):** ZS-DE-Generic/Injection-Rotation,
ZS-DE-Generic/Insulin-Log, ZS-FR-Generic/Injection-Rotation, ZS-FR-Generic/Insulin-Log. v1'deki
TR eslemesi v2'de yok.

Dar ama ayirt edici bir CPP: rakiplerin cogunda nokta seviyesinde rotasyon takibi yok, bu yuzden
bu ad group'larin donusum oraninin diger gruplardan yuksek cikmasi beklenir. Test fazinda en cok
izlenecek ikinci metrik budur (bkz. plan.md, olcum bolumu). Rotasyon karti (en uzun suredir
kullanilmayan nokta) Pro'dur; vucut haritasi ucretsizdir. 2.3.7 turu (2026-10-06): promotional text
bu ayrimi ve yillik plandaki 7 gunluk deneme ile 2.3.7'deki deneme sayacini one alacak sekilde
yenilendi, gorsel sirasi v2 setine tasindi. Onceki metinler ve sayimlar:
`zerospike-store/aso/CHANGES-2.3.7.md`.

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
| 1 | `02-bodymap.png` | Aranan seyin tam karsiligi: vucut haritasi ve siradaki nokta ("Which site comes next") |
| 2 | `01-ring.png` | Gunluk baglam; "Basal today" satiri Insulin-Log ad group'una konusur |
| 3 | `03-widgets.png` | "Add injection" widget'i ve bazal insulin bildirimi; tek dokunusla kayit |
| 4 | `08-reminders.png` | Bazal hatirlatici ve rutin; cip riski yuzunden ilk uc karenin disinda |
| 5 | `05-insights.png` | Gecmis veri gorunumu |

Kullanilmayanlar: `04-food.png` (ogun odakli, bu kitleye ikincil), `06-spike.png`, `07-takip.png`.

Gorsel riski (2.3.7 kelime kurali): `08-reminders.png` cipi "iOS 26 alarm support" (de "iOS 26
Alarmunterstützung", fr "Compatible alarmes iOS 26", tr "iOS 26 alarm desteği") 2.3.7 yasakli
listesindeki kelimeyi tasiyor; bu yuzden ilk uc karenin (reklamda gorunen kareler) disinda tutuldu.
Kalici cozum: `headlines/<dil>.json` icinde 09-reminders cip metnini degistirip v2 ile yeniden
uretmek (bu kartin kapsami disi). `07-takip.png` basligi da ayni listedeki tani kelimesini
tasidigi icin hicbir CPP'de kullanilmiyor.

## Promotional Text (170 karakter siniri, 2.3.7)

**de (Sie/Ihr), 166/170:**
Basal- und Bolusinsulin eintragen, Injektionen auf der Körperkarte sehen. Mit Pro ist die am längsten nicht genutzte Stelle markiert. Jahresabo: 7 Tage gratis testen.

**fr (vous/votre), 169/170:**
Notez insuline basale et bolus: vos injections s'affichent sur une carte du corps. Avec Pro, la zone la plus longtemps inutilisée est signalée. Annuel: 7 jours gratuits.

**tr (cogul-nazik), 170/170:**
Bazal ve bolus insülini kaydedin, enjeksiyonlarınızı vücut haritasında görün. Pro ile en uzun süredir kullanılmayan nokta işaretlenir. Yıllık plan: 7 gün ücretsiz deneme.

**en, 163/170:**
Log basal and bolus insulin and see your injections on a body map. With Pro, the spot unused the longest is marked. The yearly plan starts with a 7-day free trial.

## Uyum kontrolu

- `docs/aso-appstore.md` kural 7: metin insulin tipini bolgeye baglamiyor, bolge onermiyor.
  Yalniz "en uzun suredir kullanilmayan nokta" geciyor; bu kart Pro olarak etiketli.
- Deneme cumlesi fiyat icermiyor, yalniz yillik plandaki 7 gunluk ucretsiz denemeyi soyluyor;
  yenileme ve iptal sartlari varsayilan sayfanin aciklamasinda.
- Hesaplama dili yok, sonuc vaadi yok, 2.3.7 yasakli kelime taramasi temiz.
- Em-dash yok. Her dil kendi tek hitabini koruyor.
