
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
- [ ] Android build oncesi not: android/app/src/main/res/values/styles.xml icine enforceNavigationBarContrast=false eklendi (alt saydam serit fixi). "expo prebuild --clean" calistirirsan bu satir silinir; ya patch'i geri uygula ya da "npx expo install react-native-edge-to-edge" ile plugin uzerinden kalicilastir
- [ ] git commit oncesi seed kontrolu: `git diff HEAD -- lib/db/seed.ts | grep '^-' | grep 'en:'` ciktisinda ESKI (562'lik) katalogdan silinen/yeniden adlandirilan bir `en:` adi GORUNMEMELI (top-up name_en ile eslesir; eski bir en adi degistiyse mevcut kullanicida o yemek cift gorunur). `Stuffed eggplant (olive oil)` satirinin silinmesi (c745277) top-up kopyasi uretmez, top-up yalniz eksik adlari INSERT eder, silinen bir adi asla fark etmez; ama 1.4.x kullanicilarinda iki imambayildi kaydi (Karniyarik + Imambayildi) zaten mevcut olabilir, bu satirin gecmisiyle ilgisizdir. Gingerbread rename'i ise RENAMED_EN haritasiyla (lib/db/seedVersion.ts) korunuyor
- [ ] git: tum degisiklikleri gozden gecirip commit et (surum 1.5.1, iOS build 41, Android versionCode 40)
