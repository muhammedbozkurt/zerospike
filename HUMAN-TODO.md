
## 2.3.0 paketi sonrasi (23 Agu 2026) - INSAN

- [ ] Xcode 26 derleme (native modul degisti, prebuild + build SART): yeni
      `scheduleCountdownTimer` icindeki AlarmKit countdown adlari bu ortamda hic
      derlenmedi. Kontrol edilecekler: `Alarm.CountdownDuration(preAlert:postAlert:)`,
      `AlarmPresentation.Countdown(title:)` (pauseButton parametresi zorunlu
      cikarsa eklenmeli, o zaman 9 dilde "duraklat" metni de gerekir),
      `AlarmPresentation(alert:countdown:)`, `AlarmManager.AlarmConfiguration(countdownDuration:attributes:)`.
      Hata verirse modulun sozlesmesi geregi tek sonuc `false` doner ve tokluk
      sayaci eski bildirim + Live Activity yoluna duser, uygulama bozulmaz.
- [ ] Cihaz QA: docs/plan-2.3.0.md bolum 10 (18 senaryo), ozellikle 9b sistem
      sayac kartinin gorunumu (kabul edilemezse geri alma tek satir:
      DEFAULT_PREFS.postMealAlarm = false).
- [ ] GELECEK (bu turda kod DEGISTIRILMEDI, yalniz not): taze kurulumun ALTER
      penceresi. lib/db/index.ts:507-520 createSchemaV1 icinde v19 ve v21
      kolonlarini KOSULSUZ `ALTER TABLE reminders ADD COLUMN` ile ekliyor
      (v19'dan beri boyle). Tablo hemen ustte yaratildigi icin normalde
      guvenli, ama kurulum tam bu araliktan sonra ve `PRAGMA user_version`
      damgasindan once olurse (crash, kullanicinin uygulamayi oldurmesi, disk
      hatasi) sonraki acilista createSchemaV1 bastan kosar: `CREATE TABLE IF
      NOT EXISTS` tabloyu atlar, ALTER'lar ise "duplicate column name" ile
      patlar ve initDatabase hep ayni yerde kalir. Cozum adaylari: (a) ayni
      kolon eklemelerini migrateToV19/V21'in kullandigi "eksikse ekle" guardli
      formuna cevirmek, (b) tum createSchemaV1'i tek transaction icine almak.
      Sahada gorulmus bir vaka yok; 2.4.0 adayi.
- [ ] Store: zerospike-store/aso/{9 dil}.md "What's New" 2.3.0 bloklari ve
      review-notes-en.md konsollara; app.json 2.3.0 / iOS build 61 / Android
      versionCode 58.

## 2.0.0 paketi sonrasi (18 Agu 2026) - INSAN

- [ ] Fiyat guncellemesi: docs/pricing-2026-08.md tablosu (ASC abonelik + lifetime, RevenueCat downsell urunu, Play). Mevcut abonelere "preserve price".
- [ ] Cihaz QA: temiz kurulum onboarding (tani yok yolu + Insulin/Hap/Ikisi/Hicbiri sorusu), ilac hizli ekleme + gunluk satiri + hatirlatici, widget ilac kisayolu (iOS + Android; eski snapshot'ta gizli kalmali), 9 dilde dil secimi ve Arapca ekranlarin okunurlugu (RTL yok, LTR duzen bilincli).
- [ ] Xcode: widget hedefi derle (QuickAdd.swift 4 kutucuk yerlesimi degisti), Dynamic Island/widget QA.
- [ ] Store yuklemeleri: zerospike-store/aso/{9 dil}.md metinleri + zerospike-store/ gorselleri konsollara; yeni store dilleri ASC/Play'de aktive et (it, pt-BR, ar, ja).
- [ ] ARAPCA CIHAZ TURU (build oncesi sart): sistem dili Arapca olan gercek cihaz/simulatorde tam tur. Kodda I18nManager cagrisi yok; iOS, CFBundleLocalizations'ta ar ilan edildigi icin RN'i otomatik RTL'e cevirebilir ve ekranlar ayna duzen icin kodlanmadi. Bozuksa cozum karari: Info.plist'te ar'i gecici cikarmak MI, I18nManager.allowRTL(false) MI (native degisiklik), 2.1'de tam RTL mi.
- [ ] Yerel Xcode build alinacaksa: ios/ prebuild ciktisi bayat (Info.plist 5 dil). EAS sorunsuz (CNG). Yerel build oncesi "npx expo prebuild -p ios" gerekir; sonrasi Android styles.xml patch'i kuralini unutma.
- [ ] Bilinen kalemler (2.0.1 adaylari): Arapca tam RTL duzen; ilac not alani UI'i (eklenirken report/export'a note kolonu da eklenmeli, su an dusuyor); katalog it/pt icin alias enjeksiyonu (arama deneyimini daha da iyilestirir).
- [x] Spike edge function deploy edildi (self-diagnosis satiri + mevcut max_tokens 500).

## Redesign: store oncesi kaldir
- [x] app/design-gallery.tsx SIL (dev-only tasarim galerisi)
- [x] app/_layout.tsx DEV_SCREENSHOT_ROUTE kancasini SIL (null-gated ama kalmasin)

## 1.6.0 gece paketi sonrasi (2 Agu 2026)
- [ ] Xcode: widget hedefini derle (QuickAdd/index/PostMealActivity Swift redesign edildi) ve cihazda widget + Dynamic Island QA
- [ ] Temiz kurulumda onboarding QA: splash sonrasi DOGRUDAN onboarding gelmeli, bildirim izni butonu sistem promptunu acmali (simulatorde de)
- [ ] Gercek cihazda Apple Health QA: yazma anahtari acikken ekle/duzenle/sil akisinin Health'e yansimasi
- [x] Android nav-bar contrast fixi artik config plugin (plugins/withAndroidNavBarContrast.js, app.json'da kayitli); "expo prebuild --clean" guvenli, elle styles.xml patch'i GEREKMEZ
- [ ] git commit oncesi seed kontrolu: `git diff HEAD -- lib/db/seed.ts | grep '^-' | grep 'en:'` ciktisinda ESKI (562'lik) katalogdan silinen/yeniden adlandirilan bir `en:` adi GORUNMEMELI (top-up name_en ile eslesir; eski bir en adi degistiyse mevcut kullanicida o yemek cift gorunur). `Stuffed eggplant (olive oil)` satirinin silinmesi (c745277) top-up kopyasi uretmez, top-up yalniz eksik adlari INSERT eder, silinen bir adi asla fark etmez; ama 1.4.x kullanicilarinda iki imambayildi kaydi (Karniyarik + Imambayildi) zaten mevcut olabilir, bu satirin gecmisiyle ilgisizdir. Gingerbread rename'i ise RENAMED_EN haritasiyla (lib/db/seedVersion.ts) korunuyor
- [ ] git: tum degisiklikleri gozden gecirip commit et (surum 1.5.1, iOS build 41, Android versionCode 40)
