# zerospike GORSEL YENIDEN TASARIM (ONAYLI MOCKUP'A GORE): Midnight Monitor (2026-07-20)

Sen zerospike reposunda calisan bir BUILD session'isin. Bu sozlesme, R5 turunun (docs/
build-prompt-r5-major.md) GORSEL katmanini ONAYLI bir tasarima baglar. Kullanici, gorsel
olarak "cok az/basit" bulundugu icin daha ZENGIN bir tasarim onayladi; hedef premium,
gorsel-yogun bir CGM-panel hissi.

## BAGLAYICI TASARIM REFERANSI
`docs/design/redesign-mockup.html` = kullanici tarafindan ONAYLANMIS gorsel spec (v2,
zenginlestirilmis). Tarayicida ac ve BIREBIR uygulanacak yon: **B · Midnight Monitor**.
Her ekranin hedef gorunumu (halka gostergeler, gradyan grafikler, isilti, golgeli harita)
telefon-cerceveleri icinde cizili. Bu dosya kilittir.

## KABUL KRITERI (pazarliksiz)
- Olcut GORSEL ZENGINLIK ve mockup'a uyumdur; "token zaten var / design system kuruldu /
  StatCard mevcut" DEGIL. Onceki tur temiz ama SADE cikti; kullanici bunu reddetti.
