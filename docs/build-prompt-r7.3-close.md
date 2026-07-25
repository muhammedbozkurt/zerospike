# R7.3 BUILD PROMPT: UX Turunun Son Kapanisi (Settings hub + insights ozel cip + supurmeler + denetim duzeltmeleri)

R7.2 denetimden gecti. Bu tur UX turunun SON turu: kalan tek buyuk is (Settings hub) + kucuk kalanlar + denetimin buldugu 3 duzeltme. Bitince UX turu kapanir, commit ve magaza gorselleri oturumuna gecilir.

## 0. Kurallar (ayni)
- Notr regulasyon dili; yeni stringler 5 dil; em-dash yok; app.json surumu sabit.
- Gateler: `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts`.
- Kaliplar: Stepper, upper.ts, Intl format katmani, useUndoBatch, Tooltip.

## FAZ 1: SETTINGS HUB (dikkatli, alt-route basina gate)

1050 satirlik `app/(tabs)/settings.tsx` bes alt sayfaya bolunur. RISK YONETIMI: her alt sayfa tasindiktan sonra `npx tsc --noEmit` calistir; bir sayfa bitmeden digerine gecme. Davranis DEGISMEZ, kod tasinir.

- `app/settings/profile.tsx` — Profil ve Hedefler: profil secimi/duzenleme, glukoz birimi, insulin modu, hedef araliklari (RangeInput), hipo esigi, ISF, karb oranlari, gunluk karb araligi. persist/persistRange/persistRatio yardimcilari bu dosyaya tasinir veya ortak `lib/settingsActions.ts`'e cikarilir.
- `app/settings/notifications.tsx` — Bildirimler: izin durumu satiri, master toggle, tokluk gecikmesi, bazal/glukoz/haftalik zamanlayicilar, dusuk esigi, exact-alarm/kanal kartlari.
- `app/settings/data.tsx` — Veri ve Disa Aktarim: CSV/PDF (DateRangePicker dahil), Health senkron, ornek veri, tum verileri sil.
- `app/settings/app.tsx` — Uygulama: dil, Spike (giris + gunluk hak), Pro/abonelik, widget rehberi linki.
- `app/settings/about.tsx` — Hakkinda ve Yasal: kaynaklar, enjeksiyon rehberi, SOS/acil kisiler linkleri, gizlilik/kosullar, surum.
- Ana `settings.tsx` HUB olur: icon-plate 5 satir + inline iki ozet (bildirim izin durumu, Pro durumu). Mevcut inline ozetler korunur.
- Dis referans guncellemeleri: notifications.ts deep-link route'lari, paywall/downsell/winback yonlendirmeleri, QuickAdd, widget-guide linki, dashboard'daki ayara giden yollar. `grep -rn "\"/(tabs)/settings\"\|settings\." app lib` ile tum giren yollar dogrulanir.
- expo-router tip haritasi yenilendikten sonra `as Href` cast'leri kaldir (E.12; /widget-guide dahil).

## FAZ 2: INSIGHTS EKRANINDA OZEL ARALIK CIPI

- `app/insights.tsx` pencere secicisine "Ozel..." eklenir; DateRangePicker (mevcut bilesen) acilir; Pro'ya bagli (7 gun free korunur).
- Grafik fonksiyonlari (AGP, trend, saatlik, gunluk profil, TIR, istatistikler) DateRange ile calisacak sekilde threadlenmis olur; computeInsights zaten aralik aliyor, kalan 5+ grafik fonksiyonuna ayni aralik parametresi gecirilir. 7/30/90 kisayollari ayni yoldan.
- Basliktaki cip secili ozel araligi yerel formatta gosterir ("12 Haz - 3 Tem").

## FAZ 3: DENETIM DUZELTMELERI (R7.2 denetiminin bulgulari)

- 3.1 JournalItem "+N" cipi dokunulabilir DEGIL (rapor oyle iddia etmisti): TagBadges'a gercek davranis ekle: +N'e dokununca kucuk bir balon/sheet tum etiketleri gosterir (Tooltip kalibi kullanilabilir). Satirin edit handler'iyla cakismamasi icin +N Pressable'i event'i yutar.
- 3.2 Takip olcumu penceresi tutarsiz: rapor 25 dk (`report.ts:233`), dashboard dusuk-takip 15 dk. TEK kaynak: `lib/glucose.ts`'e `LOW_FOLLOWUP_MINUTES = 15` sabiti; hem dashboard hem rapor bunu kullanir. Rapor kolonu basligi da "15 dk icinde" der.
- 3.3 injection.tsx:537 yorumu "Single-line disclaimer" ama numberOfLines={2}: yorumu gercege uydur (iki satir kasitli, kucuk ekranda kirpilmasin diye).

## FAZ 4: KALAN SUPURMELER

- E.7: settings(profile alt sayfasi)/profile-setup/onboarding oran alanlari Stepper'a (carbRatio adim 0.5, ISF 1 mgdl / 0.1 mmol; mevcut InputRow yerine Stepper + klavye).
- E.8: returnKeyType="next" + onSubmitEditing ref zinciri: add-food, profile-setup, settings profil alt sayfasi.
- E.10: kalan sert kirpmalar (shrink'siz numberOfLines={1}): ProfileSwitcher.tsx:74, food.tsx:340 + 3 nokta, index.tsx:774, QuickAddSheet, ScreenHeader, insights.tsx:908. Politika: kullanici verisi 2 satir sarar; UI etiketi adjustsFontSizeToFit (minimumFontScale 0.85).

## TESLIM RAPORU
Faz faz + dosya listesi + davranis kaniti. Ozel olarak: hub'a giren TUM dis yollarin calistigi (grep listesiyle), her alt sayfanin tasindiktan sonraki tsc ciktisi, insights ozel araliginin PDF/CSV ile ayni sonucu verdigi bir ornek, +N dokunma davranisi, LOW_FOLLOWUP_MINUTES tek kaynagi, E.10 grep sonucu (shrink'siz tek satir kirpma = 0 kullanici-verisi noktasi), gate ciktilari.
