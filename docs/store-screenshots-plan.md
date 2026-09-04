# Zerospike Magaza Gorselleri Plani (screenshot modu + ASO kompozit)

Kod turlari (R7.1) bittikten sonra calisacak oturumun plani. Referans yapi: ~/Desktop/faunade-store (ayni klasor/dil duzeni, zerospike olculeriyle). Beğenilen stil: hypershots.dev (padscanner ornegi). Kategori arastirmasi: tibbi uygulamalar guven-odakli ve gercek UI gosterir; koyu Midnight Monitor arayuzunu ACIK sicak zeminde gostermek kategoride farklilasan ve kurallara uyan orta yol.

## 1. Cikti matrisi

Klasor: `zerospike-store/` (faunade duzeninin aynisi). Diller: **tr, en, de, es, fr** (ar/ja yok).

| Klasor | Olcu | Not |
|---|---|---|
| `iphone-1320x2868/<dil>/` | 1320x2868 | 6.9" TEK zorunlu iPhone sinifi (1290x2796 da kabul; faunade'nin 1284x2778'i eski 6.5" siniftir, kullanma) |
| `ipad-2064x2752/<dil>/` | 2064x2752 | 13" iPad (uygulama iPad'de calisiyorsa zorunlu) |
| `android-phone/<dil>/` | 1080x1920 | 9:16 kesin oran; en az 4 adet >=1080px olsun (Play one cikarma kosulu) |
| `android-tablet7/<dil>/` | 1080x1920 tabani | Play 7" |
| `android-tablet10/<dil>/` | 1600x2560 onerilen | Play 10" |
| `google-play-extras/<dil>/` | feature-graphic-1024x500.png + store-icon-512.png | Feature graphic ZORUNLU; kenarlar kirpilir, icerik ortada; cihaz gorseli koyma, kisa slogan <%20 alan |

Magazaya yukleme dil eslemesi (dosya 5 dil, yukleme daha genis): tr -> tr + en-GB (TR vitrininin birincil dili en-GB, ikisi de yuklenir); en -> en-US + en-GB; de -> de-DE; es -> es-ES + es-MX (LatAm); fr -> fr-FR + fr-CA. Play: tr-TR, en-US, en-GB, de-DE, es-ES, es-419, fr-FR, fr-CA.

## 2. Kare senaryosu (dil basina 01..08, sira bilincli, v2 midnight pipeline ile ayni sira)

Ilk 3 kare kurali: kullanicilarin cogu 3. kareden oteye gecmez; 1-3 = halka, isi haritasi, widget'lar/Live Activity (en guclu fark).

Dosya adlari ve kopya, `zerospike-store/pipeline/v2/panels-v2.json` (id -> output) ve
`zerospike-store/composite-texts-2.0.0.json` ile birebir eslesir; panel id'si ile
cikti dosya adi ayni olmayabilir (orn. `07-spike` id'si `06-spike` olarak yuklenir).

| # | Dosya | Panel id | Ekran (mock data ile) | Baslik EN | Baslik TR | Alt yazi EN |
|---|---|---|---|---|---|---|
| 1 | `01-ring` | `01-ring` | Dashboard: glukoz halkasi hedefte + aktif tokluk sayaci + haftalik serit | Your day on one screen | Gununuz tek ekranda | Your average today, your weekly average and the post-meal timer on one screen. Your run of logged days shows here too. |
| 2 | `02-bodymap` | `02-bodymap` | Enjeksiyon isi haritasi (on govde, dolu noktalar, en uzun suredir kullanilmayan nokta isaretli) | Which site comes next | Sira hangi bolgede | Your logged injections gather on a body map, with the site you have left unused the longest marked for you. |
| 3 | `03-widgets` | `03-widget` | Kilit ekrani Live Activity/Dynamic Island + ana ekran ve mini widget'lar (Android'de yalniz ana ekran ve mini widget) | Widgets and Live Activity | Widget'lar ve Canlı Etkinlik | From your lock screen to your home screen, your reading and your post-meal timer are always in view. |
| 4 | `04-food` | `04-food` | Yemek sekmesi: karb hero + emoji karolu ogunler + hizli ekleme sheet'i | A meal in a few taps | Ogun kaydi yormasin | Over a thousand foods, barcode scanning and your own templates. The carb count is already filled in. |
| 5 | `05-insights` | `05-insights` | Insights: TIR donut + gradyan AGP + ozel aralik cipi | What changed over time | Zamanla ne degisti | Time in range, your daily profile and a week-to-week comparison in one place. It all goes into the PDF report. |
| 6 | `06-spike` | `07-spike` | Spike AI sohbet ekrani: genel bilgi/uygulama sorulari, notr dil | Ask what is on your mind | Akliniza takilani sorun | Spike answers questions about diabetes in general and about the app. It does not give medical advice; decisions stay with your care team. |
| 7 | `07-takip` | `08-takip` | Tani secilmeden kurulum: sade seker + ogun gunlugu, insulin ekranlari kapali | Works without a diagnosis | Taniniz yoksa da kullanin | Choose no diagnosis during setup. Insulin screens switch off and a simple glucose and meal journal is what remains. |
| 8 | `08-reminders` | `09-reminders` | Hatirlaticilar listesi: olcum/ilac/bazal, profil basina liste | Reminders in one place | Hatirlaticilar tek yerde | You set the glucose, medication and basal reminders. Each profile keeps its own list. |

