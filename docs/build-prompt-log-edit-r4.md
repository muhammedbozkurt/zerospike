# zerospike R4: kayit duzenleme turu (2026-07-13, kullanici feedback'i)

Sen zerospike uzerinde calisan gelistirme session'isin. Bu dosya sozlesmendir: fazlari
sirayla uygula, faz basina commit, onay bekleme. Teshis hub tarafindan koda karsi
dogrulandi (dosya:satir kanitlari asagida).

## Kurallar

- main dalinda calis.
- Statik kapi HER commit'te: `npm run typecheck` (tsc + i18n-check birlikte).
- Em dash (U+2014) hicbir yerde.
- REGULASYON DILI: "uyarir / alarm / tani / tedavi / onerilen doz" yasak. Duzenleme
  ekranlari kullanicinin KENDI kayitlarinin duzeltilmesidir, bu cerceveyi koru.
- i18n: lib/i18n/locales/tr.ts SEMA KAYNAGI; yeni anahtar once oraya, sonra 4 dile
  (en/de/es/fr). Dogal ceviri, TR diakritikleri dogru.
- Android'de Health Connect YOK, geri eklenmez.
- DIALOG/SHEET KURALI (gotcha 22): calculator, add-food, scan gibi modal ekranlarda her
  turlu onay/action sheet YALNIZ FeedbackHost yigini uzerinden (components/Feedback.tsx
  host deseni, R3'te kuruldu). Yeni RN <Modal> ACMA.
- Yeni native modul ekleme.

## KULLANICI FEEDBACK'I VE TESHIS

Feedback: "girdigim yemegin degerini sonradan duzenlemek istiyorum ama duzenleyemiyorum;
yanlis girmis olabilirim, etiket yanlis olabilir."

Teshis (hub dogruladi): duzenleme UC katmanda birden hic yok:
1. VERI KATMANI: sugar_logs, meal_logs, injection_logs, foods icin UPDATE fonksiyonu
   YOK (lib/db'de UPDATE yalniz insulin_pens ve user_profiles: injections.ts:89,160,201,
   profiles.ts:96). Silme her tur icin var (logs.ts:61,147; injections.ts:192;
   foods.ts:267 yalniz is_custom=1).
2. EKRANLAR: calculator.tsx ve add-food.tsx yalniz OLUSTURMA modunda; mevcut kayit id'si
   almiyorlar (calculator.tsx:55 yalniz foodId/portion parametreleri; add-food.tsx:39-57
   hep INSERT). Ogun saati secilemiyor bile: addMealLog'a logged_at GECIRILMIYOR,
   varsayilan "simdi" (logs.ts:106; input.logged_at alani zaten var, UI kullanmiyor).
3. LISTE: kontrol panelindeki JournalItem'a yalniz onLongPress={confirmDelete} bagli
   (app/(tabs)/index.tsx:674-678); normal dokunus NO-OP. Injection listesi de ayni
   (injection.tsx:388). Yani kullanici duzeltmek icin sil + yeniden gir yapmak zorunda.

Iyi haber (hub dogruladi): tokluk hatirlatici zamanlayicisi meal_logs.logged_at OKUMUYOR;
"simdi"ye demirli (lib/services/notifications.ts:256-288). Ogun saatini duzenlemek
zamanlayiciyla catismaz. KURAL: duzenleme yolunda schedulePostMealReminder CAGIRMA
(yalniz yeni kayit akisinda kalir, calculator.tsx:171).

---

## FAZ 12.1: Veri katmanina UPDATE

- lib/db/logs.ts: `updateSugarLog(id, patch)` ve `updateMealLog(id, patch)` ekle.
  Patch alanlari: sugar icin deger/birim alanlari + logged_at + tags/slot (semadaki
  gercek kolonlara gore); meal icin food_id/custom_food_name, portion_g,
  calculated_carbs_g, insulin_dose_units, personal_note, tags, photo_uri_local, logged_at.
  Kismi guncelleme deseni: profiles.ts:81-99'daki dinamik `fields.join` yaklasimini kopyala.
- lib/db/injections.ts: `updateInjection(id, patch)` ekle. DIKKAT kalem stogu:
  deleteInjection birimleri kaleme IADE ediyor (:192 civari). Duzenlemede ayni muhasebe:
  doz degistiyse fark kadar kalemden dus/iade et; kalem degistiyse eskisine tam iade,
  yenisinden tam dus. Tek transaction icinde yap.
- lib/db/foods.ts: `updateFood(id, patch)` YALNIZ `WHERE is_custom = 1` (seed ve
  barkod-cache satirlari duzenlenemez). FTS senkronu icin foods_au trigger'i zaten var
  (lib/db/index.ts:207), ekstra is gerekmez; yine de guncelleme sonrasi aramada yeni
  isimle bulundugunu dogrula.
- Donus degerleri ve tipler lib/db/types.ts ile tutarli olsun.

Kapi + commit: `feat(db): update functions for sugar/meal/injection logs and custom foods`

## FAZ 12.2: Ogun duzenleme (calculator edit modu)

- calculator.tsx `mealLogId` parametresi alsin. Varsa: kayit yuklenir, food/portion/doz/
  not/etiket/foto alanlari on-dolu gelir, baslik ve CTA "duzenle/kaydet" diline doner,
  kaydet UPDATE cagirir (INSERT degil). Karbonhidrat, mevcut akistaki ayni formulle
  porsiyondan yeniden hesaplanir.
- SAAT ALANI: hem yeni kayitta hem duzenlemede logged_at secilebilir olsun (tarih + saat).
  Picker: repoda mevcut tarih/saat deseni varsa onu kullan; @react-native-community/
  datetimepicker kullanacaksan gotcha 23: `locale` yalniz iOS'ta calisir (iOS'ta uygulama
  diliyle ac, Android sistem dilinde kalir, bunu bug sayma). Gelecek tarih SECILEMEZ.
