# R9.3 FINAL GORSEL SPEC: Tum Magaza Gorselleri BASTAN (cihaz bazli kesin kurallar)

Bu dosya KENDI KENDINE YETER; onceki prompt'lari okumana gerek yok. Amac: 4 cihaz sinifi x 5 dil x 7 kare magaza gorselinin SIFIRDAN, tek oturumda, kurallara birebir uyarak uretilmesi. Onceki turlarda iPhone kurallari iPad'e kopyalandi ve hatali cikti; bu dosya her cihaz icin AYRI kural verir. Kurallardan sapma yok; "bence boyle daha iyi" yok.

## 0. BAGLAM (yeni session icin)
- Repo: bu klasor. Screenshot modu: `EXPO_PUBLIC_SCREENSHOT_MODE=1` + `__DEV__` cift kilit (`lib/screenshotMode.ts`); seed `lib/db/screenshotSeed.ts` (halka 112 @18:22, streak 12, aktif tokluk sayaci, TIR ~%75-80, dil-bazli yemek adlari). Dil gecisi: iOS'ta `zerospike://sc-lang?lang=xx` sonrasi terminate+launch; Android'de ayni route (I7 hook: `app/sc-lang.tsx`).
- Cekim scripti: `scripts/store-shots.sh` (referans; gerekirse Python dongusuyle sur — sandbox'ta `sleep` bloklu olabilir, `time.sleep` kullan). Kompozitor: hypershots tabanli HTML sablonu (onceki: scratchpad/composite.py kalibi; yeniden kur).
- Tuzaklar: temiz kurulum ONBOARDING'de acilir (seed profil yaratmaz; onboarding'i cliclick ile gec: birim mg/dL, insulin Evet, varsayilan hedefler). CGM/Health toggle'ina ASLA dokunma (bayat HealthKit importu hero'yu ezer). Deep-link "Acilsin mi?" dialogu ilk seferde cikar (cliclick ile Ac). Android: LogBox screenshot modunda kapali olmali; seed bazen iki launch ister; pm clear sonrasi iki kez ac. iOS puanlama penceresi fix'li. Metro 8081.
- Dogrulama araci: verify.py kalibi (olcu/alpha/dil). Bu spec'teki EK kontrollerle genisletilecek.

## 1. ONCE UYGULAMA DUZELTMELERI (kod; sinirli kapsam; gateler zorunlu)
Gateler: `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts`.

- K1 ANDROID GLOW/GOLGE APP-WIDE: Insights GMI karti gibi kartlarin arkasindaki efekt iOS'ta dogru, Android'de bozuk (gri/blok golge). Onceki fix yalniz carb-hero'ya yapildi; simdi TUM glow/golge kullanan yuzeyler taranir (grep: shadowColor/shadowOpacity/elevation/glow; GlassCard, StatCard, ChartCard, rich/* dahil) ve Android'de platform fallback'e gecer: golge/elevation YOK, yerine renk-esli ince kenar (1px, %25-35 alfa) + cok hafif ayni-renk dolgu. iOS gorunumu DEGISMEZ (Platform.OS === "ios" yolu aynen kalir). Kanit: Android emulatorde insights ekrani ekran goruntusu — GMI/ORT kartlari temiz.
- K2 ALT CTA SIYAH BANDI: Dashboard'daki "+ Kayit ekle" butonu, arkasi SIYAH dolgulu bir konteynerde; bu siyah alan her ekran goruntusunde bant/golge gibi duruyor. Duzeltme: konteyner dolgusu kaldirilir; yerine ALTTAN USTE seffafa donen kisa gradyan (bg.g1 -> transparent, ~72px) VEYA tamamen seffaf konteyner + yalniz hap buton. Liste iceriginin butonun altina dogal akmasi korunur (contentInset/padding ayari). Ayni kalip baska ekranda varsa (grep absolute bottom + bg) ayni duzeltme.
- K3 (yalniz dogrulama): Live Activity basligi "Tokluk Sekeri" (sade, "2. Saat" yok) — onceden yapildi, 5 dilde teyit et.
- K4 SPIKE MOCK DURUMU (yeni kare icin, yalniz screenshot modunda): `isScreenshotMode()` iken Spike ekrani backend'siz render edilebilir olmali: (a) giris noktalari gorunur (isConfigured bypass YALNIZ screenshot modunda), (b) consent gecilmis sayilir, (c) ekranda ONCEDEN YUKLU 2 mesajlik notr ornek sohbet gorunur (gonderim yok, ag cagrisi yok). Icerik 5 dilde, EGITIM tonlu ve DOZSUZ; ornek TR: Kullanici "Tokluk olcumu ne zaman yapilir?" -> Spike "Genellikle yemegin baslangicindan 1-2 saat sonra olculur. Kendi hedeflerin icin saglik ekibinle konusmalisin." Her yanittaki mevcut disclaimer satiri GORUNUR kalir. Uretim (release) davranisi DEGISMEZ (cift kilit disinda hicbir sey render edilmez). Gateler.

