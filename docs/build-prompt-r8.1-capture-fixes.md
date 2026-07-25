# R8.1 FIX PROMPT: Cekim Oncesi 5 Kucuk Duzeltme

R8 denetiminden cikan, magaza cekimini bozacak kusurlar. Kucuk tur; sirayla yap, gateler (`npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts`) temiz bitir.

## 1. Seed streak anlatisi bozuk (12 yerine ~30 cikiyor)
`lib/db/screenshotSeed.ts:132`: enjeksiyon dongusu `daysAgo=(n*3)%26` n=4 ve n=30'da 12'ye denk geliyor; glukoz boslugu birakilan gunu (12 gun once) enjeksiyonla kapatiyor. Dashboard streak'i TUM journal girislerinden hesapliyor (`index.tsx:284`), yani streak ~30 gorunuyor.
Fix: enjeksiyon gun dagilimini 12. gunu ASLA uretmeyecek sekilde kur (orn. hesaplanan daysAgo 12 ise 13'e kaydir). Yemek kayitlarinin da 12. gune dusmedigini dogrula. Beklenen: streak = 12.

## 2. Seed sonrasi Pro gorunmuyor (05-insights karesi paywall blur cikar)
`setProOverride(true)` PRO_KEY yaziyor ama `AppContext.isProUser` yalniz bootstrap ve `refreshPro()`'da okunuyor; seed sonrasi `bumpData()` bunu tetiklemiyor. Ayni oturumda insights Pro kilitli kalir.
Fix: seed tamamlandiktan sonra AppContext'in Pro durumunu tazele: en temizi `_layout.tsx`'teki seed cagrisindan sonra context'in `refreshPro()`'sunu cagirmak (fonksiyonu context value'dan al veya seed-done callback'i ekle). Alternatif kabul: screenshot modunda `isPro()` sonucunu bootstrap disinda da okuyan kucuk bir focus/effect. Kanit: seed'li ayni oturumda insights ekrani Pro icerigi gosterir.

## 3. Ozel aralik aktifken trend grafigi ekseni yanlis
- `TrendChart` span'i `windowDays` ile olcekliyor (`app/insights.tsx:677`, `components/charts/TrendChart.tsx:58-60`) ama veri `range` bazli; 21 gunluk ozel aralik + windowDays=30 -> noktalar grafigin %69'unu dolduruyor, son nokta sag kenara ulasmiyor.
- Eksen etiketleri de windowDays/bugun bazli (`insights.tsx:310-315`, `endLabel=common.today` `:681`) - gecmiste biten ozel aralikta yanlis.
Fix: aktif aralik varsa TrendChart'a `rangeWindowDays(range)` gecir; baslangic/bitis etiketlerini araligin gercek uclarindan uret (bitis bugunse "Bugun", degilse tarih). Health ozeti karti (`readHealthSummary(windowDays)` `:232`) ozel aralikta ya araligi kullansin ya da ozel aralik aktifken gizlensin (basit olani gizlemek; notr bir cizgiyle).

## 4. Kozmetik seed duzeltmesi
`screenshotSeed.ts:107`: bugunku 18:00'deki 112 okumasi `PERIODS[3]` ile "bedtime" etiketleniyor; "post_meal_2h" yap (kare anlatisiyla uyumlu: tokluk olcumu hedefte).

## 5. store-shots.sh iPad sirasi
Script iphone cekiminden hemen sonra `capture_for_device "ipad"` cagiriyor; insana "iPad'i boot et" demeden ayni booted sim'e cekiyor. Fix: iPad pass'inden once betik `read -p "iPad Pro 13 simulatorunu boot edip Enter'a bas"` ile dursun (veya `--device` parametresiyle hedef sim UDID'i alsin). Yanlis cihazdan iPad karesi uretilmesi engellensin.

## Teslim
Kisa rapor: 5 maddenin kaniti (streak=12 nasil dogrulandi, ayni oturumda Pro'nun gorundugu, trend ekseninin 21 gunluk aralikta tam genislik ciktigi) + gate ciktilari.
