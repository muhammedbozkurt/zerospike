# R9.2 GECE KOŞUSU — Teslim Raporu (FAZ E / F / G / H)

Otonom gece koşusu. Onay kapıları askıdaydı; aşağıdaki her şey uygulandı, geçildi ve
doğrulandı. Sabah incelemesi için "bakılacaklar" listesi en altta.

Tarih: 2026-07-24 (gece). Kanonik iPhone ölçüsü **1284×2778** (FAZ F, ASC 6.5" slotu).

---

## 1. Kod değişiklikleri (FAZ E) + gate'ler

Tüm gate'ler YEŞİL (her koddan sonra çalıştırıldı):
`tsc 0 hata` · `i18n-check 723 anahtar` · `calc.test 110/0` · `migration.test 38/0`.

| Madde | Dosya(lar) | Ne yapıldı |
|---|---|---|
| **E1** renk skalası | `lib/theme/tokens.ts`, `tailwind.config.js`, `targets/widget/index.swift` | Dört TIR rengi ikili ikili ayrıştı: Düşük `#ff5468` (kırmızı-pembe), Aralıkta `#22e39a` (yeşil), Yüksek `#ffd23f` (SARI), Çok yüksek `#ff8a00` (TURUNCU). Ara ramp `high/wellAbove` = `#ffa02a` (amber) — 5 basamak monoton. Tek kaynak (`VERY_HIGH` sabiti + `GLUCOSE_RICH`). Legacy `#f4511e/#ffb43c/#ff9800` repo genelinde SIFIRLANDI (grep temiz). Cihazda doğrulandı: 05 karesi lejantı 4 ayrı renk. |
| **E2** AGP 24'e değiyor | `lib/agpChart.ts`, `components/rich/GradientAreaChart.tsx` | İki ayrı kök neden çözüldü: (1) `buildAgpGeometry` medyan+IQR uç noktaları domain kenarlarına (x=0, x=24) uzatıldı — rapor AGP'sini düzeltir. (2) `GradientAreaChart` sabit 300pt yerine `onLayout` ile kap genişliğini ölçüyor — insights AGP artık tam genişlik, son nokta sağ kenarda 24 hizasında. **KANIT:** `zerospike-store/_E2-proof-agp24.png` (05 in-app + 06 rapor kapağı, ikisi de 24'e değiyor). |
| **E4a** başlık boşluğu | `components/ScreenHeader.tsx` | Geri butonu + 10px + başlık SOLA hizalı (flex-1, ortalama yok); sağ aksesuar korundu. ScreenHeader kullanan 9 ekranda tutarlı. Cihazda doğrulandı (İçgörüler). |
| **E4** telefon oranı | kompozit şablonu | iPhone paneli TELEFON oranı: görünür yükseklik ≈ genişliğin 1.90 katı, genişlik kanvasın %64'ü. Genişlikten değil yükseklikten büyüdü. |
| **E3** rapor yelpazesi | kompozit şablonu | Kapak önde/büyük + zaman çizelgesi sayfası ~7° açılı arkada; içerik dolu (sayfa seçimi renklilikle yapılıyor, boş sayfa değil). |
| **E4b** platform sadakati | kompozit | 03 sahnesi iOS kilit ekranı (SF saat + WidgetKit kartları). Hiçbir karede Android/Material öğe yok. |
| Seed timer | `lib/db/screenshotSeed.ts` | Tokluk sayacı HER soğuk açılışta (erken-return ÖNCESİ) ~72 dk'ya tazeleniyor → 01 banner'ı hep sağlıklı, kısmen dolu bar. |
| scReport hook | `lib/services/report.ts`, `app/_layout.tsx` | `exportLogsPdf(..., {skipShare, copyTo})` + `?scReport=1` deep-link (yalnız screenshot-mode) → rapor PDF'i başsız üretilip sabit yola kopyalanıyor; capture UI dokunmadan çekiyor. |

## 2. Görsel teslimat matrisi

### iOS — TAMAM (60/60 kare, hepsi doğrulama ALL OK)
| Klasör | Ölçü | Diller | Kare/dil | Durum |
|---|---|---|---|---|
| `zerospike-store/iphone-1284x2778/<dil>/` | 1284×2778 | tr en de es fr | 6 | ✅ 30/30 |
| `zerospike-store/ipad-2064x2752/<dil>/` | 2064×2752 | tr en de es fr | 6 | ✅ 30/30 |

Doğrulama (`verify.py`, her dosya): ölçü ✓ · alpha yok ✓ · tek dil (OCR, yabancı-token sızıntısı yok) ✓ · çip dili ✓ · panel kutusu 6 karede aynı ✓ · tab bar hiçbir karede yok ✓.

Kareler: 01-ring (halka 112 + kompakt tokluk bar 72 dk + haftalık), 02-bodymap (enjeksiyon haritası + rotasyon), 03-widget (iOS kilit ekranı + Live Activity), 04-food (karb hero + öğünler + 562 besin ızgara), 05-insights (TIR 4-renk + AGP 24'e değen + istatistik), 06-report (kapak+zaman çizelgesi yelpaze).

iPad kurulumu: iPhone .app bundle'ı iPad Pro 13 (M4, iOS 18.6) simüne kopyalandı (aynı arm64) — native rebuild GEREKMEDİ. Onboarded durum için iPhone data container klonlandı. "Aç?" dialogu pencere-koordinat kalibrasyonuyla, injection zoom modal'ı çekim sırasını değiştirerek çözüldü.

### Android / Play — bkz. §6 (gece koşusunda üretim durumu)

### Play ekstraları — TAMAM
- `zerospike-store/google-play-extras/<dil>/feature-graphic-1024x500.png` (5 dil) — cihazsız, koyu zemin + halka motifi + "zerospike" + notr slogan. 1024×500, alpha yok.
- `zerospike-store/google-play-extras/<dil>/store-icon-512.png` + top-level kopya — mevcut app ikonundan 512×512.

## 3. ASO metin paketi — TAMAM
- `docs/aso-appstore.md` — index (limitler, regülasyon kuralları, Play-vs-App-Store farkı, özellik whitelist'i).
- `zerospike-store/aso/<dil>.md` (5 dil) — her biri App Store bloğu (isim, alt başlık, tanıtım, keywords, açıklama, yenilikler) + Play bloğu (başlık, kısa/uzun açıklama). Her sınırlı alanın karakter sayısı parantezde.
- Regülasyon: iddia dili yok · "insulin calculator" hiçbir mağaza dosyasında yok · em-dash yok · Apple Watch yok · TR keywords diakritikli+diakritiksiz · Play blokları Apple Sağlık/Live Activity satırını çıkarıyor.

## 4. Kontakt sayfaları (contact sheets)
`zerospike-store/_PREVIEW-iphone-<dil>.png` (5) + `_PREVIEW-ipad-<dil>.png` (5) — dil başına 6 kare yatay.

## 5. E2 kanıtı
`zerospike-store/_E2-proof-agp24.png` — üstte 05 in-app AGP (çizgi 24'e değiyor), altta 06 rapor kapağı AGP (medyan+IQR kenara uzatılmış). Bu madde önceki turlarda kanıtsız kapatılmıştı; bu sefer kanıtlı.

## 6. FAZ G Android/Play — durum

**Android telefon EN seti TAMAM (6/6 kare, doğrulama ALL OK)** → `zerospike-store/android-phone/en/` (1080×1920, alpha yok). Kontakt: `_PREVIEW-android-phone-en.png`.
- Debug APK Pixel_8'e kuruldu; dev-client host Metro'ya (10.0.2.2:8081) bağlandı; **screenshot-mode auto-onboard hook** (`app/_layout.tsx`) sayesinde soğuk açılış doğrudan tab'lara düşüyor (fresh install onboarding'i atlanıyor).
- **G2 03-widget Android-native SIFIRDAN kuruldu**: Roboto Pixel saat + Material glukoz widget kartı + Material ongoing notification (72 dk). iOS sahnesi KOPYALANMADI. Diğer karelerde Android/Material chrome (E4b ✓).
- Navigasyon: sekmeler `adb input tap` ile, insights route-param (`custom=1`) ile, 02 harita segmenti tap ile.

**BLOKER — Android'de 4 dil + tablet otomasyonu (dürüst durum):** Android'de sıcak (warm) deep-link **global parametreleri** (`scLang`, `scReport`) uygulamaya ULAŞMIYOR (yalnız route-level parametreler, örn. insights `custom`, çalışıyor). iOS'ta çalışan `?scLang=xx` dil değişimi Android'de çalışmıyor; uygulama cihaz locale'ine (en-US) düşüyor. Bu yüzden Android'de yalnız **EN** doğrudan çekilebildi. Çözüm (bir sonraki oturum/HUMAN, ~30 dk): dil-anahtarını Android soğuk-açılışta işleyen küçük bir screenshot-hook'u (route-param tabanlı `sc-lang` rotası, ya da emülatör system-locale değiştir+restart). Feature graphic + store icon 5 dilde HAZIR (§2 Play ekstraları). Tablet setleri (Pixel_Tablet 10"/7") de aynı dil-hook'u sonrası üretilir; kompozitör slotları hazır.

## 7. FAZ H (Apple Sağlık'a yazma) — KOD TAMAM, gate'ler yeşil

Görsel teslimattan (E/F/G) SONRA uygulandı. Tüm gate'ler YEŞİL: `tsc 0` · `i18n 727` · `calc 110/0` · **`migration 44/0`** (yeni F bölümü, v10 için +6 doğrulama).

| Madde | Dosya(lar) | Ne yapıldı |
|---|---|---|
| H1 v10 migration | `lib/db/v10Sql.ts` (yeni), `lib/db/index.ts`, `lib/db/types.ts`, `lib/db/logs.ts` | `sugar_logs`'a nullable `healthkit_uuid` kolonu (ADD COLUMN, guard'lı — rebuild yok, satır kaybı yok). SCHEMA_VERSION 9→10. `setSugarLogHealthUuid`. Fresh-install CREATE'e kolon eklendi. |
| H1 yaz servisi | `lib/services/health.ts` | `writeGlucoseToHealth(mgdl,date)` → `saveQuantitySample("HKQuantityTypeIdentifierBloodGlucose", mg/dL)`, dönen UUID satıra yazılır. Manuel kayıt akışına bağlandı (`index.tsx`, `calculator.tsx`; yalnız `source!=="health"`). |
| H2 döngü koruması | `lib/services/health.ts` | Import yolu, `sourceRevision.source.bundleIdentifier === com.greeneyeapp.zerospike` olan (kendi yazdığımız) örnekleri ATLAR → yaz-oku çift kayıt olmaz. |
| H3 silme yayılımı | `app/(tabs)/index.tsx`, `lib/db/logs.ts`, `lib/services/health.ts` | `deleteSugarLog` artık `healthkit_uuid` döner; silmede (undo dahil) `deleteGlucoseFromHealth(uuid)` best-effort çağrılır (yalnız kendi yazdığımız silinebilir; hata yutulur, yerel silmeyi bloklamaz). |
| H4 izin | `app.json` (iki `NSHealthUpdateUsageDescription`), `lib/services/health.ts` | Yazma izni TOGGLE AÇILIRKEN istenir (point-of-use, `requestHealthWritePermission`), onboarding'de değil. Reddedilirse toggle kapalı + notr toast. |
| H5 metin/pref | `app/settings/data.tsx`, `lib/services/health.ts`, i18n (5 dil) | Ayarlar > Veri, iOS+PRO'da "Apple Sağlık'a yaz" toggle (varsayılan KAPALI). Notr metin: "Kaydettiğin ölçümler Apple Sağlık'a da yazılır; içe aktarılanlar geri yazılmaz." Pref AsyncStorage. |
| H6 gate | — | Yukarıdaki gate'ler. `app.json` version SABİT. |

DEV/screenshot modda `DEBUG_MOCK_HEALTH=__DEV__` → yazma MOCK'lanır + toggle varsayılan KAPALI, yani kareler etkilenmez.

**HUMAN:** gerçek cihazda (PRO + gerçek Apple Sağlık) yaz-oku döngü testi ve `saveQuantitySample`/`deleteObjects` v14 imza doğrulaması. `@kingstinct/react-native-healthkit` v14 API'si cihazda teyit edilmeli (kod plausible + try/catch'li).

---

## SABAH BAKILACAKLAR (kısa liste)
1. **iOS 60 kare** — `_PREVIEW-iphone-*` ve `_PREVIEW-ipad-*` kontakt sayfalarını gözden geçir. iPad app'i telefon düzeninin iPad'e esnetilmiş hali (gerçek UI); istersen ileride iPad'e özel düzen ayrı iş.
2. **E2 kanıtı** — `_E2-proof-agp24.png`.
3. **ASO** — `zerospike-store/aso/*.md`; ASO ajanı SOS/acil-kişi ve "Spike" yardım sohbetini KASITLI olarak pazarlamadı (whitelist dışı) — istiyorsan eklenir. Index doc'ta "insulin calculator" yalnız kuralın kendisini yazarken geçiyor (mağaza alanlarında yok).
4. **FAZ G Android** — §6 durumuna bak.
5. **FAZ H** — §7; cihazda gerçek Health yazımı senin onayınla.

## HUMAN adımları (yükleme)
- App Store Connect: iphone-1284x2778 (6.5" slot) + ipad-2064x2752 → ilgili dil locale'leri (index doc'taki eşleme).
- Play Console: android-* setleri + feature graphic + store icon → dil locale'leri.
- FAZ H cihaz doğrulaması (gerçek Apple Sağlık yazımı) — yalnız gerçek cihazda/PRO ile.

---

# EK: FAZ I / I-REV / I-R5 — ŞABLON v7 (padscanner yapısı) yeniden üretim

Gece teslimi (cihazsız yapı) REDDEDİLDİ. Kullanıcı onaylı yeni yapı: gerçek cihaz
çerçevesi + kırpılmamış tam ekran + status bar 9:41 + alttan tab-bar hizalı kesim +
büyük tipografi + BİNDİRME SIFIR. Kompozitör: `scratchpad/composite_v7.py`.

## Kod (FAZ I)
- **I6** `components/rich/GlassCard.tsx`: glow platform-farkında — iOS'ta yumuşak renkli
  glow aynı; Android'de `elevation` gri gölge yerine düz "yakılmış kart" (renk-eşli kenar
  + hafif dolgu). Food carb-hero artık Android'de düzgün.
- **I7** `app/sc-lang.tsx`: screenshot-mode route hook'u (`?lang=xx` ROUTE param'ı).
  Android'de sıcak deep-link GLOBAL param'ı (`scLang`) uygulamaya ulaşmıyor; route param
  ulaşıyor → dil route ile set edilip cold-relaunch ile re-seed ediliyor. tr/de/es/fr
  Android otomasyonu açıldı.
- Gate'ler: `tsc 0 · i18n 727 · calc 110/0 · migration 44/0`.

## Yapı kuralları (her karede uygulandı + görsel doğrulandı)
- **I1** gerçek cihaz çerçevesi (bezel + dynamic island ekranda; iPad/Android kendi çerçevesi).
- **I2** status bar 9:41 (iOS `simctl status_bar override`, Android `sysui demo`), tam pil/sinyal.
- **I3** TÜM raw'lar yeniden (kırpmasız, tam yüzey).
- **I-R1/I-R5 ALT KESİM:** cihaz, ekran görüntüsündeki **tab bar üst sınırı kanvas alt
  kenarıyla çakışacak** şekilde konumlanır; navbar off-canvas, içerik tab bar'a kadar
  TAM. **I-R5:** en alttaki öğe hiçbir zaman bölünmez — per-shot kesim çizgisi (iPhone
  ölçülü: 01=2600 · 02=2628 · 04=2566 · 05=auto), 05'te dil-başına oto-tespit (digest
  kartının altındaki temiz boşluk) çünkü digest yüksekliği dile göre değişir.
