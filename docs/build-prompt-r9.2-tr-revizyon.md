# R9.2 PROMPT: TR Seti Revizyonu (uygulama duzeltmeleri + sablon v6)

Kullanici TR setini inceledi; bulgularin bir kismi UYGULAMA KODU duzeltmesi gerektiriyor (sinirli kapsam, asagida), kalani kompozit sablonu. Diger diller ve iPad hala bekliyor.

## YURUTME SIRASI (Secenek A, kullanici onayli)
Kareler kullaniciya en cabuk ulassin diye is IKI pakete ayrilir:
1. FRAME-KRITIK PAKET (once): A1 banner + A2 renkler + A3 rapor header + A4 seed AGP + A11/A11b/A12 harita + A13 rehber -> A5 gateleri -> TR ham cekimlerinin TAMAMI yeniden -> FAZ B sablon v6 -> FAZ C uret/dogrula/GOSTER. (Not: A1-A4 de karelerde gorunur: banner 01'de, renk ayrismasi 01/05'te, rapor header'i 06'da, AGP yayilimi 05'te. Frame-kritik paketten HICBIRI atlanamaz.)
2. ONBOARDING PAKETI (hemen ardindan, ayni turda): A6-A10 -> gateler tekrar. Bu paket 6 kareyi etkilemez; kareler kullanici incelemesindeyken paralel ilerleyebilir. Onboarding degisikligi biterse cliclick onboarding gecisi bir sonraki cekim turunda (diger diller/iPad) yeni akisa gore guncellenir.

## FAZ A: UYGULAMA KODU DUZELTMELERI (sinirli kapsam, gate'li)
Izinli dosyalar: app/(tabs)/index.tsx (yalniz tokluk banner blogu), lib/theme/tokens.ts + tailwind.config.js (yalniz veryHigh rengi), lib/services/report.ts (yalniz header blogu), lib/db/screenshotSeed.ts, i18n dosyalari (yeni/degisen anahtarlar 5 dil). Baska dosyaya dokunma. Notr dil + em-dash yok kurallari gecerli.

- A1 TOKLUK BANNER'I YENIDEN (kullanici: "o kadar buyuk text ki kotu duruyor, progress bar olabilir"): dashboard'daki aktif tokluk karti kompakt olsun: ustte kucuk etiket (Tokluk Sekeri (2. Saat)), altinda INCE PROGRESS BAR (gecen sureye gore dolan accent serit), sagda kalan sure kisa bicimde ("65 dk"), buyuk cumle metni ("Tokluk hatirlaticisi: ...") KALKAR. Kapatma X'i kalir. 5 dilde metinler guncellenir. Canli sayac davranisi (dakika azaldikca bar dolar) korunur.
- A2 RENK AYRISMASI (kullanici: TIR kartinda Dusuk ile Cok yuksek ayni renk gorunuyor): GLUCOSE_RICH.veryHigh (#f4511e) low (#ff5468) ile karisiyor. veryHigh'i belirgin TURUNCU aileye cek (oneri: #ff8a1f; high #ffb43c ile de ayrisacak kadar koyu). tokens.ts + tailwind.config.js guncelle; TIR donut/legend, JournalItem, rapor stack bar otomatik takip eder. Koyu zeminde kontrast kontrolu yap (dusuk-kirmizi, yuksek-amber, cok yuksek-turuncu net ayrisir olmali).
- A3 RAPOR HEADER REDESIGN (kullanici: header tasarimi ve UX kotu): report.ts ust blok yeniden: tek markali serit: solda "zerospike" (accent) + altinda buyuk "Kan Sekeri Raporu" basligi; sagda uc kucuk satir: hasta adi, tarih araligi, olusturma tarihi. Ince ayrac cizgisi, sonra KPI kartlari. Mevcut daginik baslik/tablolu ust kisim kalkar. Print CSS'te ferah bosluklar; 5 dil.
- A4 SEED AGP YAYILIMI (kullanici: AGP'nin sag tarafi 24'e dogru bos, yarim/yuklenmemis gibi): seed okumalarini gunun saatlerine yay: sabah aclik (07), kahvalti sonrasi (09), ogle sonrasi (13-14), aksam ustu (17), aksam yemegi sonrasi (19-20), gece (22:30). Boylece AGP medyan egrisi 07-23 araligini kapsar, sag kenar bos kalmaz. KORUNACAKLAR: bugunku hero 112 @ ~18:22, streak 12 (12. gun bos), TIR ~%75-80, toplam olcum sayisi makul (100+).
- A5 GATELER: npx tsc --noEmit, npm run i18n-check, npx tsx scripts/calc.test.ts, npx tsx scripts/migration.test.ts. Sonra TR ham cekimlerinin TAMAMINI yeniden al (banner/renk/AGP degisti; eski raw'lar gecersiz).

## FAZ A-EK: ONBOARDING DUZELTMELERI (kullanici bulgulari; izinli dosyalar genisler: app/_layout.tsx yonlendirme blogu, app/onboarding.tsx, components/onboarding/*, i18n)
- A6 ILK ACILIS FLASH'I: uygulama ilk acildiginda KONTROL PANELI bir an gorunup sonra onboarding'e atiyor. Kabul edilemez: onboarding karari verilmeden tab'lar ASLA render edilmemeli. app/_layout.tsx'te splash, ready + onboarded cozulene kadar tutulmali ve ilk yonlendirme ilk frame'den ONCE olmali (Stack render'ini karara kadar bosalt veya splash'i gec kaldir). Kanit: temiz kurulumda acilis dogrudan onboarding'e gider, panel hic gorunmez.
- A7 ONBOARDING'E OZEL INPUT'LAR: isim ve hedef adimlari settings'in InputRow'unu kullaniyor; sayfada kucuk kaliyor ve tasarimi bozuyor. Onboarding'e ozel buyuk input bileseni yaz (components/onboarding/BigInput gibi): buyuk font (24+), genis dokunma alani, ortalanmis/ferah yerlesim, QuizStep gorsel diliyle uyumlu; isim adimi ve (uygunsa) hedef adimi bunu kullanir. Settings bilesenlerine dokunulmaz.
- A8 IZINLER TEK ADIMDA: onboarding sonuna dogru tek bir "Izinler" adimi: bildirim izni buraya tasinir (R7'deki durum-gosteren akis aynen: granted/denied/unavailable, yalan yok); kamera (barkod) ve Apple Health gibi sonradan-istenen izinler burada TANITILIR (ne icin gerektigi bir cumleyle) ama OS istegi kullanim aninda kalir (ilk taramada / Health acildiginda). Adim atlanabilir.
- A9 WIDGET TANITIM ADIMI: izin adimindan once veya ayni akista bir "Her yerde yaninda" adimi: kilit ekrani sayaci (Live Activity) + ana ekran widget'i kucuk gorsel/mockup ile tanitilir (in-app bilesenlerle cizilebilir, 5 dil). Ekstra OS izni gerekmez (bildirim izni yeterli); adimda "ana ekranina widget eklemeyi unutma" tonu + onboarding sonrasi widget-guide'a kisayol. Akis TOPLAMDA fazla uzamamali: mevcut adim sayisina en fazla +2.
- A10 Bu blok da A5 gatelerinden gecer. Onboarding degisiklikleri 6 kareyi ETKILEMEZ (onboarding karesi yok) ama capture akisindaki manuel onboarding gecisi yeni akisla uyumlu olmali (cliclick koordinatlari guncellenebilir).

## FAZ A-EK2: ENJEKSIYON HARITASI KLINIK DUZEN DUZELTMESI (kullanici referansi + FITTER; izinli dosyalar: components/InjectionBodyMap.tsx, lib/data/injectionGuide.ts, i18n)
SCHEMA DEGISMEZ (site enum ayni; yalniz gorunum/yerlesim/metin). Rotasyon mantigi (leastRecentlyUsedPoint) ayni kalir.
- A11 BOLGE YERLESIMI referansa uysun (kesin klinik tarif):
  - KOLLAR ARKA YUZE tasinir: omuz-dirsek arasi kolun ARKA ve DIS YANINDAKI etli/yagli doku; PAZI (on) tarafina ve dirsek altina TASMAYACAK sekilde cizilir. On yuzden kol bolgeleri kalkar. (site id'leri ayni; yalniz view + koordinat.)
  - UYLUK: kasik-diz arasi bolgenin UST-ON YUZU ve DIS YANLARI birlikte (yalniz dis serit degil; on-ust + dis yan kapsayan bolge). IC yan (bacaklarin birbirine surten tarafi) bolgeye dahil gorunmez.
  - KARIN: gobek deliginin cevresinde ~3 cm (2-3 parmak) genislikte bosluk halkasi cizilir; halkanin disindaki sag/sol/ust/alt etli doku 4 ceyrek olarak kalir (2x2).
  - KALCA: kalcanin ortasi degil, UST-DIS ceyrek ("cebin biraz arkasi" konumu); merkezden kacik cizilir, 2x2.
- A11b NOKTA DIZILIMI BOLGEYE GORE: karin ceyrekleri + kalca = 2x2 izgara (mevcut); UYLUK ve KOL = DIKEY 1x4 dizilim (yukaridan asagiya 4 nokta). site_point 1-4 anlami korunur; nokta etiketi bolge tipine gore uretilir: 2x2 icin mevcut "Ust dis/ic, Alt dis/ic", dikey icin "1..4 (yukaridan asagiya)" kalibi, 5 dil. Zoom odak karti da dizilime gore 2x2 veya dikey liste gosterir.
- A12 EMILIM HIZI EGITIM ETIKETI (notr, KISA): bolge secilince tek satir: Karin "en hizli emilim", Kol "orta-hizli emilim", Uyluk "orta-yavas emilim", Kalca "en yavas emilim". Tavsiye dili YOK; 5 dil. "Tibbi tavsiye degildir" satiri kalir.
- A13 REHBER ICERIGI (injection-guide, egitim tonu, 5 dil):
  - Haftalik rotasyon: her nokta ~1 hafta sirayla; ayni noktaya donus 3-4 hafta sonra; noktalar arasi 1-2 cm.
  - Bolge tarifleri: gobek cevresi ~3 cm halka birakilir; uylugun IC kismi kullanilmaz; kolda pazi ve dirsek alti kullanilmaz; kalcada merkez degil ust-dis ceyrek.
  - Yaygin uygulama bilgisi (egitim, tavsiye degil): hizli emilen karin genellikle ogun (hizli etkili) insulini icin, en yavas emilen kalca genellikle gece yapilan uzun etkili (bazal) icin tercih edilir; kol ve kalcayi tek basina uygulamak zor olabilir, ayna veya bir yakinin destegi gerekebilir; kendi kendine uygulamada karin ve uyluk en kolay bolgelerdir.
  - REGULASYON SINIRI (kesin): bu eslesmeler YALNIZ rehber metninde kalir. Uygulama mantigi insulin turune gore bolge ONERMEZ, filtrelemez, isaretlemez (kod tarafinda bazal/bolus - bolge baglantisi kurulmasi YASAK). Rotasyon karti mevcut "en uzun suredir kullanilmayan nokta" gorsellestirmesinden ibaret kalir.
- A14 02-bodymap karesi bu yeni duzenle cekilir (on yuz karin+uyluk gorunumu; istersen zoom karti karin sag ust acik). Gateler A5 ile ayni.

## FAZ B: SABLON v6 (kompozit kurallari)
- B1 EGIM YOK: paneller tamamen dik (yamukluk kalkti; -3 dondurme silinir). Yuvarlak kose + yumusak golge kalir.
- B2 TEK PANEL BOYUTU: 6 karede de ekran goruntusu paneli AYNI genislik ve AYNI dikey konumda (sabit kutu). 03 ve 06 sahneleri de ayni kutuyu doldurur; biri kucuk biri buyuk OLMAZ.
- B3 NAVBAR YOK: uygulama tab bar'i HICBIR karede gorunmez; panel kesimi tab bar'in ustunde, temiz bir satir sinirinda biter (01'deki gibi).
- B4 CIP YERLESIMI: yuzen cipler yalniz (a) krem zeminde veya (b) panelin metin/gorsel icermeyen koyu bos alanlarinda durabilir; herhangi bir metnin/grafigin ustune binen cip YASAK. Kare basina en fazla 2 cip.
- B5 03-WIDGET SAHNESI: gercek kilit ekrani kompozisyonu: ustte buyuk saat tipografili koyu kilit-ekrani paneli, icinde ALTTA gercek Live Activity karti (zerospike - Tokluk Sekeri - 2. Saat - kalan sure); yaninda/altinda ana ekran widget karti (SON OLCUM 112 - Aralikta). APPLE WATCH GORSELI KOYMA: uygulamada watch app yok, gostermek yaniltici metadata (Apple 2.3) riskidir. Sahne B2 kutusunu doldurur.
- B6 06-RAPOR SAHNESI: A3'un yeni header'li kapagi onde ve buyuk, gunluk zaman cizelgesi sayfasi hafif arkada; alt bosluk dar; B2 kutusuna uyar.
- B7 BASLIKLAR (TR): 01 "Tek bakista gunun", 05 "Egilimlerini gor". (Kullanici farkli ifade verirse onunki gecer.)
- B8 02 KESIMI: "Onerilen bolgeyi kullan" butonu gorunmeden, ustundeki satirda biter (onceki karar).

## FAZ D: TR IKINCI REVIZYON (kullanici + hub incelemesi bulgulari)
- D1 RENK KALINTISI (kok neden bulundu): lib/theme/tokens.ts:160'ta ikinci bir veryHigh tanimi hala "#f4511e" (legacy palet blogu). TUM veryHigh tanimlarini tek kaynaga bagla (GLUCOSE_RICH.veryHigh); #f4511e repo genelinde SIFIRLANSIN (grep kaniti). Ayrica algisal mesafeyi buyut: veryHigh daha net turuncuya (#ff9800 ailesi) cekilebilir; Dusuk (kirmizi-pembe) ile kucuk nokta boyutunda bile ayrisir olmali. Insights legend nokta boyutunu 1-2px buyutmek serbest.
- D2 CAPTURE TAZELIGI: token/sabit degisiklikleri hot-reload ile guvenilir yayilmaz. Her cekim oncesi uygulamayi TAM yeniden baslat (terminate + launch); hot-reload'la cekim YASAK.
- D3 AGP 24'E ULASSIN: seed saat dagilimina gece uclari ekle: her gune ~23:40 yatma olcumu + gun asiri ~00:30 olcumu (hoursBySlot'a 23.7 ve 0.5 esdegeri slotlar). Boylece egri 00-24 araligini kapsar, sag ve sol kenar bos kalmaz. Hero 112 @18:22, streak 12, TIR ~%75-80 korunur.
- D4 PANEL BUYUKLUGU: ekran goruntusu paneli 6 karede de ~%15-20 buyusun (dikeyde daha dolu; tek sabit kutu kurali devam). Cipler panele yakin konumlanir, bos kremde yetim durmaz.
- D5 02 KESIMI: panel alt kesimi "Bolge rotasyonu" kart basligini YARIM birakmasin; ipucu metninden sonra temiz sinirda bitsin.
- D6 RAPOR CILASI: kapakta gorsel hiyerarsi buyusun: baslik + KPI kartlari (renkli ust seritleriyle) + TIR bar + AGP thumbnail'de okunur boyutta; ham tablolar kapak gorunumune girmesin (kompozit kirpimi kapagin ust 2/3'unu gosterir). Gerekirse report.ts kapak tipografisi bir kademe buyur.
- D7 Bu fazin kod kisimlari (D1, D3, D6) A5 gatelerinden gecer; sonra TR ham cekimleri ILGILI kareler icin yeniden (01/05 renk+AGP, 06 rapor; 02 yalniz kesim degisiyorsa kompozit kirpimi yeter), sablon D4-D5 ile TR 6 kare yeniden uretilir, gosterilir, DURULUR.

## FAZ E: GECE KOSUSU (kullanici uyuyor; ONAY KAPISI YOK, bitene kadar durma)
Bu fazda "goster ve dur" kurali ASKIDA. Asagidaki duzeltmeler yapilir, sonra TUM teslimat otonom tamamlanir. Sabah kullanici hazir seti inceler.

E1 YUKSEK / COK YUKSEK AYRISMASI (yeni sikayet): #ff9800 (cok yuksek) ile #ffb43c (yuksek) fazla yakin. Dort renk birbirinden ikili ikili ayrisacak: oneri: Yuksek SARIYA kayar (#ffd23f ailesi), Cok yuksek TURUNCU kalir (#ff8a00), Dusuk kirmizi-pembe (#ff5468), Aralikta yesil degismez. Tek kaynak kurali korunur; koyu zeminde kucuk nokta boyutunda dortlu ayrisma gozle dogrulanir (test ekran goruntusu al, kendin bak).

E2 AGP CIZGISI 24'E DEGECEK (kesin cozum, cizim tarafi): seed verisi 00:30-23:40 araligini kapsiyorsa sorun kova merkezlerinde: son kova ~23.5'te cizilip birakiliyor. lib/agpChart.ts (ve varsa GradientAreaChart gecis noktalari) medyan + IQR poligonunun UC noktalarini domain kenarlarina (x=0 ve x=24) uzatacak sekilde duzeltilir (uc degerleri kenara clamp'le). AGP surekli bir profil egrisidir, kenara uzatma standart gosterimdir. KANIT ZORUNLU: 05 ham cekiminde cizginin sag kenarda 24 hizasina degdigini goster (kirpilmis yakin plan ekran goruntusu uret ve teslim klasorune koy). Bu madde onceki iki turda "yapildi" denip yapilmadi; bu sefer kanitsiz kapatma YOK.

E3 06-RAPOR KOMPOZISYONU GERI ALINIR: kullanici iki-sayfa yan yana gosterimi begenmedi; ONCEKI yelpaze kompozisyona don (kapak onde buyuk, zaman cizelgesi sayfasi hafif arkada/acili), D4 panel boyutu ve D6 tipografi buyumesi korunarak.

E4 PANEL ORANI TELEFON GIBI GORUNSUN (yeni sikayet: "tablet gibi genis"): panel kutusu GENISLETILEREK buyutulmus; yanlis. Kural: gorunur panel TELEFON oranini korur: gorunur yukseklik >= gorunur genisligin ~1.9 kati. Buyume genislikten degil YUKSEKLIKTEN gelir (daha uzun ekran kesiti goster, genisligi daralt: kanvasin ~%62-68'i). 6 karede ayni kutu kurali devam.

E4a BASLIK-GERI BUTONU BOSLUGU (kullanici bulgusu, uygulama kodu): pushed ekran basliklarinda geri butonu ile baslik arasinda yatayda asiri bosluk var (ornek: Icgoruler). components/ScreenHeader.tsx duzeltilir: geri butonu + 8-12px bosluk + baslik SOLA hizali (flex-1, ortalama yok); sagdaki aksesuar alani (tarih cipi vb.) korunur. ScreenHeader kullanan TUM ekranlarda tutarli (insights, settings alt sayfalari, widget-guide, sources, injection-guide, profile-setup...). Gate'lerden gecer; 05 ham cekimi bu duzeltmeden SONRA alinir.

E4b PLATFORM SADAKATI (kullanici kurali, HER karede): magazalar platform tutarliligina bakar. Bu kosu iOS-only oldugu icin TUM karelerdeki sistem yuzeyleri iOS dilinde olmali: kilit ekrani sahnesi iOS kilit ekrani tipografisi/duzeni, widget koseleri ve kart dili iOS WidgetKit gorunumu, hicbir karede Android/Material ogesi (Android saat stili, Material ikon/toggle, Roboto hissi) SIZMAMALI. Ozellikle 03-widget sahnesi iOS'a ozgu kalir. ILERIDE Play seti uretilirse 03 karesi Android diliyle (Android kilit ekrani, Material widget kartlari) SIFIRDAN kurulur; iOS sahnesi Play'e kopyalanmaz (tersi de gecerli). Dogrulama adimina ekle: her karede platform-yabanci oge kontrolu.

E5 OTONOM TAMAMLAMA SIRASI (durma yok):
  1. E1-E4 kod+sablon duzeltmeleri -> gateler -> TR ham (tam restart ile) -> TR 6 kare + dogrulama.
  2. en/de/es/fr iPhone: dil basina seed/dil gecisi + ham cekim + 6 kare (06-report PDF her dilde ayrica uretilir; 03-widget metinleri her dilde).
  3. iPad Pro 13 (2064x2752): 5 dil ham + 6 kare (iPad gercek cekim; panel orani iPad'de de cihaz oranini korur, telefon esnetme yok).
  4. Dogrulama HER dosyada: olcu, alpha, tek dil, cip dili, tab bar yok, panel kutusu tutarli, E2 AGP kaniti. Ihlalde o kare yeniden.
  5. Kontakt sayfalari: dil basina 1 (iPhone) + 1 (iPad) PNG, zerospike-store/_PREVIEW-*.
  6. ASO METIN PAKETI: docs/aso-appstore.md'yi mevcut ozellik setiyle guncelle ve zerospike-store/aso/ altina dil basina metadata dosyasi yaz (5 dil): uygulama adi, alt baslik (30 kr), tanitim metni (170 kr), aciklama, anahtar kelimeler (100 kr), yenilikler notu. KURALLAR: iddia dili yok, "insulin calculator" YOK, dozlar "kayit/tahmin" dili, notr; Apple 1.4.1/2.3 uyumu; TR anahtar kelimelerde diakritikli/diakritiksiz varyantlar.
  7. TESLIM RAPORU: eksiksizlik tablosu (5 dil x 6 kare x 2 cihaz = 60 dosya), dogrulama ciktilari, E2 kaniti, ASO paket ozeti, sabah incelemesi icin "bakilacaklar" kisa listesi. Yukleme adimlari OKU-BENI'de; yukleme HUMAN.

## FAZ F: KESIN MAGAZA OLCULERI (kullanicinin konsol metinleri ESAS; onceki plan olculerini ezer)
- IPHONE KOMPOZIT BOYUTU DEGISTI: kullanicinin App Store Connect slotu su boyutlari kabul ediyor: 1242x2688, 1284x2778 (ve yataylari). 1320x2868 LISTEDE YOK. Kanonik cikti: **1284x2778 dikey**. Kompozitör parametrik: ham cekimler ayni kalir, tum iPhone kareleri 1284x2778 render edilir. Klasor: zerospike-store/iphone-1284x2778/<dil>/. OKU-BENI guncellenir. (Ileride konsol 6.9" kabul ederse tek komutla 1320x2868 yeniden uretilebilir; simdilik konsol metni esastir.)
- IPAD: 2064x2752 kabul listesinde, AYNEN devam (2048x2732 alternatif).
- APPLE WATCH: gerekmiyor (watch app yok; slot bos kalir).
- DOSYA KURALLARI: iOS PNG/JPEG alpha'siz; Play ekran goruntusu <=8MB, feature graphic 1024x500 PNG/JPEG <=15MB.

## FAZ G: ANDROID / PLAY SETI (gece kosusuna DAHIL; kullanici Play olculerini verdi)
Onceki "Android iptal" karari kalkti; iOS seti bittikten sonra ayni gece uretilir.
- G1 TELEFON: Pixel_8 emulatoru, screenshot-mode build; 5 dil x 6 kare ham + kompozit **1080x1920** (kesin 9:16; kenar 320-3840 kurali icinde). Dil gecisi caveat'i: deep-link foregrounddayken dil degistirmiyorsa her dil icin terminate + relaunch kullan.
- G2 03-WIDGET ANDROID DILIYLE SIFIRDAN (E4b geregi): Android kilit ekrani stili (Android saat tipografisi) + Material widget karti; iOS sahnesi KOPYALANMAZ. Diger karelerde de platform-yabanci oge kontrolu.
- G3 TABLET: Pixel_Tablet ile 10" gercek ham cekim; tablet10 kompozit **1600x2560** (9:16, kenar 1080-7680); tablet7 icin ayni sablon **1080x1920** (kenar 320-3840). Telefon esnetme yok; tablet ham cekimi kullanilir.
- G4 FEATURE GRAPHIC: dil basina 1024x500 (cihazsiz, koyu zemin + halka motifi + logo + tek satir slogan, icerik orta guvenli bolgede, <=15MB) -> google-play-extras/<dil>/. store-icon-512 mevcut ikondan.
- G5 DOGRULAMA (Play): oran kesin 9:16, boyut siniri, <=8MB, tek dil, platform sadakati. Klasorler: android-phone/<dil>/, android-tablet7/<dil>/, android-tablet10/<dil>/.
- G6 ASO paketi (E5.6) Play metinlerini de kapsar: Play basligi (30), kisa aciklama (80), uzun aciklama; ayni regulasyon kurallari.

## FAZ H: APPLE SAGLIK'A YAZMA (yeni ozellik; SIRA KURALI: E/F/G gorsel teslimati TAMAMEN bittikten sonra basla, gorselleri asla geciktirme/bozma)
Kullanici istegi: manuel girilen kan sekeri degerleri Zerospike tarafindan Apple Saglik'a YAZILSIN (su an yalniz okuma var). iOS-only (Health Connect Play politikasi nedeniyle kaldirilmisti, Android kapsam disi).
- H1 YAZMA SERVISI: kullanici acarsa (yeni tercih: "Apple Saglik'a yaz", settings Veri sayfasinda, PRO Health bolumunde, varsayilan KAPALI) her manuel glukoz kaydi (source != "health") HealthKit bloodGlucose ornegi olarak yazilir (mg/dL, dogru HKUnit; healthkit v14 saveQuantitySample). Donen HK UUID'si saklanir: sugar_logs'a nullable healthkit_uuid kolonu, schema v10 migration (v8/v9 kalibi: transaction + test; migration.test'e v10 vakasi).
- H2 DONGU KORUMASI (kritik): Health IMPORT yolu, kaynagi kendi bundle'imiz (app bundle id) olan ornekleri ATLAR (sourceRevision bundle kontrolu). Aksi halde yazdigimizi geri okuyup cift kayit uretiriz. Bu filtrenin calistigini kanitla (yaz-oku dongusunde tek kayit kaldigi).
- H3 SILME YAYILIMI: healthkit_uuid'li bir okuma silinirse (undo dahil) HK ornegi de best-effort silinir (yalniz kendi yazdigimiz silinebilir; hata sessiz yutulur, kayit silme islemini bloklamaz).
- H4 IZIN: app.json infoPlist'e NSHealthUpdateUsageDescription (notr metin, 5 dil ios-locales'e); yazma izni TOGGLE ACILIRKEN istenir (point-of-use), onboarding'de istenmez. Izin reddedilirse toggle kapali kalir ve durum notr gosterilir (R7 izin kalibi).
- H5 METINLER: settings toggle + aciklama 5 dil, notr ("Kaydettigin olcumler Apple Saglik'a da yazilir"); onboarding A8 tanitim cumlesi genel kalir. ASO metinlerinde bu gece IDDIA EDILMEZ (yalniz mevcut "Apple Saglik ile senkron" genel ifadesi kalabilir).
- H6 GATELER: tsc, i18n-check, calc, migration (v10 dahil). app.json version yine sabit. Teslim raporunda ayri bolum; cihaz dogrulamasi (gercek Health yazimi) HUMAN olarak isaretlenir.

## FAZ I: SABLON v7 - PADSCANNER YAPISI (kullanici sabah incelemesi; ONCEKI CERCEVESIZ KARARI IPTAL EDER)
Kullanici referansi padscanner ornegi. R9.1'deki "cihazsiz, status bar yok, navbar yok" karari ve E4 panel kurallari IPTAL. Yeni yapi:

- I1 CIHAZ CERCEVELI KOMPOZIT: gercek telefon cercevesi cizilir (bezel + dynamic island + yuvarlak koseler; Android'de Android cercevesi). Icinde TAM ekran goruntusu: status bar DAHIL, uygulama tab bar'i DAHIL, hicbir kirpma yok. Cihaz DIK durur (egim yok) ve ALTTAN kanvas kenariyla kesilir (cihazin alt ~%10-18'i tasar; padscanner yapisi). Yanlarda nefes alani birakilir; cihaz kanvasa yapismaz ("cerceve cok kirpiliyor, alan birakilmali").
- I2 STATUS BAR GERI GELDI: iOS cekimlerinde simctl status_bar override (9:41, tam pil, tam sinyal); Android'de adb demo mode 09:41. Cekim oncesi uygulanir.
- I3 TUM RAW'LAR YENIDEN: tam yuzey (kirpmasiz) cekim; iOS 5 dil x iPhone + iPad, Android tum diller. Eski kirpik raw'lar gecersiz.
- I4 BINDIRME SIFIR (kullanici defalarca uyardi): yuzen ogeler baslik/altyaziya ve ekran ICI metin/grafige ASLA binmez; cihaz KENARINA tasabilir (padscanner gibi) ama altindaki ekran metnini ortmez. Iki kontrol: (a) otomatik metin-bolgesi maskesi, (b) her kompoziti KENDIN OKU (goruntu olarak ac, bak) ve teslim raporunda kare basina "bindirme yok" satiri isaretle. Ihlalli kare yeniden.
- I5 06-RAPOR: sayfalar kutuyu DOLDURUR, bos krem yari YASAK; kapak buyuk onde, cizelge hafif arkada; 06'da cihaz cercevesi kullanilmaz ama ayni alt-tasma/oran duzeni korunur.
- I6 ANDROID CARB HERO EFEKTI (uygulama kodu, sinirli): food ekraninda "BUGUNKU KARBONHIDRAT" kartinin arka efekti (glow/gradient) Android'de bozuk. Platform-uyumlu cozum (Android icin elevation/duz gradyan fallback; iOS gorunumu degismez). Gateler; Android raw'lari fix SONRASI.
- I7 ANDROID DIL HOOK'U: scLang cold-start hook'u (screenshot modu arkasinda) eklenir; dil gecisi terminate+relaunch ile; tr/de/es/fr telefon + tablet setleri tamamlanir.
- I8 SIRA: I6+I7 kod -> gateler -> tek PROVA: tr/iphone/01-ring v7 yapisiyla uret ve KULLANICIYA GOSTER (yapi onayi; kullanici uyanik). Onaydan sonra DURMADAN: tum iOS + Android + tablet kompozitleri v7 ile, dogrulama (olcu/alpha/tek dil/platform sadakati/BINDIRME-SIFIR), kontakt sayfalari, guncel teslim raporu.

## FAZ I-REV (prova sonrasi kullanici ayarlari; I1/I8'i guncellemektedir)
- I-R1 ALT KESIM KURALI KESINLESTI: kesim cizgisi uygulama TAB BAR'ININ UST SINIRINA denk gelir. Yani cihaz, ekran goruntusundeki tab bar'in ust kenari kanvasin alt kenariyla cakisacak sekilde konumlanir: navbar gorunmez, icerik tab bar'a kadar tam gorunur, yuzen CTA dilimi/yarim satir artifact'i olmaz. Sabit yuzde taSma yok; hiza NAVBAR SINIRINDAN turetilir (her cihaz/ekran icin ayni kural).
- I-R2 TIPOGRAFI BUYUR: baslik ("Tek bakista gunun") ~%20-25 buyur, altyazi orantili buyur; iki satirlik baslik alani (de/es/fr) korunur. Bosluklar dolu gorunmeli; cihaz ustu bosluk 120-160px kurali gecerli.
- I-R3 CIHAZ CERCEVESI ONAYLI: cerceveli yapi kesinlesti (tum cihazlar zaten yeniden cekiliyor).
- I-R4 SIRA DEGISTI: once IPHONE TR SETI (6 kare) tamamlanir, dogrulanir ve KULLANICIYA GOSTERILIR. Onaydan sonra kalan her sey durmadan: en/de/es/fr iPhone + iPad 5 dil + Android (I7 hook ile) + tabletler + kontakt sayfalari + teslim raporu.
- I-R5 SON OGE TAM GORUNUR (kullanici ayari): her karede gorunur ekranin EN ALTINDAKI oge (kart/satir/CTA/metin) TAM gorunmeli; kesim cizgisi (tab bar ust siniri) bir ogeyi ortadan bolmemeli. Cozum oncelik sirasi: (1) raw cekimde scroll pozisyonunu birkac px ayarla (son oge kesime tam otursun), (2) gerekirse cihaz konumunu +-20-40px kaydir. Kesim yine tab bar ust sinirindadir, navbar gorunmez. Kare basina kontrol listesine "son oge tam" satiri eklenir.

## FAZ J: v7 SON DUZELTMELER (kullanici incelemesi, iOS seti uzerine)
- J1 ALTYAZI UZASIN: her karede altyazi 2 satira cikabilir; mevcutlar kisa kaliyor. Kare basina daha dolu, iddiasiz altyazi yaz (5 dil; orn. 01 TR: "Glukoz, ogun ve dozlarin tek ekranda; tokluk sayaci ve haftalik ozet yaninda"). Buyuyen tipografiyle dengeli.
- J2 02 KESIMI DEGISTI (kullanici karari, onceki B8/D5 kuralini ezer): "Onerilen bolgeyi kullan" butonu TAM gorunur; kesim butonun ALTINDAN gecer (I-R5 son-oge kurali butona uygulanir).
- J3 03-WIDGET: (a) i18n duzeltmesi (uygulama kodu, 5 dil): Live Activity basligi sadelesir: TR "Tokluk Sekeri" (nokta ayraci ve "2. Saat" KALKAR); diger dillerde esdeger sade baslik ("Post-meal glucose" vb.). widget.timerTitle anahtari guncellenir (gercek LA + sahne ayni metni kullanir); gateler. (b) Sahne yerlesimi: Live Activity karti ustteki SON OLCUM kartina YAKLASIR (buyuk bosluk kapanir, iki kart gorsel grup olusturur).
- J4 06-RAPOR: iki rapor sayfasi AYNI BOYUTTA olur ve arka arkaya (hafif ofsetli, biri onde biri arkada) dizilir; farkli boyut yasak; kutu dolu kalir.
- J5 ANDROID STABIL TUR ONAYLI: LogBox screenshot modunda kapatilir (isScreenshotMode iken LogBox.ignoreAllLogs, tek satir, cift kilit arkasinda) veya release APK ile cekilir; sekme-basina cold-relaunch + iki-launch seed workaround kabul; ardindan Android tr/de/es/fr + 02 + tabletler tamamlanir (Material 03 dahil, platform sadakati).
- J2-KESIN (hala yarim cikiyor): kesim cizgisi tab bar ust sinirinda SABIT kalir; butonu tam gostermenin TEK yolu raw'daki SCROLL pozisyonudur: 02 ham cekiminde sayfa, rotasyon kartinin butonu dahil TAMAMI tab bar ustunde kalacak kadar asagi kaydirilir (harita hero'nun ustu header altina kismen girebilir, kabul). PIKSEL DOGRULAMASI ZORUNLU: buton bounding-box'inin alt kenari < tab-bar-ust-y; kontrol ciktisi teslim raporuna. Goz karari yasak.
- J4-KESIN (rapor sayfalari tablet gibi genis cikti): rapor sayfalari A4 dikey ORANINI (1:1.414) KORUR; en/boy esneme-bozma YASAK. Iki sayfa ayni boyut, arka arkaya hafif ofset. Olcek kurali: ON sayfanin GENISLIGI kanvasin %55-62'si araliginda kalir (genislikten buyutme yasak); kutu doldurma on sayfanin alta tasmasi + arka sayfanin gorunmesiyle saglanir. Oran dogrulamasi (genislik/yukseklik = 0.707 +-0.02) teslim raporuna.

- J6 SIRA: J3a+J5a kod -> gateler -> iOS 60 kare yeniden render (raw'lar ayni; 02 kesim, 03 sahne, 06 duzen, tum altyazilar) -> TR kontakt sayfasini KULLANICIYA GOSTER (bilgi amacli; uretim durmaz) -> paralelde Android stabil turu + tabletler + kontakt + guncel teslim raporu. Dogrulama + bindirme-sifir + son-oge-tam kare basina devam.

## FAZ C: URETIM + DUR
1. TR 6 karesini v6 sablonuyla uret -> zerospike-store/iphone-1320x2868/tr/.
2. Dogrulama: olcu/alpha/dil safiyeti/cip dili + YENI kontroller: panel kutusu 6 karede ayni mi (piksel karsilastirma), tab bar hicbir karede yok mu, cip metin ustune biniyor mu (metin bolgesi maskesiyle otomatik kontrol).
3. Kontakt sayfasi + 6 dosyayi kullaniciya goster, ONAY BEKLE. Diger diller + iPad onaydan sonra.