## 2. CEKIM KURALLARI (cihaz bazli, HAM goruntuler)
Her cihazda: tam ekran KIRPILMAMIS cekim; iOS `simctl status_bar` 09:41 tam pil; Android `adb` demo mode 09:41. 5 dil (tr,en,de,es,fr), dil basina tam seed dogrulamasi (profil adi + yemek adlari o dilde; karma dil = kare GECERSIZ).

| Cihaz | Kaynak | Ham cozunurluk | Kompozit kanvas |
|---|---|---|---|
| iPhone | iPhone 16/17 Pro Max SIM | cihaz dogal | 1284x2778 |
| iPad | iPad Pro 13" SIM (GERCEK iPad cekimi; telefon esnetme YASAK) | cihaz dogal | 2064x2752 |
| Android telefon | Pixel_8 EMULATOR | 1080x1920+ | 1080x1920 |
| Android tablet | **Pixel_Tablet EMULATOR — ZORUNLU. Telefon raw'i tablet kanvasina koymak KESINLIKLE YASAK (onceki tur hatasi)** | tablet dogal | tablet10: 1600x2560, tablet7: 1080x1920 (ayni tablet raw'indan) |

Not: iPhone kompozit kanvas 1284x2778 (2026-08 App Store Connect kabul listesi: 1242x2688, 2688x1242, 1284x2778, 2778x1284). store-screenshots-plan.md'deki 1320x2868 talebi guncel degil.

## 3. KOMPOZIT SABLON — ORTAK KURALLAR (tum cihazlar)
- Yapi (padscanner): sicak krem zemin; SOL USTTE buyuk baslik (2 satir alani) + 2 SATIR altyazi (kisa altyazi yasak); altinda GERCEK cihaz cercevesi; cihaz DIK (egim yok); yanlarda >=%8 nefes.
- Ekran: cerceve icinde KIRPILMAMIS goruntu, status bar gorunur.
- ALT KESIM: kanvasin alt kenari = uygulama TAB BAR'inin ust siniri (navbar gorunmez). SON OGE TAM kurali: gorunur en alttaki oge (kart/buton/satir) ASLA ortadan bolunmez; gerekirse raw'da scroll ayarlanir. Piksel kontrolu: son oge bbox alt kenari < kesim y.
- CIPLER: kare basina en fazla 2; YALNIZ krem alanda dururlar; CIHAZ CERCEVESIYLE VE EKRANLA KESISMEZLER (onceki iPad hatasi: kart cihazla cakisti — artik kesin yasak, tum cihazlarda). Baslik/altyaziya da binmezler.
- Tipografi: baslik kanvas genisliginin ~%80'ine sigar, 2 satira sarabilir; altyazi baslik boyutunun ~%40'i, 2 satir.
- 06-rapor karesi cihaz cercevesiz: A4 oranli (g/y=0.707 +-0.02) iki sayfa, AYNI boyut, arka arkaya hafif ofset; on sayfa genisligi kanvasin %55-62'si; alta tasarak kutu dolar. Oran/olcu dogrulamasi zorunlu.
- Dosya: PNG, alpha YOK, tam kanvas olcusu, kare basina TEK dil.

## 4. CIHAZ x KARE MATRISI (kesin icerik kurallari)

### iPHONE (dar dikey; scroll ile hedef icerik secilir)
| Kare | Gorunur icerik (yukaridan kesime kadar) | Ozel kural |
|---|---|---|
| 01-ring | Bugun basligi + halka(112) + haftalik serit + sayac karti + gunluk baslangici | son oge: tam satir/CTA |
| 02-bodymap | HARITA segmenti: ON govde silueti TAM + rotasyon karti TAM ("Onerilen bolgeyi kullan" butonu DAHIL, scroll ile ayarla; siluet ustu header altina girebilir) | siluet YARIM OLAMAZ; buton YARIM OLAMAZ |
| 03-widget | Kilit ekrani sahnesi (cihaz cercevesi icinde BUYUK saat + altinda Live Activity karti "Tokluk Sekeri" + yakininda SON OLCUM widget karti; kartlar birbirine YAKIN, sahne kompakt) | kart-cihaz cakismasi yok; iOS dili |
| 04-food | Karb hero + bugunun ogunleri + arama/kategori baslangici | emoji renkli, tek dil |
| 05-insights | TIR donut + AGP (cizgi 0-24 tam) + GMI/ORT kartlari | AGP sag kenara degiyor olmali |
| 06-report | (cihazsiz) kapak + cizelge sayfasi | bolum 3 kurali |
| 07-spike | Spike sohbet ekrani: 2 mesajlik notr ornek sohbet + yanit altindaki disclaimer satiri gorunur + giris alani | K4 mock durumu; DOZ ICEREN METIN YASAK; disclaimer kirpilmaz |
| 08-takip | Insulinsiz dashboard: 3 sekmeli tab bar (enjeksiyon sekmesi yok); IOB satiri YOK | scenario=tracking; insulin_mode=none / diabetes_type=none profili; baslik/altyazi metinleri TBD |