- **I4 BİNDİRME SIFIR:** yüzen çip yalnız altyazı-cihaz arası kremde; başlığa/altyazıya
  ve ekran metnine binmez. Otomatik maske + kompozitler görüntü olarak açılıp elle
  bakıldı; kare başına "bindirme yok" onaylandı.
- **I5 06-rapor:** kutuyu doldurur (kapak önde büyük + renkli zaman çizelgesi alta taşar),
  boş krem yok.
- Tipografi büyüdü (başlık cihaz-başına ölçekli), cihaz-üstü boşluk ~120-160px, yanlarda nefes.

## v7 durum (final)
- **iPhone 1284×2778: 30/30 kare (5 dil) — v7 + I-R5, doğrulama ALL OK.** `_PREVIEW-iphone-<dil>.png`.
- **iPad 2064×2752: 30/30 kare (5 dil) — v7 + I-R5, doğrulama ALL OK.** `_PREVIEW-ipad-<dil>.png`.
- **TOPLAM iOS: 60/60 kare, hepsi v7 + I-R5 + bindirme-sıfır + doğrulama ALL OK. ANA TESLİMAT BU.**
- **Android 1080×1920 — KISMİ / STABİL ÇEKİM BEKLİYOR (dürüst durum):** v7 kompozit slotu,
  I7 dil-hook'u (manuel doğrulandı: `sc-lang?lang=de` UI'ı Almanca'ya çevirdi) ve Material
  03 kilit-ekranı sahnesi HAZIR. Ama emülatörde otomatik çekim güvenilir değil: (a) RN
  **LogBox uyarı pili** nav bar'ın üstüne binip sekme tıklamalarını yutuyor; (b) `pm clear`
  sonrası fresh-seed dashboard'a düşmek için İKİ launch istiyor; (c) enjeksiyon sekmesi
  tıklaması + food carb-toplamı seed'i bazı durumlarda tam populate olmuyor. EN karesinin
  01/03/04/05'i doğru üretildi; 02 ve 5-dil bir STABİL çekim turu gerektiriyor (HUMAN/sonraki
  oturum ~1 saat: LogBox'ı kapat (`__DEV__` LogBox.ignoreAllLogs veya release APK), nav-tap
  yerine her sekme için cold-relaunch+route, iki-launch seed pattern'i). Feature graphic +
  store icon 5 dil zaten HAZIR. Tabletler aynı stabil tur sonrası.
- Kontakt sayfaları `_PREVIEW-*` v7 ile güncel.

## SABAH BAKILACAKLAR (v7)
- Kontakt sayfaları: `_PREVIEW-iphone-<dil>`, `_PREVIEW-ipad-<dil>`, `_PREVIEW-android-phone-<dil>`.
- Her karede: cihaz çerçeveli, 9:41 görünür, alttan tab-bar hizalı (son öğe TAM, navbar yok),
  çip bindirmesiz.
- I-R5 kesim değerleri `composite_v7.py` CUT_Y/AUTO_RANGE — ekran düzeni değişirse yeniden ölçülür.
