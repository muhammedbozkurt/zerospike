# zerospike — Mağaza Görselleri (ÜRETİLDİ · TAM SET)

Bu klasör mağaza vitrini çıktılarıdır. **R10 UX-yenileme koşusunda tüm cihaz + tüm
diller yeniden üretildi** (Midnight-Monitor yeniden tasarım + enjeksiyon vücut haritası
yeniden çizimi + 4 UX düzeltmesi). Ham çekim → kompozit boru hattı:
`scratchpad/run_{iphone,ipad,android}.py` (simülatör/emülatör) →
`scratchpad/composite_v7.py` (cihazsız kompozit, headless Chrome) → `scratchpad/verify.py`.

## Üretilen matris

| Klasör | Ölçü | Diller | Durum |
|---|---|---|---|
| `iphone-1284x2778/<dil>/` | 1284×2778 (ASC 6.5") | tr en de es fr | ✅ 30/30 (verify ALL OK) |
| `ipad-2064x2752/<dil>/` | 2064×2752 (iPad 13") | tr en de es fr | ✅ 30/30 (verify ALL OK) |
| `android-phone/<dil>/` | 1080×1920 (Play telefon, 9:16) | tr en de es fr | ✅ 30/30 |
| `android-tablet10/<dil>/` | 1600×2560 (Play 10") | tr en de es fr | ✅ 30/30 |
| `android-tablet7/<dil>/` | 1080×1920 (Play 7") | tr en de es fr | ✅ 30/30 |
| `google-play-extras/<dil>/feature-graphic-1024x500.png` | 1024×500 | tr en de es fr | ✅ 5/5 |
| `google-play-extras/<dil>/store-icon-512.png` | 512×512 | tr en de es fr | ✅ 5/5 |

**Toplam: 150 ekran görüntüsü + 5 feature graphic + store icon.** Hepsi: doğru
piksel ölçüsü · alpha yok · kare başına tek dil (yabancı-dil sızıntısı yok) · iddia
dili yok · "insulin calculator" yok · gerçek UI.

> **FAZ F:** Kanonik iPhone ölçüsü **1284×2778** (ASC slotu 1320×2868'i kabul etmedi).
> Konsol 6.9" kabul ederse `composite_v7.py` DEV["iphone"] tek satırla değiştirilip
> yeniden üretilir.

Kontakt sayfaları: `_PREVIEW-<cihaz>-<dil>.png` (her cihaz + her dil).
ASO metinleri: `aso/<dil>.md`.

## Bu koşuda yapılan düzeltmeler (kod + görsel)
1. **Enjeksiyon vücut haritası tamamen yeniden çizildi** — üniseks silüet, anatomik
   ısı-bölgeleri (göbek yatay 4+4, uyluk/kol dikey, kalça arka), noktalar + modal +
   dikey ısı-legend; responsive SVG (`components/InjectionBodyMap.tsx`).
2. **4 UX düzeltmesi:** dashboard "+ Kayıt Ekle" scrim'i kaldırıldı · modal header'ları
   kısaltıldı · ayarlar altına logo+sürüm · enjeksiyon "?" butonu geri geldi.
3. **03 widget** artık **7 günlük ORTALAMA** glukoz gösteriyor (kod + görsel).
4. **Seed dil-zamanlaması bug'ı** — meals önceki dilde materyalize oluyordu (TR arayüz +
   FR yemek). `app/_layout.tsx` seed'i artık `scLang`'ı doğrudan okuyor; Android'de
   seed-marker poll'u ile senkron (`run_android.py`).
5. **Native değerlendirme penceresi** (StoreReview) screenshot modunda kapatıldı
   (`lib/services/review.ts`), aksi halde 05/02 karelerine düşüyordu.

## Kareler (dil başına 01..06)
| # | Dosya | Ekran |
|---|---|---|
| 1 | `01-ring` | Dashboard: glukoz halkası (112 hedefte) + tokluk sayacı + haftalık şerit + günlük akışı |
| 2 | `02-bodymap` | Enjeksiyon vücut ısı haritası (yeni üniseks silüet + bölge rotasyonu) |
| 3 | `03-widget` | Kilit ekranı sahnesi — 7 günlük ortalama glukoz widget'ı |
| 4 | `04-food` | Yemek: karb hero + öğünler + 562 besin |
| 5 | `05-insights` | Insights: TIR + AGP + özel aralık |
| 6 | `06-report` | Doktor raporu (kapak önde + zaman çizelgesi arkada) |

## Mağaza dil eşlemesi
**App Store Connect:** tr → tr + en-GB · en → en-US + en-GB · de → de-DE · es → es-ES + es-MX · fr → fr-FR + fr-CA
**Play Console:** tr-TR, en-US, en-GB, de-DE, es-ES, es-419, fr-FR, fr-CA

## HUMAN kalanlar
- **Yükleme (tek kalan iş):** iphone-1284x2778 + ipad-2064x2752 → App Store Connect;
  android-phone + android-tablet7 + android-tablet10 + feature graphic + store icon →
  Play Console (yukarıdaki locale eşlemesi).
- Kod değişiklikleri (madde 1–5) commit edilmeyi bekliyor (çalışma ağacında).
- FAZ H (Apple Sağlık'a yazma): kod tamam + gate yeşil; gerçek cihaz doğrulaması HUMAN.
