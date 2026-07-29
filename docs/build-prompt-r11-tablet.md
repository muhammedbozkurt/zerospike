# R11 BUILD PROMPT: Tablet Duzeni (uygulama kodu) + Tablet Magaza Gorselleri BASTAN

KENDI KENDINE YETEN dosya. Baglam: 1.5.0 iOS yayinda; Android TELEFON magaza seti hazir (zerospike-store-r93/android-phone, 7 kare x 5 dil) ve Play'e telefon-only yuklenecek. TABLET setleri bilerek yuklenmedi cunku (a) uygulamanin tablet duzeni responsive degil (telefon duzeni 1600px'e geriliyor: uctan uca satirlar, dev arama cubugu), (b) onceki tablet kompozitlerinin cihaz cercevesi kalitesiz (bezel yok, icerik kenara yapisik). Bu tur ikisini de cozer. iPad de ayni responsive sorununu tasiyor; bu turun kod isi bir sonraki iOS surumunu de iyilestirir.

## 0. KURALLAR
- Notr regulasyon dili; yeni stringler 5 dil (tr/en/de/es/fr); em-dash yok; app.json surumune dokunma (bir sonraki surumde bump edilir).
- Gateler: `npx tsc --noEmit` · `npm run i18n-check` · `npx tsx scripts/calc.test.ts` · `npx tsx scripts/migration.test.ts` · `npx tsx scripts/mealResponse.test.ts`.
- GORSEL-DONDURULMUS: telefon/iPhone LAYOUTLARI DEGISMEZ (magaza gorselleri yayinda). Tablet duzeni ek breakpoint'le gelir; dar ekranda render BIREBIR ayni kalmali (kanit: telefon simulatorunde degisiklik oncesi/sonrasi ekran karsilastirmasi).

## FAZ 1: UYGULAMA TABLET DUZENI (kod)
Hedef: genis ekranda (kisa kenar >= 600dp) telefon-gerdirmesi yerine dengeli duzen.
- 1.1 Ortak cati: `lib/useLayout.ts` (veya esdegeri): `isWide` (shortestSide >= 600) + `contentMaxWidth` (~640-720dp) sabitleri. Ekran icerik kolonlari genis ekranda ORTALANIR ve maxWidth ile sinirlanir; liste satirlari, arama cubugu, kartlar uctan uca GERILMEZ.
- 1.2 Uygulanacak ekranlar (oncelik sirasi; hepsi ayni cati ile): dashboard (hero halka + haftalik serit + sayac + gunluk), food (karb hero + ogun listesi + kategori IZGARASI genis ekranda 4-5 kolon), injection (3 segment; harita genis ekranda sabit maksimum genislik, form yanina degil ALTINA - basit tut), insights (kartlar 2 kolonlu grid genis ekranda), meal-response, spike, settings hub + alt sayfalar, onboarding (icerik kolonu maxWidth).
- 1.3 YAPMA: yeni navigasyon deseni (split-view/master-detail) EKLEME; bu tur yalniz "ortala + sinirla + izgara" turudur. Karmasik iki-panel duzenler kapsam disi.
- 1.4 Kanit: Pixel_Tablet (veya iPad sim) ekran goruntuleri her ana ekran icin oncesi/sonrasi; telefonda piksel-regresyon yok.

## FAZ 2: TABLET HAM CEKIMLERI (5 dil)
Mekanik (onceki turlarin kanitli recetesi - AYNEN uygula):
- Pixel_Tablet emulatoru COLD boot: `emulator -avd Pixel_Tablet -no-snapshot -no-audio -timezone Asia/Tokyo` (quickboot snapshot saati KAYIKTIR; Tokyo = ogleden sonra hikayesi). Boot sonrasi `adb emu rotate` ile PORTRE (tablet dogal yonu landscape'tir), demo mode: `settings put global sysui_demo_allowed 1` + `am broadcast com.android.systemui.demo` (clock 0941, battery 100, wifi 4, notifications gizli).
- Metro: `EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo start` + `adb reverse tcp:8081 tcp:8081` (yuklu debug build Metro ister).
- Dil gecisi: uygulama OTURMUSKEN `zerospike://sc-lang?lang=xx` deep-link + force-stop + 2x relaunch (seed dil-bazli yeniden kurulur). Boot sirasinda gonderilen link KAYBOLUR.
- NAVIGASYON: (tabs) rotalarina warm deep-link BAYAT EKRAN KOPYASI acar - tab gecisleri GERCEK DOKUNUSLA yapilir (`adb shell input tap`; tab bar y~2450, 4 sekme x~200/625/1000/1400 - dogrulamak icin OCR-kutu araciyla olc). Pushed rotalar (insights?custom=1, /spike) deep-link ile guvenli.
- Dogrulama her karede OCR ile (dil-safiyet + 9:41 + beklenen anahtar kelime); "bugun" gruplamasi icin seri=12 ve karb=135 kontrolu (seri 12 degilse: cift-seed kalintisi - pm clear yerine DB cerrahisi: run-as ile db cek, fazla gunleri sil, geri it).
- Kareler: 01 dashboard, 02 injection MAPA segmenti (dokunusla), 04 food, 05 insights?custom=1, 07 /spike. (03 ve 06 kompozitor-cizimi.)

## FAZ 3: TABLET KOMPOZITLERI BASTAN (donor cerrahisi DEGIL; temiz sablon)
- Sablon standardi = iPhone/iPad onaylı yapi: sicak krem zemin, sol ust 2 satirlik baslik + 2 satir altyazi, cipler yalniz kremde (metin/cihazla kesisme YASAK), GERCEK gorunumlu tablet cercevesi: belirgin esit bezel (icerige gore ~28-36px), yuvarlak koseler, on kamera noktasi, alt kesim uygulama tab bar ustunde, son-oge-tam kurali.
- Kanvaslar: tablet7 1080x1920, tablet10 1600x2560; ayni ham cekimden iki render (oran korunur, esnetme yok).
- 03-widget: Android kilit ekrani sahnesi TABLET oranli (buyuk ince saat + LA karti + widget karti; telefon 03'un tablet uyarlamasi). 06-report: A4 oranli es-boyutlu iki sayfa, arka arkaya (rapor sayfalari HER DILDE o dilin uygulamasindan uretilir: Ayarlar > Veri > PDF; pdftoppm ile sayfalara ayir).
- Basliklar/altyazilar/cipler: mevcut telefon setindekiyle AYNI metinler (r93 telefon karelerinden).
- Dogrulama HER dosyada: tam olcu, alpha yok, 9:16, tek dil (OCR), cip kesisimi sifir, son-oge-tam, cerceve butunlugu goz kontrolu. Kare basina rapor satiri.

## FAZ 4: TESLIM
- zerospike-store-r93/android-tablet7|10/<dil>/ 7 kare x 5 dil = 70 dosya + dil basina _PREVIEW kontaktlari.
- Teslim raporu: Faz 1 oncesi/sonrasi ekranlar, telefon regresyonsuzluk kaniti, gate ciktilari, dogrulama tablosu. iPad iyilesmesi nota: bir sonraki iOS surumunde iPad gorselleri de bu duzenle tazelenebilir (ayri karar).
