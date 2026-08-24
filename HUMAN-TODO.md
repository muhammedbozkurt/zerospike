
## 2.3.0 paketi sonrasi (23 Agu 2026) - INSAN

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
