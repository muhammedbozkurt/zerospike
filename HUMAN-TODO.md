
## 2.3.0 paketi sonrasi (23 Agu 2026) - INSAN

### K3 paketi (Kapsam 3, 25 Agu 2026)

- [ ] **Xcode: Live Activity modulu async'e gecti.** `start`, `end` ve YENI
      `update` artik `AsyncFunction`. `npx expo prebuild` sonrasi
      ZerospikeLiveActivityModule.swift'in derlendigini ve JS tarafinda
      `startPostMealActivity(...)` cagrisinin bir Promise dondurdugunu
      dogrulayin (mevcut cagiranlar await etmiyor, bu kasitli).
- [ ] **K3-6 yaris testi cihazda.** Yemek kaydet -> hemen iptal et -> hemen
      tekrar kaydet. Kilit ekraninda TEK ve dogru sayac kalmali. Eskiden
      hayalet sayac veya hic sayac kalmayabiliyordu.
- [ ] **K3-1 canli guncelleme.** Sayac calisirken bir olcum kaydedin,
      duzeltin ve silin: karttaki sayi her seferinde degismeli, sayacin
      BITISI degismemeli.
- [ ] **K3-2 izin matrisi (docs/plan-2.3.0.md 17.0).** En az iki senaryo:
      (a) bildirim REDDEDILDI + AlarmKit VERILDI -> alarm-modlu satirlar
      calmali, bildirim-modlu satirlar "Kurulmadi" rozeti almali;
      (b) AlarmKit reddedildi + bildirim verildi -> hepsi bildirim olarak
      gelmeli. Ana anahtari kapatinca ikisi de susmali.
- [ ] **K3-5 Health profil ayrimi.** Iki profille: p1'de Health yazmayi acin,
      p2'ye gecip olcum kaydedin - Apple Saglik'a YAZILMAMALI. p1'e donup
      kaydedin - yazilmali. Guncellemeden once cihaz-duzeyi anahtari acik olan
      bir kurulumda, ilk acilista aktif profile devrettigini dogrulayin.

### Kilit ekrani widget'lari (Kapsam 3, 25 Agu 2026)

- [ ] **Xcode: accessory ailelerinin hedefte derlendigini dogrula.**
      `targets/widget/index.swift` artik `.accessoryCircular` da destekliyor
      (`.accessoryInline` ve `.accessoryRectangular` zaten vardi). `npx expo
      prebuild` sonrasi widget extension hedefinin Deployment Target'inin
      **iOS 16.4** oldugunu ve uc accessory ailesinin de derlendigini kontrol
      edin. Circular ailesi iOS 16.0+; deployment target dusurulmemeli.
- [ ] **Widget galerisinde uc sekli de gor.** Kilit ekrani > Ozellestir >
      saatin altindaki alan: zerospike'in inline, rectangular ve circular
      seceneklerinin UCU de listede gorunmeli. Yalniz ikisi cikiyorsa
      supportedFamilies build'e girmemis demektir.
- [ ] **privacySensitive davranisini cihazda dogrula.** Kilitliyken glukoz
      degeri gri bloga donmeli, hatirlatici adi ve saati OKUNUR kalmali
      (docs/plan-2.3.0.md 16.4). Ayarlar > Face ID ve Parola > Hassas Icerigi
      Goster acikken deger de gorunur olmali.
- [ ] **Deep link'ler.** Uc ailede de karoya dokunun: calisan sayac tokluk
      olcum sayfasini, isimli hatirlatici Ayarlar > Hatirlaticilarim'i, olcum
      glukoz ekleme sayfasini acmali. `zerospike:///settings/reminders`
      rotasinin gercekten cozuldugunu ilk kez burada dogruluyoruz.
