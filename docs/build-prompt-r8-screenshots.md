# R8 BUILD PROMPT: UX Kalanlarinin Bitisi + Magaza Gorselleri Uretimi

Iki isli tek oturum: (0) UX turunun son kucuk kalanlari, (1-4) magaza gorselleri. EK DOKUMAN: `docs/store-screenshots-plan.md` bu prompt'un baglayici ekidir (olculer, kare senaryosu, sablon spec, pipeline orada); celiskide bu prompt kazanir. Once Faz 0 bitirilir ve gate'lenir, sonra gorsel uretimine gecilir.

## 0. Kurallar
- Notr regulasyon dili; yeni stringler 5 dil; em-dash yok; app.json surumu sabit.
- Gateler (Faz 0 sonunda): `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts`.
- Screenshot modu release'e ASLA sizamaz: `__DEV__ && process.env.EXPO_PUBLIC_SCREENSHOT_MODE === "1"` cift kilit; kilidin her iki bacagi da tek bir yerde kontrol edilir (`lib/screenshotMode.ts`).
- KARE METINLERINDE yasak: "control/lower/prevent/manage your diabetes" tarzi iddia; "insulin calculator" ifadesi HICBIR magaza metninde gecmez (Apple 1.4.2); kareler gercek UI olmali (2.3.3).

## FAZ 0: UX KALANLARI (kapanis)

- 0.1 Insights ekranina "Ozel..." araligi: pencere secicisine ek secenek; DateRangePicker (mevcut bilesen) acilir; Pro'ya bagli (7 gun free korunur). AGP/trend/saatlik/gunluk-profil/TIR/percentile/patterns fonksiyonlarina DateRange threadlenir (computeInsights zaten aliyor; kalan grafik fonksiyonlarina ayni aralik gecirilir, 7/30/90 kisayollari ayni yoldan). Basliktaki cip yerel formatta "12 Haz - 3 Tem" gosterir. calc.test bozulmamali.
- 0.2 E.7 kalan: profile-setup ve onboarding oran alanlari (carbRatio 0.5 adim, ISF 1 mgdl / 0.1 mmol) Stepper'a.
- 0.3 E.8: returnKeyType="next" + onSubmitEditing ref zinciri: add-food, profile-setup, app/settings/profile.tsx.
- 0.4 E.10 kalan sert kirpmalar: food.tsx (4 nokta), index.tsx (1), insights.tsx (1) - kullanici verisi 2 satir sarar, UI etiketi adjustsFontSizeToFit.
- 0.5 JournalItem +N: inline acilim kabul edildi; TEKRAR dokununca kapanma (collapse) eklenir; acikken +N yerine "daha az" benzeri kucuk cip.

## FAZ 1: SCREENSHOT MODU (kod)

`lib/screenshotMode.ts` + `lib/db/screenshotSeed.ts`:
- `isScreenshotMode()` cift kilit. Acikken: `seedScreenshotData(profileId, lang)` bir kez calisir (idempotent, marker anahtar).
- Seed hikayesi (sayilar/tarihler secili dile gore Intl ile): 30 gun glukoz verisi TIR ~%78 (hedefte agirlikli, birkac dusuk/yuksek, bugunku son olcum 112 hedefte); bugun 3 ogun (kahvalti/oglen/aksam, emoji karolu yerel yemek adlari, karb gramlari); AKTIF tokluk sayaci (~1 sa 12 dk kalan, Live Activity tetiklenmis durumda); enjeksiyonlar 30 gune ve TUM secilebilir bolgelere dagilmis (nokta seviyesinde cesitlilik, bir nokta belirgin en-eski); streak 12 gun; PRO acik (mock); Spike'ta 2 mesajlik ornek sohbet (notr icerik); ayarlarda aralik hedefler dolu.
- Kare navigasyonu icin route parametreleri: injection HARITA segmenti + zoom acik hali (`?segment=map&zoom=abdomen_left_upper` gibi), insights ozel aralik secili hali. Parametreler yalniz screenshot modunda islenir.
- Status bar: gercek cihaz cubugu gizlenmez (simctl halleder); uygulama ici dev gostergeleri screenshot modunda gizlenir.

## FAZ 2: CEKIM

`scripts/store-shots.sh` (once iPhone, sonra iPad, sonra Android):
- iOS: iPhone 16 Pro Max (6.9") ve iPad Pro 13" simulatorlerini boot et; `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --cellularBars 4 --wifiBars 3`; her dil icin (tr,en,de,es,fr): uygulama dilini ayarla (uygulama ici dil secimi), her kare route'una git, 1.5 sn bekle, `xcrun simctl io booted screenshot raw/<cihaz>/<dil>/<kare>.png`.
- Android: emulator + `adb shell settings put global sysui_demo_allowed 1` + demo saat 0941; `adb exec-out screencap -p`.
- Kareler (plan tablosu): 01-ring (dashboard), 02-bodymap (harita zoom acik), 03-widget (bu kare cihaz cekimi DEGIL, kompozitte kilit ekrani + widget mockup'i; Live Activity ekran goruntusu alinabiliyorsa raw olarak al), 04-food, 05-insights (ozel aralik secili), 06-report (rapor onizleme/print HTML'in goruntusu).
- iPad kareleri gercek iPad cekimi (telefon esnetme yasak).

## FAZ 3: KOMPOZIT

- `npx skills add hypersocialinc/hypershots` kur; sablonu plan bolum 3 spec'ine uyarla: sicak krem zemin, ustte sol iri baslik + alt yazi, 2-4 derece egik cihaz cercevesi, kare basina en fazla 2-3 sakin yuzen eleman (glukoz cipi, sayac cipi, emoji karo), accent #2ee6ff yalniz vurguda.
- ONCE PROVA: en dilinde 01-ring tek kare uret, KULLANICIYA GOSTER, onay bekle. Onaydan sonra tum set (5 dil x 6 kare x cihaz siniflari).
- Basliklar plan tablosundan (EN/TR hazir; de/es/fr cevirileri ayni notr kalipla, iki satir sigacak sekilde).
- Cikti matrisi `zerospike-store/`: iphone-1320x2868/<dil>/, ipad-2064x2752/<dil>/, android-phone/<dil>/ (1080x1920), android-tablet7/<dil>/, android-tablet10/<dil>/.
- Dogrulama scripti: tam piksel olcusu, 9:16 orani (Android), alpha kanali yok, kare basina tek dil, metin guvenli bolge. Ihlalde uretimi durdur ve raporla.

## FAZ 4: EKSTRALAR + REHBER

- `google-play-extras/<dil>/feature-graphic-1024x500.png`: cihazsiz, koyu zemin + halka motifi + logo + tek satir slogan (dil basina), icerik orta guvenli bolgede.
- `google-play-extras/<dil>/store-icon-512.png`: mevcut uygulama ikonundan.
- `zerospike-store/OKU-BENI.md`: faunade kalibinda yukleme rehberi (hangi klasor hangi cihaz sinifina; App Store Connect dil eslemesi: tr + en-GB, en-US + en-GB, de-DE, es-ES + es-MX, fr-FR + fr-CA; Play: tr-TR, en-US, en-GB, de-DE, es-ES, es-419, fr-FR, fr-CA).

## TESLIM RAPORU
Faz 0 gate ciktilari; seed hikayesinin ekran dogrulamasi; cekim matrisi (kac kare x dil x cihaz); prova onayi kaydi; dogrulama script ciktisi; HUMAN kalanlar (App Store Connect / Play Console yuklemesi kullanicida; hypershots kurulum onayi; simulatorlerin acik olmasi).