- Duzenleme yolunda tokluk hatirlatici KURULMAZ (yukaridaki kural).
- Kaydet sonrasi modal duzgun kapanir, journal yenilenir (mevcut kapanis akisini kullan).

Kapi + commit: `feat(calculator): edit mode for meal logs with editable logged time`

## FAZ 12.3: Seker ve enjeksiyon kaydi duzenleme

- Seker: GlucoseInputSheet'e (components/GlucoseInputSheet.tsx) edit modu ekle: mevcut
  deger/saat/etiketle acilir, kaydet updateSugarLog. Sheet'in alanlarini once oku; saat
  alani yoksa ekle (12.2 ile ayni picker deseni).
- Enjeksiyon: enjeksiyon satirindan duzenleme: doz, saat, kalem. updateInjection'in kalem
  muhasebesini kullan. Injection tab listesindeki satirlar (injection.tsx:385-390) da
  12.4'teki dokunma davranisini alir.

Kapi + commit: `feat(logs): edit flows for glucose and injection entries`

## FAZ 12.4: Liste etkilesimi: dokun = duzenle, uzun bas = menu

- app/(tabs)/index.tsx: JournalItem'a `onPress` bagla: kayit turune gore ilgili edit
  akisini acar (meal -> calculator?mealLogId=..., sugar -> GlucoseInputSheet edit,
  injection -> enjeksiyon edit).
- Uzun basis: dogrudan silme onayi yerine FeedbackHost actionSheet: "Duzenle / Sil /
  Vazgec". Sil yine mevcut confirm'e gider. (Tum metinler 5 dilde.)
- Injection tab listesi ayni desene gecer (:388).
- Kesfedilebilirlik: kayit satirina dokununca duzenlenebildigini kullanici bilmiyor;
  ilk acilista tek seferlik kucuk ipucu satiri (journal ustunde, kapatilabilir) ekle,
  AsyncStorage bayragiyla bir kez goster.

Kapi + commit: `feat(journal): tap-to-edit rows with edit/delete action sheet`

## FAZ 12.5: Ozel yemek duzenleme + opsiyonel kucuk isler

- add-food.tsx `foodId` parametresiyle edit modu: yalniz is_custom=1 satirlar; isim,
  karbonhidrat ve diger makrolar duzenlenir, kaydet updateFood. Food tab'inda ozel yemek
  satirinda uzun basis menusu "Duzenle / Sil" olur (food.tsx:269 mevcut silmeyi menuye tasi).
- OPSIYONEL (kucuk, yap): onboarding Android donanim geri tusu: quiz adim 0'dayken
  hardware back welcome fazina donsun (app/onboarding.tsx:267-272 in-UI ok bunu yapiyor,
  BackHandler yok). NOT: statura'daki geri-donus cikmazi bu repoda YOK, hub dogruladi:
  onboarding tek route + clamp'li stepIdx state'i (onboarding.tsx:93-94,132,162-163),
  advancingRef her adimda sifirlaniyor (:135-138). Bu madde yalniz kucuk bir UX rotusu.
- Sonda: iOS buildNumber + Android versionCode bump (tek commit).

Kapi + commit: `feat(food): edit custom foods` + `chore(release): bump build numbers`

---

## HUMAN TODO

- [ ] Cihaz QA asagida; yeni native modul yok, mevcut dev client + Metro yeterli.
- [ ] App in review: bu tur onay SONRASI guncelleme olarak gider; QA bitince yeni
      production build al (teker teker kurali).

## CIHAZ QA CHECKLIST (kullanici, en sonda toplu)

- [ ] Ogun kaydina dokun: calculator on-dolu aciliyor; degeri ve SAATI degistir, kaydet:
      journal'da guncel deger/saat; tokluk hatirlatici YENIDEN kurulmadi.
- [ ] Seker kaydi duzenle: deger + saat degisiyor, insights/rapor guncel degeri gosteriyor.
- [ ] Enjeksiyon dozu duzenle: kalem kalan birimi dogru (eski doz iade + yeni doz dusuldu);
      kalem degistirince iki kalemin stogu da dogru.
- [ ] Ozel yemegi duzenle: yeni isimle aramada (FTS) bulunuyor; seed yemekte duzenleme
      secenegi CIKMIYOR.
- [ ] Uzun basis menusu modal ekranlarin ustunde aciliyor (gotcha 22 regresyonu yok);
      kaydet sonrasi UI kilitlenmesi yok.
- [ ] Gecmis tarihli ogun duzenlemesi doktor raporunda dogru gune dusuyor.
- [ ] 5 dilde yeni string'ler + TR diakritik goz kontrolu; regulasyon dili taramasi
      (yeni metinlerde "uyari/alarm/doz onerisi" yok).
- [ ] Android donanim geri: quiz adim 0'da welcome'a donuyor (12.5 rotusu).