- HER ekran mockup'taki gorsel yogunluga ulasacak: glukoz HALKA gostergesi, TIR DONUT'u,
  GRADYAN alan grafikleri (glow'lu), golgeli vucut haritasi, isiltili kartlar. Duz sayi +
  cizgi YETMEZ.
- Teslimde her ekran icin ONCE/SONRA simulator ekran goruntusu ZORUNLU. "Bu ekran zaten
  boyleydi" ancak ONCE goruntu kanitliyorsa gecerli; aksi halde yeniden tasarla.

## KILITLI (regülasyon + R5)
- REGULASYON: "uyarir/alarm/tani/tedavi/onerilen doz/mudahale" YASAK. Nötr dil. Doz ekrani
  "hesaplanan" (kullanici orani), "onerilen" degil. Spike doz sayisi VERMEZ, saglik kayitlari
  GONDERILMEZ. Isı haritasi/rehber dili nötr ("en az kullanilan").
- R5 YAPISAL islerine dokunma (kalem kaldirma v7, liveData omurgasi, ai-ask-spike function):
  onlar KALIR; bu tur onlarin GORSEL sunumunu mockup'a cikarir.
- Her yeni string 5 dilde (tr.ts sema; `npm run i18n-check`). EM-DASH YASAK (kod yorumu
  dahil). Kapilar: `npx tsc --noEmit` + `npm run i18n-check`. app.json version'a DOKUNMA.

## TASARIM TOKEN'LARI (mockup Midnight Monitor'dan birebir; lib/theme'e)
- Zemin (katmanli): radial(130% 60% @15% -5%, #123141, transparent) + radial(120% 70%
  @100% 105%, rgba(46,230,255,.12)) + linear(#0f2029 -> #080e14). Duz tek renk DEGIL.
- Metin: #eaf6fa (ink), #89a3b0 (muted). Vurgu/cyan: #2ee6ff.
- Glukoz renk dili (HER yuzeyde ayni, renk tek isaret degil + sayi/etiket): dusuk #ff5468,
  hedef #22e39a, yuksek #ffb43c, cok-yuksek #ff7a3c. (R5'te low=kirmizi karari korunur.)
- Cam kart: linear(glass, rgba(255,255,255,.015)) + border rgba(255,255,255,.10) + inset
  highlight; radius 16. Hero kartlar GLOW (box-shadow renk-esli).
- Avatar: konik gradyan. Rakamlar TABULAR (system/-apple-system; oyun degil, ui-rounded YOK).
IMZA GORSELLER (bunlar olmadan "zengin" sayilmaz):
- GLUKOZ HALKA GOSTERGESI: gradyan stroke (yesil->cyan) + drop-shadow glow, ortada sayi;
  dashboard + onboarding hero + watch. (SVG arc.)
- TIR DONUT: renk halkalari (dusuk/hedef/yuksek dilimleri), ortada %.
- GRADYAN ALAN GRAFIKLERI: AGP, saatlik, sparkline hepsi alan-dolgu gradyani + cizgi glow +
  hedef bandi. (react-native-svg mevcut.)
- GOLGELI VUCUT HARITASI: silüet + sicak-nokta radyal gradyan.
- Ilerleme cubuklari neon (gradyan + glow), plakali ikonlar, quiz buyuk ikon kartlari.

## KAPSAM: HER EKRAN, TEK PUSHTA (duraksama YOK)
Faz 1 (token + imza-bilesen) BITTI ve commit'li; ama bunlar yalniz KUTUPHANE + dev-galeri.
GERCEK EKRANLAR HALA ESKI TASARIMDA. Kullanici TUM ekranlarin yeni tasarimi kullanmasini
istiyor. Kalan TUM ekranlari (Faz 2-9) ARDI ARDINA, DURMADAN donustur; arada onay BEKLEME.
Ekran hala eski gorunuyorsa, gerekirse gorunum kodunu SIFIRDAN yaz. Hicbirini "zaten
iyiydi/tokenlar var" diye ATLAMA. Ozellikle: dashboard, injection isi haritasi, insights,
ONBOARDING (karsilama+quiz+reveal), kayit akislari, Spike sohbet: bunlar mockup'a cekilecek.
Her ekran imza-gorseli (halka/donut/gradyan/golgeli-harita) kullanmali; duz kart+sayi YETMEZ.
Bitince TEK rapor; hub tumunu bir kerede dogrular. FAZLAR (sira, ama durmadan):
FAZ 1 - Token + imza-bilesen (mockup B01/B10) [BITTI]: renk/gradyan/glow token'lari lib/theme'e;
  GlucoseRing (SVG arc gauge), TIRDonut, GradientAreaChart, glow'lu Card, neon ProgressBar,
  konik Avatar, IconTile. Mevcut StatCard/Sparkline/AnimatedNumber bunlarla zenginlesir.
FAZ 2 - Cekirdek sekmeler (B03): dashboard (merkez GlucoseRing + aktif zamanlayici karti +
  renk-kodlu gunluk), food (neon karb ilerleme + illustre ikonlar), injection (golgeli isi
  haritasi), insights (TIR donut + gradyan AGP + StatCard). CIHAZ TESTI notu.
FAZ 3 - Onboarding (B02): karsilama (parlayan marka amblemi), quiz-tip (ikon kartlar), quiz-
  hedef (gorsel band), reveal (gradyan alan onizleme). Mevcut quiz mantigi korunur.
FAZ 4 - Kayit akislari (B04): sekerin girisi (dev parlayan rakam), ogun ekle (illustre +
  neon toplam), doz hesaplayici (parlayan sonuc; "hesaplanan"), barkod tarama (glow cerceve).
FAZ 5 - Rapor (B05): doktor PDF (ozet kart + aralik cetveli + gunluk 24h serit, acik zemin
  baski icin) + saatlik icgoru (gradyan). mySugr paritesi.
FAZ 6 - Spike gorsel (B06): izin kapisi (konik amblem) + sohbet (baloncuk + sorumluluk notu).
  (R5 function korunur; bu RN client + consent gate gorsel.)
FAZ 7 - Ayar/bilgi/guvenlik (B07): settings (plakali ikon satirlar), kaynaklar, enjeksiyon
  rehberi (parlayan gorsel), SOS (radyal glow), acil kisiler, profil.
FAZ 8 - Abonelik (B08): paywall (glow kartlar, fatura baskin), downsell, winback.
FAZ 9 - Native yuzeyler (B09): kilit ekrani Live Activity (glow kart), Dynamic Island,
  home widget, Apple Watch (halka + komplikasyon). App Group veri sozlesmesi docs'ta;
  @bacons/apple-targets; HUMAN adimlari (portal/EAS/prebuild) raporda.
FAZ 10 - Sistem/bilesen (B10): toast/dialog temali; glukoz cip/StatCard/gradyan sparkline
  son cila.

## TESLIM
Her ekran ONCE/SONRA simulator screenshot (ZORUNLU). Faz basi degisen dosyalar; imza-bilesen
dosya yollari; token ozeti; regülasyon teyidi (nötr dil, doz sayi yok, kayit gonderilmez);
tsc + i18n-check ciktilari; faz basi commit listesi; native HUMAN adimlari. "Zaten yapilmis"
ancak ONCE screenshot kanitliyorsa kabul.