### iPAD (genis; ICERIK ZATEN SIGAR — iPhone scroll/kirpma MANTIGI UYGULANMAZ)
- Genel: iPad cercevesi (ince esit bezel, ada yok; ust kamera noktasi, alt home-indicator). Kesim yine tab bar ust siniri; ama iPad layout'unda cogu ekran TEK sayfada biter — scroll hilesi gerekmez.
- 02-bodymap: SILUET + ROTASYON KARTI IKISI DE TAM gorunur (iPad'de yer var; yarim siluet KESINLIKLE YASAK). Gerekirse cihaz olcegi kucultulur ama icerik butunlugu bozulmaz.
- 03-widget: sahne iPad KILIT EKRANI oraninda kurulur (genis saat + kartlar yan yana yerlesebilir); kartlar cihaz cercevesinin DISINA tasamaz, cerceveyle cakisamaz.
- Diger kareler (01/04/05/07): iPad layout'unun dogal tek-ekran halleri; bos alan korkusuyla asiri zoom YAPILMAZ. 07-spike iPad'de sohbet balonlari genis duzende, disclaimer gorunur.
- 06: bolum 3 kurali; sayfalar iPad kanvasinda orantili buyur (oran korunur).

### ANDROID TELEFON (Pixel_8)
- Cerceve: ANDROID gorunumu (delikli on kamera, ince bezel); status bar Android stili 09:41 (demo mode). iOS ada/centik OGELERI YASAK.
- 03-widget: TAMAMEN Android dili: Android kilit ekrani (Android saat tipografisi) + Material widget karti + ongoing notification gorunumu. iOS sahnesi kopyalanamaz.
- Kesim kurali ayni (uygulama tab bar ustu; sistem gesture cubugu da off-canvas).
- K1 fix'i sonrasi cekim (kartlar temiz); LogBox kapali; dil gecisi sc-lang + cold relaunch.

### ANDROID TABLET (Pixel_Tablet — GERCEK TABLET RAW)
- iPad mantigi gecerli: icerik sigar, 02'de siluet + rotasyon karti TAM; 03 Android tablet kilit ekrani duzeni; cerceve Android tablet gorunumu.
- tablet10 kanvasi 1600x2560; tablet7 ayni raw'dan 1080x1920 kanvas (oran 9:16 kesin).

## 5. METINLER
- Basliklar (TR): 01 "Tek bakista gunun" · 02 "Her bolge haritada" · 03 "Sayac kilit ekraninda" · 04 "Saniyeler icinde ogun" · 05 "Egilimlerini gor" · 06 "Doktora hazir rapor" · 07 "Sorulara Spike yanit verir" (altyazi ikinci satiri MUTLAKA: tibbi tavsiye vermedigini soyleyen notr cumle) · 08 TBD (baslik/altyazi metinleri sonra eklenecek). EN esdegerleri onceki setten; de/es/fr ayni kalipta notr ceviri.
- Altyazilar 2 SATIR, dolu; iddia dili yasak ("control/lower/prevent" yok); "insulin calculator" HICBIR metinde yok.
- Cipler: 01 "🔥 12 gun seri" · 02 "Bolge rotasyonu" · 03 "Tokluk sayaci acik" · 04 "562 besin" · 05 "30 & 90 gun" · 06 "PDF disa aktar" · 07 "Spike AI" (dil basina yerel).

## 6. DOGRULAMA (her dosyada; otomatik + GOZ)
Otomatik: tam olcu; alpha yok; 9:16 (Android); A4 orani (06); tek dil (OCR ornekleme: profil cipi + yemek adi); 07'de dozlu ifade taramasi (unite/u rakam kaliplari = ihlal) + disclaimer gorunurlugu; AGP-24 (05: cizgi son 40px icinde eksene degiyor); son-oge-tam (bbox); cip-cihaz kesisimi = SIFIR piksel; cip-metin kesisimi = SIFIR.
Goz: HER kompoziti goruntu olarak ac ve bak; kare basina teslim raporunda "siluet tam / buton tam / bindirme yok / platform dogru" satiri. Onceki turlarda otomatik kontrol geciyorken goz hatalari kacti; ikisi birlikte zorunlu.

## 7. SIRA (tek oturum, minimum gidis-gelis)
1. K1+K2 kod -> gateler -> Android + iOS raw etkilenenler icin taze build.
2. TUM cihazlarin TR setleri once: iPhone TR 8 + iPad TR 8 + Android telefon TR 8 + tablet TR 8 = 32 kare -> TEK TOPLU KONTROL icin kullaniciya kontakt sayfasi goster ve DUR (tek onay noktasi).
3. Onaydan sonra kalan 4 dil tum cihazlarda DURMADAN; dogrulama + dil basina kontakt sayfalari.
4. Feature graphic + store icon (mevcutlar korunur; degisiklik gerekmiyorsa dokunma).
5. Teslim: eksiksizlik tablosu (5 dil x 8 kare x [iphone, ipad, android-phone, tablet7, tablet10] = 200), dogrulama ciktilari, kare basina goz-kontrol satirlari, `zerospike-store/OKU-BENI.md` guncel.
