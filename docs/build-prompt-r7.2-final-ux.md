# R7.2 BUILD PROMPT: UX Turunun Kapanisi (ekran mimarisi + ozel aralik + rapor zaman cizelgesi + supurmeler)

R7 ve R7.1 teslim edildi ve denetimden gecti (harita/v9, rapor cekirdegi, toast/undo/deep-link, Intl, widget). Bu tur UX turunu KAPATIR: kalan buyuk yapisal isler + denetimin buldugu mikro duzeltmeler. Fazlari sirayla, tek oturumda; tek teslim raporu; "zaten boyle" gerekcesi yasak.

## 0. Kurallar (ayni)
- Notr regulasyon dili; yeni stringler 5 dil (tr/en/de/es/fr); em-dash yok; app.json surumu sabit.
- Gateler: `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts`.
- Mevcut kaliplar kullanilir: Stepper, RangeInput, lib/upper.ts, lib/format.ts (Intl), lib/db/undo.ts, yeni toast.

---

## FAZ 1: ENJEKSIYON EKRANI 3 SEGMENT (D.1)

`app/(tabs)/injection.tsx` tek scroll'dan (harita + rotasyon + form + 100 kayit gecmis) uc segmente:
- Ust segment kontrolu: KAYDET / HARITA / GECMIS (Segmented kalibi, upper.ts ile).
- KAYDET: form (site ozet cipi + doz Stepper + tur + not + etiketler + CTA) + mini harita onizleme (dokununca HARITA segmentine gecer, secili bolge korunur). Disclaimer tek satir burada.
- HARITA: tam boy InjectionBodyMap (on/arka toggle) + rotasyon karti + legend.
- GECMIS: FlatList sanal liste, gun basliklari (Bugun/Dun/tarih), JournalItem kompakt kalibi, 50'ser sayfalama.
- Segment gecisi state korur (secili site/nokta, form degerleri kaybolmaz).
- E.1'deki compose parametresi artik KAYDET segmentini acar + doz alanina odak (mevcut scroll cozumu segmente uyarlanir).
- Injection sekmesi silmeleri dashboard'daki BIRIKIMLI undo kalibina gecirilir (su an tekli; index.tsx:553-577 kalibi ortak yardimciya cikarilip ikisinde de kullanilir; food.tsx de ayni yardimciya baglanir).

## FAZ 2: GUNLUK AKIS SectionList (D.3)

Dashboard journal (`app/(tabs)/index.tsx`):
- SectionList: gun basliklari (Bugun / Dun / yerel tarih formati), 50'ser sayfalama (onEndReached ile devam), 300 sabiti kalkar.
- Filtre cipleri: Tumu / Glukoz / Yemek / Enjeksiyon (secim kalici degil, oturumluk).
- Etiketler tek satir + sigmayan "+N" cipi (dokununca kucuk detay balonu); flex-wrap ikinci satir biter.
- Bolum basligi sticky olmasin (koyu temada titrek gorunur); sade ustte etiket.

## FAZ 3: OZEL TARIH ARALIGI (C)

- Insights pencere secimine "Ozel..." eklenir: takvimli baslangic-bitis (InlineDateTimePicker kalibi uzerine kurulabilir), profil olusturma tarihinden bugune sinirli, Pro'ya bagli (7 gun free korunur).
- lib/insights.ts fonksiyonlari {start,end} araligiyla calisacak sekilde genellestirilir; 7/30/90 kisayollari ayni yoldan (geriye uyum: mevcut cagri imzalari kirilmaz, windowDays -> aralik cevirisi tek yerde).
- PDF ve CSV disa aktarim ayni secici ile; secilen aralik rapor kapaginda ve dosya adinda gorunur.
- Basliktaki cip "12 Haz - 3 Tem" gibi yerel formatta ozet gosterir.

## FAZ 4: RAPOR ZAMAN CIZELGESI + OLAYLAR (B kalan)