- REGULASYON (kesin kurallar): basliklarda/altyazilarda iddia YOK ("control/lower/prevent/manage your diabetes" yasak; track/log/see/understand kalibi). "Insulin calculator" ifadesi HICBIR magaza metninde ve karede baslik olarak KULLANILMAZ (Apple 1.4.2 doz hesaplayici kurali); calculator ekrani kare olarak gosterilmez, doz "kayit" olarak gecer. Rozet yok (FDA/CE yok). Gercek UI kurali (2.3.3): karelerdeki ekranlar gercek uygulama ekrani olmali, mockup cizim degil.
- Spike AI notr "Ask what is on your mind" diliyle 6. kare olarak sette yer alir; tibbi tavsiye vermedigi ve kararin saglik ekibine ait oldugu altyazida acikca belirtilir.
- de/fr/es basliklari EN'den uzun olur: sablonda iki satirlik baslik alani ayrilir, font kuculmez.

## 3. Gorsel sablon (hypershots stili, tibbi kategoriye uyarlanmis)

- Zemin: sicak acik kagit tonu (padscanner'daki gibi krem/bej) TUM karelerde sabit; koyu Midnight Monitor UI bu zeminde maksimum kontrast verir. Marka ipligi: accent cyan (#2ee6ff) kucuk vurgu elemanlarinda (skor cipi, cizgi, ikon), asla zemin olarak degil.
- Kompozisyon: ustte SOL hizali iri kalin baslik (2 satira kadar), altinda ince alt yazi; ortada hafif egik (2-4 derece) cizilmis cihaz cercevesi icinde GERCEK ekran goruntusu; cerceve icinde sahte status bar 9:41 dolu pil.
- Kolaj elemanlari az ve sakin (tibbi guven): kare basina en fazla 2-3 yuzen eleman; ornekler: glukoz cipi ("112 hedefte" yesil), sayac cipi ("1 sa 12 dk"), emoji yemek karosu, PDF kose kartı. Padscanner'daki yogun sticker seviyesinin yarisi.
- Ipad kareleri gercek iPad cekiminden (telefon esnetme YASAK, faunade kurali); kompozisyon ayni, cihaz cercevesi iPad.
- Feature graphic: cihazsiz; koyu zemin + halka motifi + logo + tek satir slogan (dil basina), icerik guvenli orta bolgede.
- Koyu-acik ritmi gerekmiyor (zemin sabit); ritim baslik rengi ve eleman cesitliligiyle saglanir.

## 4. Uygulama ici screenshot modu (kucuk kod fazi, R7.1 sonrasi)

R6'da silinen DEV_SCREENSHOT_ROUTE/design-gallery YERINE temiz, env-gated mekanizma:
- `EXPO_PUBLIC_SCREENSHOT_MODE=1` ile acilan mod (release build'e ASLA girmez: __DEV__ + env cift kilit).
- Mock seed (lib/sampleData.ts ustune `seedScreenshotData()`): 30 gun gercekci veri, TIR ~%78 hikayesi, bugun 3 ogun + AKTIF tokluk sayaci (~1 sa 12 dk kalan), isi haritasi tum bolgelerde dagilmis kullanim (bir nokta en-eski isaretli), streak 12 gun, PRO acik, ornek doktor raporu verisi. Sayilar/tarihler secili dile gore.
- Deep-link ile kare navigasyonu: mevcut expo-router route'lari yeterli (dashboard `/(tabs)`, injection `/(tabs)/injection` + HARITA segmenti parametresi, food, insights, rapor onizleme). Ek route GEREKMEZ; sadece injection'da segment ve zoom-karti acik hali icin parametre destegi eklenir.
- Dil: cihaz dili yerine uygulama ici dil secimi zaten var; script her dilde yeniden baslatir.

## 5. Cekim pipeline'i (oturum bunu calistirir)

1. iOS: iPhone 16 Pro Max simulatoru (6.9") + iPad Pro 13". `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 ...` ile status bar; `xcrun simctl io booted screenshot` ile cekim. Android: Pixel emulatoru + `adb shell settings put global sysui_demo_allowed 1` demo modu + `adb exec-out screencap`.
2. Script: `scripts/store-shots.sh` — dil x kare dongusu: dili ayarla, route'a git, 1 sn bekle, cek, `raw/<cihaz>/<dil>/<kare>.png` klasorune yaz. (Kompozit cihaz-cercevesi ICINE konacagi icin raw cekimlerin store olcusunde olmasi gerekmez; net ve yuksek cozunurluk yeterli. iPad kareleri gercek iPad cekimi olmali.)
3. Kompozit: hypershots skill'i kur (`npx skills add hypersocialinc/hypershots`) ve sablonu bolum 3 spec'ine gore uyarla; skill HTML panelleri tam piksel olcusunde uretir, ceviri ve olcu dogrulamasi yapar. Skill sorun cikarirsa yedek plan: kendi HTML/CSS kompozitorumuz + headless Chrome ile tam olcu render (ayni spec).
4. Dogrulama (faunade'deki otomatik kontrol kalibi): her cikti tam piksel olcusunde mi, metin yasak bolgeye tasmis mi, dil butunlugu (kare basina tek dil), 9:16 orani (Android), alpha kanali yok (Apple/feature graphic).
5. Ciktilar `zerospike-store/` matrisine yazilir; OKU-BENI.md benzeri bir yukleme rehberi olusturulur (hangi klasor App Store Connect'te hangi cihaz sinifina, Play'de hangi form faktore).

## 6. Oturum sirasi (kod bitince tek oturum)

1. Screenshot modu kodunu ekle (bolum 4) + tsc/i18n gateleri.
2. Simulatorlerde 5 dil x 6 kare x (iPhone, iPad) + Android emulator cekimlerini al.
3. hypershots ile kompozit uret (once en tek kare prova -> onay -> tum set).
4. Feature graphic + store icon uret.
5. Dogrulama scriptini calistir, `zerospike-store/` teslim et.
6. Screenshot modu kancalarini temizleme karari: env-gated oldugu icin kodda kalabilir (release'e sizmiyor); HUMAN-TODO'ya "store yuklemesi oncesi son kontrol" maddesi.

## 7. 2.3.0 gorsel borcu (Kapsam 2, kayit: 2026-08-24)

Kod tarafi bitti, cekim/kompozit insanda. Degisen kareler:

- **09-reminders**: ekranin ustune "Siradaki" karti (onumuzdeki 24 saat) ve satir
  basi Alarm/Bildirim rozeti geldi, ayrica her satirin altinda "siradaki: bugun
  22:00" satiri var. 9 dilde yeniden uretilmeli. Tohum (lib/db/screenshotSeed.ts)
  bir satiri bilerek bildirimde tutuyor, boylece iki rozet de karede gorunur.
- **Onboarding karesi**: tokluk suresi sorusu KALKTI (K2-D). O soruyu gosteren
  bir kare varsa artik gecersiz; yerine hazir hatirlatici duzeni onizlemesi
  (reminderPlan adimi) cekilebilir. Ekranda tani tipi adi GECMEZ, bu yuzden
  kare her dil icin ayni cerceveyi tasir.
- **Pano (01/03 civari)**: yemek kartindaki birincil "Yemege basladim" pill'inin
  yaninda kucuk sure secici dugmesi var. Mevcut kareler hala dogru ama dugme
  yeni; yeniden cekilirse ikisi birlikte gorunur.

Regulasyon suzgeci degismedi: karelerde "onerilen olcum sikligi" ya da tani
tipine ozel bir cerceve OLMAZ.