- [ ] **Eski snapshot dayanikliligi.** Guncellemeden ONCE eklenmis bir karonun
      guncelleme sonrasi (widget'i kaldirip yeniden eklemeden) cokmedigini
      dogrulayin.

- [ ] Xcode 26 derleme (native modul degisti, prebuild + build SART). Bu
      ortamda iOS 26 SDK yok, asagidaki iki ucus hic derlenmedi:
      (a) `Alarm.Schedule.fixed(Date)` ile tek seferlik alarm
      (`scheduleOneShotAlarm`, tokluk penceresinin bitisi). Derlenmezse modul
      `false` doner ve tokluk sayaci bildirim yoluna duser; markali Live
      Activity karti zaten her iki modda da ayakta, hicbir sey kaybolmaz.
      (b) K2-B alarm ekrani ikinci dugmesi:
      `AlarmPresentation.Alert(..., secondaryButton:secondaryButtonBehavior:)`,
      `AlarmManager.AlarmConfiguration(..., secondaryIntent:)` ve
      `ZerospikeAlarmOpenIntent`in `static var supportedModes: IntentModes =
      .foreground(.immediate)` satiri (iOS 26'da `openAppWhenRun` deprecated).
      Derlenmezse: bu uc noktayi cikarip alarmi yalniz "Durdur" ile birakin,
      geri kalan her sey calismaya devam eder (JS tarafinda okunmayan bir rota
      kalir, zararsiz).
      (c) `ZerospikeAlarmOpenIntent` HANGI hedefte derlenmeli? Su an
      modules/zerospike-alarmkit/ios altinda, yani ANA UYGULAMA hedefinde
      (expo modul kaynaklari oraya girer). AlarmKit'in `secondaryIntent`
      olarak verilen bir AppIntent'i alarm ekranindan calistirirken onu ana
      binary'de bulabildigini bu ortamda dogrulayamadim; Apple ornekleri
      intent'i widget/extension hedefinde tutuyor olabilir. Xcode'da: intent
      hedef uyeligi (Target Membership) ana uygulamada mi, alarm ekranindan
      "Ac"a basinca `perform()` gercekten kosuyor mu (App Group'a
      `zerospike.pendingAlarmRoute` yaziliyor mu) kontrol edin. Extension
      hedefine tasinmasi gerekirse dosya oldugu gibi tasinabilir: App Group
      sabitleri (`zerospikeAlarmAppGroup`) zaten widget hedefindeki
      LiveData.swift ile ayni.
- [ ] Cihaz QA: docs/plan-2.3.0.md bolum 10 (18 senaryo) + bolum 15.10
      (Kapsam 2, 19-28. senaryolar). Ozellikle: alarm modunda BIZIM kilit
      ekrani kartimiz gorunmeli, sistemin geri sayim karti HIC gorunmemeli
      (madde 19); alarm ekranindaki "Ac" dugmesi (madde 21, derlenmezse
      yukaridaki (b) sinirina duser); 180 dk ile baslatilan sayac Ayarlar'dan
      pencere degistirilince 180'de kalmali (madde 22).
- [ ] Alarm ekraninda UYGULAMA ADI: cihaz QA'sinda "com.greeneyeapp.zerospike"
      goruluyordu. Sebep, CFBundleLocalizations 9 dil ilan ederken uretilen
      .lproj/InfoPlist.strings dosyalarinda CFBundleDisplayName bulunmamasiydi;
      sistem yerellestirilmis adi bulamayinca bundle id'ye dusuyordu. 8
      ios-locales/*.json ve app.json'a "zerospike" olarak eklendi
      (i18n-check artik her dilde bu anahtari zorunlu tutuyor). PREBUILD +
      yeni build sonrasi dogrulanacak: alarm ekraninda, sistem Ayarlar >
      Bildirimler/Alarmlar listesinde ve ana ekranda ad "zerospike"
      gorunmeli - Turkce, Arapca ve Japonca cihazda ayrica bakin.
- [ ] Widget dokunma hedefi DEGISTI: iOS ana widget'inin (systemSmall/Medium)
      ve Android ana widget'inin koku artik uygulamayi acmak yerine glukoz
      ekleme formunu aciyor; Live Activity / Dynamic Island karti da tokluk
      olcum sheet'ini aciyor. Cihazda dogrulanmali (QA 25 ve 20).
- [x] KAPANDI (Kapsam 3, K3-4): taze kurulumun ALTER penceresi. createSchemaV1
      artik v19/v20/v21 kolonlarini ortak `missingColumns` korumasi arkasinda
      ekliyor (secenek (a)), yani yarida olen bir kurulum ikinci acilista
      "duplicate column name" ile patlamadan tamamlaniyor. Regresyon
      scripts/migration.test.ts bolum R ile pinlendi. Cihazda ek dogrulama
      gerekmiyor.
- [ ] Store: zerospike-store/aso/{9 dil}.md "What's New" + uzun aciklama
      guncellemeleri, google-play-extras/whats-new-2.3.0.md (9 dil, 500
      karakter altinda) ve review-notes-en.md (3994/4000) konsollara;
      app.json 2.3.0 / iOS build 61 / Android versionCode 58 (build henuz
      alinmadi, numaralar bilerek artirilmadi).
- [ ] 2.4.0 ADAYI (bu turda kod DEGISTIRILMEDI): Apple Saglik profil ayrimi
      tanimiyor. Health yazimi ve icgorulerdeki Apple Saglik karti
      cihaz-genelidir; coklu profil kullaniyorsaniz bir profilin verisi
      digerinin ekraninda gorunebilir. Duzeltmesi davranis + riza degisikligi
      gerektiriyor (hangi profilin verisi yaziliyor, kullanicidan yeniden
      onay), bu yuzden ayri bir tura birakildi. Bkz. docs/plan-2.3.0.md
      bolum 14.
- [ ] Store gorselleri: docs/store-screenshots-plan.md bolum 7 (09-reminders
      karesi "Siradaki" karti + rozetlerle yeniden, onboarding karesi artik
      tokluk suresi sormuyor). 9 dil.

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
