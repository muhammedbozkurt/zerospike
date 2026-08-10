
## Redesign: store oncesi kaldir
- [x] app/design-gallery.tsx SIL (dev-only tasarim galerisi)
- [x] app/_layout.tsx DEV_SCREENSHOT_ROUTE kancasini SIL (null-gated ama kalmasin)

## 1.6.0 gece paketi sonrasi (2 Agu 2026)
- [ ] Xcode: widget hedefini derle (QuickAdd/index/PostMealActivity Swift redesign edildi) ve cihazda widget + Dynamic Island QA
- [ ] Temiz kurulumda onboarding QA: splash sonrasi DOGRUDAN onboarding gelmeli, bildirim izni butonu sistem promptunu acmali (simulatorde de)
- [ ] Gercek cihazda Apple Health QA: yazma anahtari acikken ekle/duzenle/sil akisinin Health'e yansimasi
- [ ] Android build oncesi not: android/app/src/main/res/values/styles.xml icine enforceNavigationBarContrast=false eklendi (alt saydam serit fixi). "expo prebuild --clean" calistirirsan bu satir silinir; ya patch'i geri uygula ya da "npx expo install react-native-edge-to-edge" ile plugin uzerinden kalicilastir
- [ ] git commit oncesi seed kontrolu: `git diff HEAD -- lib/db/seed.ts | grep '^-' | grep 'en:'` ciktisinda ESKI (562'lik) katalogdan silinen/yeniden adlandirilan bir `en:` adi GORUNMEMELI (top-up name_en ile eslesir; eski bir en adi degistiyse mevcut kullanicida o yemek cift gorunur). Yalniz `Stuffed eggplant (olive oil)` satirinin silinmesi normaldir (bu geceki kopya temizligi, yeni eklenen kayitti)
- [ ] git: tum degisiklikleri gozden gecirip commit et (surum 1.5.1, iOS build 41, Android versionCode 40)
