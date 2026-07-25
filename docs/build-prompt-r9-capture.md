# R9 CAPTURE PROMPT: Magaza Gorsellerinin Uretimi (cekim + kompozit)

Kod hazir (R8/R8.1 denetimden gecti). Bu oturum SADECE uretim yapar: simulatorleri KENDIN acar, ham kareleri ceker, hypershots ile kompoziti uretirsin. Baglayici ekler: `docs/store-screenshots-plan.md` (olculer, kare senaryosu, sablon spec, yasak dil) ve `zerospike-store/OKU-BENI.md` (cikti matrisi + magaza dil eslemesi). Kod DEGISTIRME; bir kusur bulursan once raporla.

## KRITIK KURALLAR
- Kare basliklarinda iddia dili yok; "insulin calculator" hicbir metinde gecmez; kareler gercek UI (plan bolum 2 tablosundaki basliklar esas).
- PROVA KAPISI: tam seti uretmeden once en dilinde 01-ring kompozitini uret, KULLANICIYA GOSTER ve ONAY BEKLE. Onay gelmeden devam etme.
- app.json ve uygulama koduna dokunma. Cikti yalnizca raw/ ve zerospike-store/ altina yazilir. raw/ klasorunu .gitignore'a ekle (tek satirlik istisna, kod degisikligi sayilmaz).

## FAZ 1: iOS CEKIM (kendi kendine)
1. Simulator hazirla: `xcrun simctl list devices available` ile "iPhone 16 Pro Max" bul (yoksa en yeni Pro Max). `xcrun simctl boot "<isim>"` + `open -a Simulator`.
2. Build: `EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo run:ios --device "<isim>"` (uzun surer, arka planda izle; Metro'nun ayakta kalmasi gerekir).
3. Uygulama acilinca seed'in calistigini dogrula: dashboard'da halka 112 + aktif tokluk sayaci + streak 12 gorunmeli. Gorunmuyorsa DUR, raporla.
4. `./scripts/store-shots.sh ios` calistir: iPhone kareleri raw/'a duser; script iPad icin durdugunda iPhone sim'i kapat (`xcrun simctl shutdown`), "iPad Pro 13-inch" boot et, ayni env ile `npx expo run:ios --device "iPad..."` kur, sonra Enter ile devam et.
5. Cikti kontrolu: raw/iphone/<5 dil>/ ve raw/ipad/<5 dil>/ altinda 01,02,04,05,06 kareleri (03-widget kompozitte uretilir; Live Activity cekilebiliyorsa kilit ekrani goruntusunu de al: sayac kuruluyken sim'de Cmd+L kilit ekrani + screenshot).

## FAZ 2: ANDROID CEKIM
1. `emulator -list-avds` ile mevcut AVD'yi bul; yoksa KULLANICIYA sor (AVD kurulumu HUMAN). Boot et, `adb wait-for-device`.
2. `EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo run:android`.
3. `./scripts/store-shots.sh android` -> raw/android/<dil>/.

## FAZ 3: KOMPOZIT (hypershots)
1. `npx skills add hypersocialinc/hypershots` kur ve skill'i yukle.
2. Sablonu plan bolum 3 spec'ine gore uyarla: sicak krem zemin, sol ustte iri baslik + alt yazi (iki satir alani), 2-4 derece egik cihaz cercevesi, kare basina en fazla 2-3 sakin eleman (glukoz cipi, sayac cipi, emoji karo), accent #2ee6ff yalniz vurgu. Basliklar plan bolum 2 tablosu (EN/TR hazir; de/es/fr ayni notr kalip, uzunluk icin iki satir).
3. PROVA: en/01-ring tek kare -> kullaniciya goster -> ONAY BEKLE.
4. Onay sonrasi tum set: 5 dil x 6 kare x (iphone-1320x2868, ipad-2064x2752, android-phone 1080x1920, android-tablet7, android-tablet10). 03-widget karesi: kilit ekrani Live Activity + ana ekran widget'i kompozit mockup'i (raw kilit ekrani cekimi varsa onu kullan).
5. Feature graphic (1024x500, cihazsiz, koyu zemin + halka motifi + logo + tek satir slogan, dil basina) + store-icon-512 -> google-play-extras/<dil>/.

## FAZ 4: DOGRULAMA + TESLIM
- Her cikti: tam piksel olcusu (sips ile dogrula), Android 9:16, alpha yok, kare basina tek dil, metin guvenli bolgede. Ihlal varsa o kareyi yeniden uret.
- zerospike-store/ matrisini OKU-BENI.md'ye gore doldur; eksik hucre kalmadigini tablo halinde raporla (5 dil x 6 kare x 5 cihaz sinifi + extras).
- Teslim raporu: cekim matrisi, prova onay kaydi, dogrulama ciktisi, App Store Connect / Play Console yukleme adimlari ozeti (dil eslemesi OKU-BENI'de). Yukleme HUMAN.