`lib/services/report.ts` mevcut cekirdegin (KPI + TIR bar + AGP) ustune iki bolum:
- GUNLUK ZAMAN CIZELGESI: her gun bir yatay bant, 00-24 ekseni; glukoz olcumleri renk kodlu nokta, yemekler karb etiketli kucuk ikon, dozlar damla ikonu; bant sonunda gun ozeti (ort + TIR). Sayfa basina ~10 gun, print CSS sayfa kirimi (`page-break-inside: avoid`).
- OLAYLAR: hipo olaylari listesi (tarih, deger, 15 dk icinde takip olcumu varsa), en yuksek 5 okuma, doz ozeti (gunluk ort, basal/bolus dagilim mini bar).
- Mikro duzeltme: TIR veryLow rengi sabit #b3243b yerine GLUCOSE tokenina baglanir (tokens'ta yoksa semantik isimle eklenir).
- Tum yeni metinler i18n, tarihler Intl (mevcut kalip).

## FAZ 5: SETTINGS HUB (D.2)

- Ana Settings HUB: Profil ve Hedefler / Bildirimler / Veri ve Disa Aktarim / Uygulama (dil, Spike, Pro, Widget rehberi) / Hakkinda ve Yasal. Her biri `app/settings/*.tsx` ayri route; icon-plate satirlar.
- Icerikler TASINIR, davranis degismez (izin durumu satiri, exact-alarm karti, Pro durumu dahil). Hub'da inline: bildirim durumu ozeti + Pro durumu.
- Tum dis referanslar guncellenir: notifications.ts deep-link route'lari, paywall/downsell yonlendirmeleri, QuickAdd/rehber linkleri. expo-router tip haritasi yenilendiginde /widget-guide dahil `as Href` cast'leri kaldirilir (E.12).

## FAZ 6: FORM METIN YOGUNLUGU (D.4)

- Ortak kucuk Tooltip bileseni ((i) ikonu, dokununca kisa balon).
- Injection KAYDET formu: aciklama cumleleri kaldirilir/tooltip'e iner; bir ekran boyuna sigar.
- Calculator: alt aciklama paragraflari tooltip'e; uyari kartlari tek satir ozet + acilir detay.
- add-food: ayni ilke.
- Kaldirilan her cumle icin karar: gereksizse SIL, regulasyon geregi ise tooltip'te KALIR (disclaimer'lar silinmez).

## FAZ 7: SUPURMELER (E kalanlari + denetim mikrolari)

- E.5: kalan 10 `fontSize: 9` -> 11: spike.tsx:246, androidWidget.ts:117, insights.tsx:393/473, emergency-contacts.tsx:509, index.tsx:670, food.tsx:294, Reveal.tsx:182/215/261. (report.ts SVG eksen yazilari haric, o PDF.)
- E.7: settings/profile-setup/onboarding oran alanlari (carbRatio 0.5 adim, ISF 1 mgdl / 0.1 mmol) Stepper'a.
- E.8: cok alanli formlarda returnKeyType="next" + ref zinciri (add-food, profile-setup, settings hedefler).
- E.9: kalan TUM uppercase noktalari lib/upper.ts'e; bitiste `grep -rn "textTransform.*uppercase\|className=.*uppercase" app components` yalnizca upper.ts kullanan sarmalayicilarda kalmali; sayimi raporla.
- E.10: tam kirpma supurmesi (FoodRow, StatCard, ui SegmentedStat, calculator yemek adlari, insights, ProfileSwitcher, ScreenHeader, profile-setup, emergency-contacts, sos): kullanici verisi 2 satir sarar, UI etiketi adjustsFontSizeToFit.
- E.11: ProfileSwitcher (15 Pressable) ve InjectionEditSheet ikon kontrollerine accessibilityLabel + role.
- Denetim mikrolari: `insights.ts:61` ve `injections.ts:195` bayat "eight sites" yorumlari 12'ye guncellenir; toast gorunur suresi (6000ms) ile dashboard birikim penceresi (6200ms) esitlenir (ikisi de 6200); migration.test'e v9 idempotency + crash-recovery vakasi eklenir (v8'deki C bolumu kalibi v9'a uygulanir).

---

## TESLIM RAPORU
Faz faz: yapilan + dosya listesi + davranis kaniti. Ozel olarak: segment gecisinde state korunumu kaniti; SectionList sayfalama davranisi; ozel araligin insights+PDF+CSV uclusunde ayni sonucu verdigi ornek; zaman cizelgesi sayfa sayisi ornegi; uppercase/kirpma grep sonuclari; migration.test yeni vaka ciktisi; gate ciktilari; HUMAN kalanlar (cihaz dogrulamalari).
