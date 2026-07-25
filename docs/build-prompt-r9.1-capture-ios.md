# R9.1 CAPTURE PROMPT: iOS-ONLY Magaza Gorselleri (iPhone + iPad, Android IPTAL)

Onceki capture oturumu durduruldu; kapsam degisti. Bu oturum SADECE iOS uretir: iPhone + iPad simulatorleri. ANDROID TAMAMEN KAPSAM DISI: emulator baslatma, adb, Play klasorleri, feature graphic, tablet setleri bu turda YOK (ileriye ertelendi). Baslarken calisan bir Android emulatoru varsa kapat; raw/android varsa dokunma, uretme.

Baglayici ekler: `docs/store-screenshots-plan.md` (kare senaryosu bolum 2, sablon spec bolum 3, yasak dil) ve `zerospike-store/OKU-BENI.md`. Kod DEGISTIRME (tek istisna asagida Faz 2'de belirtilen .gitignore benzeri onceden izinli notlar zaten yapildi). Kusur bulursan once raporla.

## ONEMLI TASARIM KARARI (kullanicidan)
Final kompozitlerde CIHAZ CERCEVESI CIZILMEYECEK ve status bar (saat, pil, sinyal) ile cihazin kendi centigi GORUNMEYECEK. Yani:
- `simctl status_bar` override'i ile ugrasma; gereksiz.
- Ham cekimler tam ekran alinir; kompozit asamasinda ekran goruntusunun UST KISMI (status bar + dynamic island bolgesi) kirpilir, icerik cerceve cizimi OLMADAN (veya sadece ince yuvarlak-kose maskesiyle) yerlestirilir. hypershots sablonunda cihaz mockup cercevesi kullanma; kirpik UI panelin icine dogrudan oturur (padscanner'daki cihazli kompozisyon yerine cihazsiz, kirpilmis-ekran varyanti).
- Alt home-indicator serifi de kirpilir.

## FAZ 0: RUNTIME ONARIMI (emoji tofu engeli)
Mevcut iOS 26.3.1 runtime'i emoji render EDEMIYOR (dogrulandi: taze cihazda bile Safari emoji testi tofu basiyor; font dosyasi diskte var ama runtime yukleyemiyor, volume sealed). Tek cozum runtime'i yenilemek:
1. `xcrun simctl runtime delete F25D6339-729E-49F8-A246-FCDC23677636`
2. `xcodebuild -downloadPlatform iOS` (birkac GB, 15-40 dk; arka planda calistir, kullaniciya baslattigini soyle)
3. Indirme bitince dogrulama ZORUNLU: bir iPhone sim boot et, kucuk bir lokal HTML sayfasiyla (meta charset=utf-8 + birkac emoji) Safari'de emoji testini tekrarla, ekran goruntusunu kontrol et. Emoji renkli cikmadan Faz 1'e GECME; cikmiyorsa durup raporla.

## FAZ 1: iPHONE CEKIMI
1. iPhone 17 Pro Max (veya 16 Pro Max; 6.9", 1320x2868) cihazini boot et (runtime yenilendigi icin cihazlari yeniden olusturman gerekebilir: `xcrun simctl create`).
2. `EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo run:ios --device "<isim>"` ile kur.
3. Uygulama temiz kurulumda ONBOARDING'de acilir (seed profil doldurur, profil YARATMAZ). Onboarding'i tamamla (cliclick ile surebilirsin; dil adiminda TR birak, insulin=Evet yolu, hedef adimi default degerlerle). Sonra seed dogrulamasi: dashboard'da halka 112 + aktif tokluk sayaci + streak 12 + emoji'li ogun satirlari RENKLI. CGM/Health toggle'ina DOKUNMA (kapali kalacak; acilirsa bayat 126 import sorunu doner).
4. "Acilsin mi?" deep-link dialogu ilk seferde cikar; cliclick ile "Ac" gecilebilir.
5. `./scripts/store-shots.sh ios` calistir: 5 dil (tr,en,de,es,fr) x kareler (01-ring, 02-bodymap zoom acik, 04-food, 05-insights ozel aralik, 06-report) raw/iphone/<dil>/ altina. Live Activity cekilebiliyorsa (sayac kuruluyken kilit ekrani) raw'a ekle (03 icin malzeme).
6. Script iPad icin durdugunda iPhone'u kapat.

## FAZ 2: iPAD CEKIMI
1. iPad Pro 13-inch boot et (2064x2752), ayni env ile `npx expo run:ios --device "iPad..."` kur, onboarding + seed dogrulamasi ayni.
2. Script'in iPad pass'i ile 5 dil cek -> raw/ipad/<dil>/.
3. iPad kareleri GERCEK iPad cekimi olmali (telefon esnetme yasak; zaten ayri cekiyorsun).

## FAZ 3: KOMPOZIT (hypershots, cihazsiz varyant)
1. hypershots kurulu; sablonu su spec'e uyarla: sicak krem zemin, sol ustte iri baslik + alt yazi (iki satir alani; basliklar plan bolum 2 tablosu, de/es/fr ayni notr kalip), 2-4 derece hafif egik KIRPILMIS EKRAN PANELI (status bar + home indicator kirpik, ince yuvarlak kose + yumusak golge, cihaz cercevesi YOK), kare basina en fazla 2-3 sakin yuzen eleman (glukoz cipi, sayac cipi, emoji karo), accent #2ee6ff yalniz vurgu.
2. 03-widget karesi: kilit ekrani Live Activity gorseli (raw varsa onu kirp; yoksa ayni krem zeminde sayac cipi + kilit ekrani stilinde kompakt mockup paneli, gercek UI metinleriyle).
3. PROVA KAPISI: en/01-ring tek kare uret, KULLANICIYA GOSTER, ONAY BEKLE. Onaysiz tam set uretme.
4. Onay sonrasi tam set: 5 dil x 6 kare x (iphone-1320x2868, ipad-2064x2752). Cikti `zerospike-store/` altina; Android/Play klasorleri URETILMEZ.

## FAZ 4: DOGRULAMA + TESLIM
- Her cikti: tam piksel olcusu (sips), alpha yok, kare basina tek dil, metin guvenli bolgede, status bar/pil/saat HICBIR karede gorunmuyor.
- Eksiksizlik tablosu: 5 dil x 6 kare x 2 cihaz sinifi = 60 dosya.
- Teslim raporu: cekim matrisi, prova onay kaydi, dogrulama ciktisi, App Store Connect yukleme adimi ozeti (dil eslemesi OKU-BENI'de: tr + en-GB, en-US + en-GB, de-DE, es-ES + es-MX, fr-FR + fr-CA). Yukleme HUMAN. Android/Play setinin bilincli ertelendigini rapora yaz.
