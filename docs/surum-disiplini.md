# Surum disiplini

- Tek dal: main. Ozellik isi ajan worktree'lerinde yapilir, kapi komutlari (typecheck, i18n:check, theme:lint) gectikten sonra main'e merge edilir.
- Tek build: iOS ve Android AYNI numara (app.json ios.buildNumber ile android.versionCode ayni). Numara ayri artirilmaz.
- Build numarasi commit'i: build bittikten sonra app.json'daki guncel numara "chore: build N numaralari (iOS N, Android N)" olarak commit edilir. Sonraki build, eas.json production autoIncrement ile N+1 uretir; app.json'daki N son uretilen numaradir. Guncel durum: son build 96 (2.4.1, iOS buildNumber 96, Android versionCode 96); 2.5.0 ilk build'i autoIncrement ile 97 olur. Eski F11 notundaki build 94/95 gecersizdir.
- Build komutlari yerelde kullanicidadir (EAS bulut build yok, build 89 sonrasi); ajan build baslatmaz.
- Surum adi: app.json expo.version ana kaynaktir; iOS CFBundleShortVersionString ve Android versionName ondan gelir. Build'den once app.json surumu hedef surume (2.5.0) getirilir. Magaza surumu (ASC "version") ve Play surum adi ayni deger.
- App Store yukleme sirasi: (1) ASC'de yeni surumu olustur, (2) islenmis build'i sec, (3) metin ve kareler script ile yuklenir (fastlane ios metadata_upload veya scratchpad/g3b93-asc-up.sh deseni), (4) App Review notu yapistirilir ve 4000 karakter sinirinda sayilir (python len), (5) inceleme gonderimi en son.
- Play: production taslagi olustur, 14 yerel icin surum notlari (zerospike-store/google-play-extras/whats-new-<surum>.md, yerel basina 500 karakter), AAB'yi once internal'a yukle ve dene. Production'a cikis Play saglik veri beyani onayina baglidir (CLAUDE.md). Wear AAB ayri modulden uretilir.
- "Gonder" kurali: incelemeye gonder, production'a yayinla, rollout baslat YALNIZ kullanici komutuyla; ajanlar taslak ve yukleme ile durur.
- Sir kurali: RC anahtari, Supabase sirlari, ASC/Play kimlikleri chat, log ve dosyaya degerleriyle yazilmaz; yalniz ad ve yol anilir. Sirlar ~/.supabase/zerospike.secrets.env, ~/.revenuecat, ~/.appstoreconnect icinde kalir.
- Her yeni string 9 dilde; kopyada regulasyon taramasi (npm run reg:check) temiz olmadan yukleme yapilmaz.
- Surum sonrasi okuma dogrulamalari (salt okuma): ASC'de surum durumu, build numarasi ve 14 yerel metin/kare sayisi; fiyat ve deneme (node scratchpad/ads/data/asc-prices.mjs); RC offering (node scratchpad/p5/rc-offerings.mjs); Play'de yerel metinler, surum notlari, track durumu ve izin/veri guvenligi beyani; Supabase fonksiyon surumleri (supabase functions list --project-ref jcpepqectdubbmchhdsn) ve duman testi.
