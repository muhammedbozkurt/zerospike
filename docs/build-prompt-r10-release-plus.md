# R10 BUILD PROMPT: 1.5.0 Kapanis Paketi (ogun yaniti + watch + guvenlik/kalite kalemleri)

KENDI KENDINE YETEN dosya. Amac: 1.5.0 release'inden once kullanicinin sectigi 7 isi 4 fazda bitirmek. FAZ 3 ve FAZ 4'un KILL-SWITCH'i vardir: takilirlarsa kesilir, 1.5.0 onlarsiz cikar (raporda acikca belirtilir), is 1.5.1'e kayar. FAZ 1-2 cekirdektir, kesilemez.

## 0. DEGISMEZ KURALLAR
- Notr regulasyon dili: "uyarir/alarm/tani/tavsiye edilen doz" yasak; doz her zaman "hesaplanan/kayit"; iyi/kotu yemek yargisi yasak; Spike doz sayisi vermez.
- Her yeni string 5 dil (tr/en/de/es/fr). Em-dash yok (kod yorumlari dahil). app.json'da version 1.5.0 SABIT (buildNumber/versionCode mevcut degerlerde kalir).
- GATELER (her fazin sonunda): `npx tsc --noEmit` · `npm run i18n-check` · `npx tsx scripts/calc.test.ts` · `npx tsx scripts/migration.test.ts` · (FAZ 1 sonrasi) `npx tsx scripts/mealResponse.test.ts`.
- GORSEL-DONDURULMUS YUZEYLER (magaza gorselleri uretildi; LAYOUT'larina dokunmak YASAK): dashboard hero/halka/haftalik serit/sayac karti, injection 3 segment + harita, food hero + ogun satirlari gorunumu, insights donut/AGP duzeni, rapor kapagi, Spike sohbet ekrani, kilit ekrani/widget yuzeyleri, onboarding. Yeni ozellikler ADDITIVE olur (yeni pushed ekran, kucuk rozet/chevron eklemek serbest; mevcut kompozisyonu degistirmek yasak).
- Mimari kaliplar: SQLite tek kaynak, lib/db/* veri katmani, ScreenHeader'li pushed ekranlar, Stepper/RangeInput/useUndoBatch/Tooltip mevcut bilesenler, format katmani Intl (lib/format.ts), upper.ts, tokens.ts renkleri.

---

## FAZ 1: OGUN YANITI + KUCUK DUZELTMELER (cekirdek, kesilemez)

### 1.1 Ogun yaniti hesap katmani
- `lib/mealResponse.ts` (saf, test edilebilir): `computeMealResponse(meal, readings, profile)`:
  - Pencere: ogun baslangicindan +3 saat (`MEAL_RESPONSE_HOURS = 3` tek sabit).
  - Baseline: ogunun bagli olcumu (`meal.sugar_log_id`) varsa o; yoksa baslangictan onceki 45 dk icindeki EN YAKIN okuma; o da yoksa baseline null (delta hesaplanmaz ama egri cizilir).
  - Egri: penceredeki tum `sugar_logs` (manuel + health kaynakli), zamana gore sirali.
  - Metrikler: baseline, peak, delta (peak-baseline), timeToPeakMin, twoHourValue (90-150 dk arasindaki en yakin okuma), pencere ici bant dagilimi (kullanicinin KENDI araligina gore: dusuk/aralikta/yuksek yuzdeleri).
  - Yetersiz veri kurali: pencerede 2'den az okuma varsa sonuc null (UI durust bos durum gosterir).
- `scripts/mealResponse.test.ts` (gate'e eklenir): pencere siniri (3s01dk disarida), baseline secimi (bagli olcum > 45dk-once > null), peak/delta, twoHourValue secimi, bant dagilimi, yetersiz veri -> null. En az 15 assert.

### 1.2 Ogun yaniti UI
- Yeni pushed ekran `app/meal-response.tsx` (ScreenHeader kalibi, param: mealId):
  - Ust: ogun ozeti (emoji + ad + karb + saat).
  - Orta: mini gradyan egri (GradientAreaChart kalibi kucuk boy; kullanicinin hedef bandi referans cizgileriyle; eksen 0-3s).
  - Stat cipleri: Baslangic · Tepe · +2s · Fark (delta). Renkler kullanicinin bandindan; yargi kelimesi yok.
  - Alt: "Onceki denemeler" - ayni yemek (food_id esit; custom ise normalize edilmis ad esit) son 5 kayit: tarih + delta + 2s degeri mini bar. LISTE PRO'ya bagli (tekil ogun karti FREE; karsilastirma listesi Pro rozetli, paywall'a gider - mevcut guardrails kalibi).
  - Bos durum (yanit yok/yetersiz): "Bu ogunun yanitini gormek icin sonraki 3 saatte olcum ekle" + tokluk sayacinin zaten bunu hatirlattigina dair notr cumle.
- Giris noktalari (additive): JournalItem ogun satirina yanit VARSA kucuk egri ikonu/chevron; food sekmesindeki bugunun ogunleri satirlarina ayni. Dokunma -> meal-response. Baska yuzeye dokunulmaz.
- i18n 5 dil; betimleyici dil ("yanit", "seyir"); "iyi/kotu/basarili" yasak.

### 1.3 Bilinen bug: yemek duzenlerken glukoz ekleme dusuyor
`app/calculator.tsx` edit dali: `linkedSugarLogId` yokken kullanici glukoz girdiyse okuma OLUSTURULUR: `findMatchingSugarLog` dedup'u ile (+-15 dk ayni deger varsa onu bagla), yoksa yeni `sugar_logs` + `meal_logs.sugar_log_id` guncelle. Kanit: olcumsuz bir yemegi duzenleyip 140 girince journal'da okuma beliriyor ve ogune bagli.

### 1.4 Cift bolus nazik onayi
Elle enjeksiyon kaydinda (injection ekrani + InjectionEditSheet yeni kayit yolu): ayni profilde son +-15 dk icinde `source='calculator'` bir bolus varsa NOTR confirm: "{n} u hesaplayicidan kaydedilmis bir bolus var ({saat}). Yine de kaydedilsin mi?" Evet -> kaydeder (engel yok). i18n 5 dil. checkDose akisiyla cakismaz (once cift-bolus sorusu, sonra doz esik onaylari).

### 1.5 Hijyen
- `lib/theme/tokens.ts` icindeki silinmis COLORS'a atif yapan bayat yorum guncellenir.
- `as Href` cast'leri: `npx expo customize tsconfig.json` gerekmez; typed routes uretimi icin kisa `npx expo start` acilip kapatilabilir veya cast'ler tek yardimciya toplanir. Uretilebiliyorsa kaldir, kalacaksa tek noktada tut ve raporla.
- Hizli grep taramasi: "TODO/FIXME/eight sites/legacy" bayat yorum kalintilari; bulunanlari duzelt veya raporla.

---

## FAZ 2: SPIKE SUNUCU TARAFI GUNLUK LIMIT (cekirdek, kesilemez)

Mevcut: istemci sayaci (lib/ai/spikeLimit.ts, free 3 / Pro 50) + function'da saatlik IP tavani 30. Eklenen: cihaz basina GUNLUK sunucu tavani.

- 2.1 Istemci: kalici anonim kurulum kimligi (`zerospike.deviceId`, AsyncStorage, uuid) - `lib/ai/spikeClient.ts` istege iki header ekler: `x-device-id` ve `x-tier: free|pro` (isProUser'dan; spoof edilebilir oldugu KABUL, amac maliyet tavani).
- 2.2 Function (`supabase/functions/ai-ask-spike/index.ts`): Supabase DB'de `spike_usage` tablosu (device_id text, day text, count int, primary key(device_id, day)). Her istekte: gun anahtari (UTC), atomic upsert+increment; tavan: tier=pro ise 50, degilse 3; asimda 429 `{error:"daily_limit"}` (OpenAI'ye gitmeden). Erisim: function icindeki yerlesik `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env'leriyle REST upsert (service role RLS'i asar; tablo icin RLS acik + policy yok = yalniz service role erisir). IP tavani AYNEN kalir.
- 2.3 SQL migration: `supabase/migrations/<ts>_spike_usage.sql` dosyasi yazilir (create table + RLS enable). Uygulama: `supabase link --project-ref zobtmenqgsradocrxdtc` + `supabase db push` dene; CLI ile olmazsa SQL'i teslim raporuna koy ve HUMAN isaretle (Dashboard SQL editor). Function deploy: `supabase functions deploy ai-ask-spike --project-ref zobtmenqgsradocrxdtc --no-verify-jwt`.
- 2.4 Istemci 429 isleme: `daily_limit` yanitini mevcut limit-doldu kartina bagla (ayni UI, sunucu kaynakli oldugunda da ayni gorunum).
- 2.5 Gizlilik: `lib/legal.ts` gizlilik metnine tek cumle (5 dil): anonim kurulum kimligi yalniz gunluk kullanim sinirlamasi icin islenir; saglik verisi degildir.
- 2.6 Test (curl): x-device-id sabit + tier=free ile 3 istek OK, 4. istek 429; tier=pro ayni cihazda 50 tavani (ornekleme: sayaci elle 49'a cekip 2 istek); IP tavani hala calisiyor. Ciktilar teslim raporuna.

---

## FAZ 3: watchOS COMPANION (KILL-SWITCH: EAS build 1 tam gun icinde yesillenmezse target devre disi, 1.5.1'e)

Veri mimarisi karari (verili): watch, iPhone App Group'unu OKUYAMAZ; veri **WatchConnectivity applicationContext** ile itilir.

- 3.1 iOS koprusu: `modules/zerospike-watch-bridge/` (Expo native module, zerospike-live-activity kalibi): WCSession activate; `pushLiveData(json)` -> `updateApplicationContext`. `lib/services/liveData.ts` publishToNativeSurfaces'a try/catch'li opsiyonel watch push eklenir (modul yoksa sessiz no-op; Expo Go guvenli).
- 3.2 Watch target: `targets/watch/` (apple-targets watch tipi; deneysel - config calismazsa kill-switch'e say). SwiftUI tek ekran: buyuk son olcum (`lastGlucoseDisplay`) + bant renkli nokta + "x dk once" + aktif tokluk kalan suresi; WCSession delegate applicationContext'i watch UserDefaults'ina yazar; ekran + komplikasyonlar oradan okur.
- 3.3 Komplikasyonlar (WidgetKit watchOS): accessoryCircular (deger) + accessoryRectangular (deger + kalan sure). Veri yoksa "--" durumu.
- 3.4 Kimlikler/EAS: watch bundle id `com.greeneyeapp.zerospike.watchapp` (apple-targets uretir); EAS credentials yeni target'i sorar - build denemesi yapilir. NOT: cihazda dogrulama HUMAN (eslesmis gercek saat); simulatorde temel calisirlik yeterli.
- 3.5 Watch magaza gorselleri (target yesillendiyse): eslesmis watch simulatorden gercek cekim, `zerospike-store/watch-422x514/<dil>/01.png` (+ istege 02 sayac hali). Kompozit gerekmez, sade cekim; 5 dil icin scLang dongusu telefondan surulur (watch UI metinleri 5 dilde - i18n stringleri snapshot'tan gelir, ek ceviri yalniz watch'a ozgu etiketler icin).
- 3.6 KILL-SWITCH prosedueru: apple-targets watch tipi calismaz / EAS provisioning cozulmez / 1 gun asilirsa: target klasoru ve config kaldirilir (revert), rapora "watch 1.5.1'e ertelendi + neden" yazilir, kalan fazlara devam edilir.

---

## FAZ 4: MIGRATION ORKESTRASYON REFACTOR'U (EN SON; KILL-SWITCH: suphe halinde tam geri al)

- 4.1 `lib/db/migrations.ts`: migrateToV8/V9/V10 govdeleri oradan export edilen fonksiyonlara SATIR SATIR tasinir (db handle parametreli); `lib/db/index.ts` bunlari cagirir. Davranis birebir: ayni SQL siralari, ayni PRAGMA konumlari, ayni transaction sinirlari.
- 4.2 `scripts/migration.test.ts`: kendi runV8/runV9 kopyalarini SILER, gercek fonksiyonlari import eder (node:sqlite icin ince adapter shim kabul). 44 mevcut assert + orkestrasyon vakalari (yanlis sira/eksik adim yakalanir) yesil.
- 4.3 BIREBIRLIK KANITI: refactor oncesi ve sonrasi ayni v7 fixture'ina migration kosulup tum tablolarin dump'i karsilastirilir (fark = SIFIR satir). Kanit ciktisi teslim raporuna.
- 4.4 KILL-SWITCH: herhangi bir test kirmizi kalirsa veya dump farki cikarsa refactor TUMUYLE geri alinir (eski index.ts hali), rapora yazilir, 1.5.1'e.

---

## TESLIM RAPORU
Faz faz: yapilan + dosya listesi + davranis kanitlari (1.3 icin journal kaniti, 1.4 icin confirm akisi, 2.6 curl ciktilari, 3'te build durumu + varsa watch ekran goruntusu, 4.3 dump-fark ciktisi) + gate ciktilari + kill-switch kararlari (kullanildiysa nedeniyle) + HUMAN kalanlar (watch gercek cihaz testi, SQL push CLI'dan olmadiysa Dashboard adimi). Version 1.5.0 sabit kaldi mi dogrula.
