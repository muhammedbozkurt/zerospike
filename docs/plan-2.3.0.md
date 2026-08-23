# 2.3.0 Master Plan (onay: 2026-08-23, "alarm varsayilan olsun, tokluk da timer olsun")

Kaynak: docs/alarmkit-2.2.0.md (kapsam kaydi, hala gecerli) + 2.2.0'da acik
birakilan tek aday (tokluk sayaci AlarmKit timer'i) + kullanicinin 2.3.0
karari. 2.2.0'daki AlarmKit altyapisi (modules/zerospike-alarmkit,
lib/alarmSelect.ts, reminders.alarm_enabled) aynen korunur, uzerine kurulur.

## 0. Kritik tasarim kararlari (ozet)

- **A / ezmeme**: v21 once `alarm_user_set` kolonunu ekler, sonra
  `alarm_enabled = 1` olan her satiri "kullanici sectti" diye isaretler (o
  degeri yazabilecek tek yol 2.2.0'daki "Alarm olarak cal" anahtaridir), sonra
  yalniz isaretsiz satirlari alarma cevirir. 2.2.0'da bilincli olarak KAPALI
  birakilan satir veritabaninda hic bir izle ayirt edilemez (kapali = hic
  dokunulmamis ile ayni 0), bu yuzden o satirlar cevrilir ve telafi UI
  tarafinda yapilir: tur (D) bir kez acikca soyler, listede satir basi
  Alarm/Bildirim rozeti tek dokunusla geri alir.
- **B / varsayilan**: tokluk timer'i VARSAYILAN ACIK
  (DEFAULT_PREFS.postMealAlarm = true). **Kullanici karari 2026-08-23:
  varsayilan acik.** Planin ilk hali opt-in diyordu; gerekce, AlarmKit
  countdown'un kendi yuzeyini cizmesi ve bizim markali PostMealActivity
  kartinin devre disi kalmasiydi. Bu bedel bilerek kabul edildi: tokluk sayaci
  da A'daki hatirlaticilarla ayni cerceveden (gercek alarm, her zaman geri
  alinabilir) faydalanir. Alarm modu kapatildiginda (kullanici bildirime
  cevirdiginde) mevcut markali Live Activity + bildirim akisi AYNEN calismaya
  devam eder; timer yalniz alarm modunda devreye girer. Cihaz QA'sinda sistem
  karti kabul edilemez cikarsa geri alma tek satirdir (DEFAULT_PREFS).
- **C / izin ani**: AlarmKit izni onboarding'de hatirlatici kurulum adiminin
  HEMEN SONRASINDA, yalniz gercekten bir satir yazildiysa istenir (medReminder
  veya glucoseReminder "Kur" akisinda, requestNotificationPermission'dan hemen
  sonra, onboarding basina bir kez). Sebep: izin diyalogu ancak ortada somut bir
  hatirlatici varken anlamlidir; "Simdi degil" diyen kullanici hic sorgu gormez.
  Ret hicbir seyi bloke etmez, satirlar bildirime duser.
- **D / tur**: tur YALNIZ 2.3.0'a GUNCELLEYEN kullaniciya gosterilir. Yeni
  kullanici onboarding'de zaten hem izni hem cerceveyi goruyor, ayrica
  completeOnboarding turu "gorulmus" isaretler, boylece surum karsilastirmasi
  yapmadan yeni kurulum kendiliginden tur disi kalir. Ek kosul: iOS 26+ AlarmKit
  var, aktif profilde en az bir hatirlatici satiri var (yoksa turun iddiasi
  bos olur).

## 1. Sert sinirlar (tartismasiz, degistirilemez)

- **Dusuk-sonrasi takip (scheduleLowFollowup, lib/services/notifications.ts:1540-1566)
  DEGER TETIKLEMELIDIR, ASLA alarm olmaz.** Ayarlarda alarm secenegi sunulmaz,
  anahtari yazilmaz, turda anilmaz. docs/alarmkit-2.2.0.md:13-15 cizgisi aynen
  devam eder: deger-tetiklemeli alarm = tibbi cihaz cizgisi = store reddi.
  Time Sensitive bildirim (lowFollowupExtras) olarak kalir.
- **Haftalik ozet (scheduleWeeklySummary), bos gunluk hatirlaticisi
  (scheduleIdleReminder), deneme bitiyor (TRIAL_ID): bildirim kalir, alarm
  secenegi YOK.** Bunlar kullanicinin kurdugu sabit saatli hatirlatici degil,
  uygulamanin kendi durum bildirimleridir; AlarmKit kullanim amaci disidir.
- **Regulasyon dili**: "uyarir", "alarm verir", "hipoglisemi alarmi", "tani",
  "tedavi", "onerilen doz" ve turevleri hicbir kullanici metninde gecmez.
  Izinli cerceve tek cumleyle: "kurdugunuz hatirlatici gercek alarm olarak
  calar". "Alarm" kelimesi yalniz teslim bicimi adi olarak kullanilir, saglik
  iddiasi tasimaz.
- **iOS<26 / Android / AlarmKit yetkisiz**: her sey bildirimdir. Alarm rozeti,
  mod secici, tokluk alarm anahtari ve tur GORUNMEZ; mevcut fallback zinciri
  (shouldUseAlarm uc'lu AND + scheduleReminderRow'a dusme) korunur. Android'e
  full-screen intent bu dalgada da girmez.

## 2. A. Varsayilan alarm (Hatirlatici Merkezi)

1. **lib/db/v21Sql.ts (yeni)**: `V21_REMINDERS_COLUMNS = [{ name:
   "alarm_user_set", type: "INTEGER NOT NULL DEFAULT 0" }]`, ayrica iki tek
   satirlik ifade: `V21_MARK_EXPLICIT_CHOICE` ve `V21_DEFAULT_TO_ALARM` (SQL
   metinleri madde 6'da). v19Sql/v20Sql ile ayni bagimsiz-modul deseni, boylece
   scripts/migration.test.ts gercek SQL'i calistirir.
2. **lib/db/migrations.ts**: `SchemaStamp` birligine 21 eklenir; `migrateToV21`
   migrateToV19/V20 govdesinin birebir kopyasi (PRAGMA table_info okumasi
   transaction DISINDA, korumali ADD COLUMN, sonra iki UPDATE, sonra
   `stampSchemaVersion(db, 21)`). Tablo yeniden kurulmaz (v8/v9/v11 dersi).
3. **lib/db/index.ts**: `SCHEMA_VERSION = 21`; migrasyon zincirine v20 -> v21
   adimi; `createSchemaV1` taze kurulum yolunda V21 kolonu kosulsuz eklenir
   (v19/v20 deseni). Taze kurulumda tablo bos oldugundan iki UPDATE dogal
   no-op'tur, yine de ayni sirayla calisir ki iki yolun DDL'i ve semantigi
   birebir aynı kalsin.
4. **lib/db/types.ts**: `Reminder` arayuzune `alarm_user_set: number`.
5. **lib/db/reminders.ts**:
   - `NewReminderInput.alarmEnabled` varsayilani TERSINE doner: `enabled` ile
     ayni desen, `input.alarmEnabled === false ? 0 : 1`. Yeni satir alarm dogar.
     Kolon DEFAULT'u 0 kalir (semayi degistirmeye gerek yok, INSERT zaten deger
     yaziyor); dokuman yorumu buna gore guncellenir.
   - `NewReminderInput.alarmUserSet?: boolean` ve `ReminderUpdate.alarmUserSet?:
     boolean` eklenir; `updateReminder` `alarm_user_set = ?` alanini ayni
     desenle yazar.
   - Kural: `alarm_user_set = 1` YALNIZ kullanicinin alarm/bildirim kontrolune
     dokundugu yazmalarda gonderilir. Onboarding'in ve varsayilanin yazdigi
     satirlar 0 kalir.
   - DB semantigi netlestirilir (dosya bası yorumu): `alarm_enabled` kullanicinin
     TERCIHIDIR, platform gercegi degil. Android/iOS<26 satirlari da 1 tasiyabilir;
     calisma zamani karari shouldUseAlarm'da verilir. Boylece iOS 26'ya gecen bir
     cihaz satirlara tekrar dokunmadan alarma gecer (izin yine ayri istenir).
6. **lib/alarmSelect.ts**: `shouldUseAlarm` imzasi ve davranisi AYNEN kalir.
   Yanina saf `alarmModeOf(input): "alarm" | "notification"` eklenir (ayni uc'lu
   AND uzerinden). UI (madde 7-8) rozeti bu fonksiyondan cizer, boylece "Alarm"
   yazan bir satir gercekte bildirim olarak calisamaz.
7. **app/settings/reminders.tsx**:
   - Mevcut satir-basi `enabled` switch'i AYNEN korunur.
   - `row.alarm_enabled === 1` kosuluyla cizilen mevcut alarm ikonu (satir
     277-291) kaldirilip yerine dokunulabilir mod rozeti gelir: `alarmModeOf`
     "alarm" derse `reminders.modeAlarm`, degilse `reminders.modeNotification`.
     Rozet YALNIZ `isAlarmKitAvailable()` true iken cizilir. Bu ayni zamanda
     A-migrasyonunun tum satirlari 1 yapmasinin Android/iOS<26'da yanlis ikon
     gostermesini kokten engeller.
   - Rozete dokunmak modu cevirir: `updateReminder(row.id, { alarmEnabled: !x,
     alarmUserSet: true })` + mevcut `afterChange()`. "Alarm"a cevirirken yetki
     `notDetermined` ise `requestAlarmAuthorization()`, `denied` donerse
     `Linking.openSettings()` ipucu (ReminderEditSheet'teki mevcut desen).
   - Liste basina tek satirlik aciklama: `reminders.modeHint` (yalniz AlarmKit
     varken).
8. **components/ReminderEditSheet.tsx**:
   - Yeni satirda `alarmEnabled` baslangic degeri `true` (mevcut satirda yine
     `editingReminder.alarm_enabled === 1`).
   - `submit()` artik `alarmKitAvailable && alarmEnabled` yerine duz
     `alarmEnabled` yazar (tercih platformdan bagimsiz saklanir, madde 5) ve
     anahtara dokunulduysa `alarmUserSet: true` gonderir (yeni `alarmTouched`
     state).
   - Anahtar acikken ve yetki henuz yokken tek satirlik ipucu:
     `reminders.alarmPermissionHint`. Reddedilmis durumda mevcut
     `reminders.alarmPermissionDenied` + "Ayarlari ac" korunur.
   - Yeni satir icin anahtarin altinda `reminders.alarmDefaultHint`.
9. **lib/services/notifications.ts**: `applyReminders` (685-816) mantiginda
   DEGISIKLIK YOK; uc'lu AND, cift teslim onlemi, yetim supurgesi aynen kalir.
   Yalniz dosya basi yorumu ve applyReminders'in doc yorumu "alarm artik
   varsayilan tercihtir" diye guncellenir. `cancelRemindersOfType` (578-600)
   alarm iptalini zaten yapiyor, dokunulmaz.

## 3. B. Tokluk sayaci AlarmKit timer'i

10. **modules/zerospike-alarmkit/ios/ZerospikeAlarmKitModule.swift**: tek yeni
    giris noktasi `AsyncFunction("scheduleCountdownTimer") { (id, seconds,
    title, stopLabel) -> Bool }`. Mevcut `uuidForIdentity` kimlik haritasini,
    `alarmTint`ini ve "once cancel, sonra schedule" desenini aynen kullanir;
    tek fark konfigurasyonun `Alarm.Schedule` yerine countdown suresiyle
    kurulmasi ve sunumun `AlarmPresentation(alert:countdown:)` olmasi
    (countdownDuration verilirken countdown sunumu zorunludur). `cancelAlarm`
    ve `listScheduledAlarmIds` AYNI id haritasi uzerinden calistigi icin timer
    icin YENI iptal/listeleme fonksiyonu YAZILMAZ. Sessiz degradasyon
    sozlesmesi aynen: iOS<26, yetkisiz veya hata -> `false`, asla throw yok.
    Not (dosya yorumuna): countdown API adlari bu ortamda derlenemedi, ilk
    gercek Xcode 26 derlemesi kullanicidadir, tipki 2.2.0'daki
    `cancel(id:)` / `alarms` duzeltmeleri gibi.
11. **modules/zerospike-alarmkit/index.ts**: `scheduleCountdownTimer(options:
    { id; seconds; title; stopLabel }): Promise<boolean>` sarmalayicisi, mevcut
    `scheduleDailyAlarm` ile birebir ayni try/catch + `?? false` sozlesmesi.
12. **lib/services/notificationPrefs.ts**: `NotificationPrefs.postMealAlarm:
    boolean`, `DEFAULT_PREFS.postMealAlarm = true` (karar 0.B, kullanici karari
    2026-08-23). Merge zaten varsayilana dusuyor, migration gerekmez.
13. **lib/services/notifications.ts / schedulePostMealAt (1139-1224)**:
    - Yeni sabit `POSTMEAL_ALARM_ID = "zerospike-alarm-postmeal"` (mevcut
      ALARM_ID_PREFIX ile ayni ad kurali).
    - Karar `shouldUseAlarm({ alarmEnabled: prefs.postMealAlarm,
      alarmKitAvailable, alarmAuthorized })` ile verilir; YENI karar fonksiyonu
      yazilmaz, A ile ayni tek tanim kullanilir.
    - Timer kurulursa: `Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID)`
      (zaten ilk adimda yapiliyor) + bildirim KURULMAZ + `endPostMealActivity()`
      cagrilir, `startPostMealActivity` CAGRILMAZ (AlarmKit countdown kendi
      kilit ekrani kartini cizer; iki sayac karti yan yana gorunmemeli).
    - Timer `false` donerse bugunku yol aynen calisir (bildirim +
      startPostMealActivity), boylece sayac hicbir kosulda kaybolmaz.
    - Bildirim yolu seciliyse her seferinde `cancelAlarm(POSTMEAL_ALARM_ID)`
      cagrilir (mod kapatildiginda kalan timer'i toplar). Iki yon de tek
      yerde, applyReminders'daki useAlarm/rowActive/else uclusunun aynisi.
    - AsyncStorage anahtarlari (POSTMEAL_TIMER_END/START/PROFILE) ve gosterge
      mantigi DEGISMEZ: app/(tabs)/index.tsx'teki PostMealCountdown karti,
      getPostMealTimerState ve tokluk sifirlama kurallari oldugu gibi calisir.
    - Timer basligi `notifications.postmealTitle`, durdurma metni
      `reminders.alarmStopButton` (yeni metin yok, mevcut anahtarlar).
14. **cancelPostMealTimer (1305-1321) ve completePostMealTimer (1288-1299)**:
    ikisi de `cancelAlarm(POSTMEAL_ALARM_ID)` cagirir. Erken kayit, iptal ve
    sure dolumu bir timer'i asla ayakta birakmaz.
15. **lib/services/notifications.ts / yeni export
    `applyPostMealAlarmModeChange(): Promise<PostMealWindowChange>`**: calisan
    bir sayac varken mod degistirildiginde onu YENI modda yeniden kurar.
    Govdesi rescheduleForLanguageChange'in (1594-1613) re-arm blogunun
    aynisidir (getPostMealTimerState + schedulePostMealAt, endsAt/startedAt
    korunur). `applyPostMealWindowChange` bunun yerine kullanilamaz: ayni
    pencereyle cagrildiginda retimePostMealWindow "unchanged" doner ve yeniden
    kurmaz.
16. **app/settings/notifications.tsx**: `prefs.postMeal` acikken cizilen
    InlineConfigCard icine, sure secicisinin altina Alarm/Bildirim secimi
    (`settings.postMealAlarm` + `settings.postMealAlarmHint`). YALNIZ
    `isAlarmKitAvailable()` true iken cizilir. Alarma cevirirken yetki akisi
    ReminderEditSheet'in `onToggleAlarm` deseniyle aynidir; degisiklikten sonra
    `applyPostMealAlarmModeChange()` cagrilir ve mevcut `postMealRunning`
    notu korunur.
17. **rescheduleForLanguageChange (1594-1647)**: ek is yok; calisan sayaci
    zaten schedulePostMealAt uzerinden yeniden kuruyor, dolayisiyla timer
    etiketi de yeni dile gecer. Doc yorumuna bu cumle eklenir.

## 4. C. Onboarding'de alarm

18. **app/onboarding.tsx**:
    - `setupMedReminder` (534) ve `setupGlucoseReminder` (573) icindeki
      `createReminder` cagrilari acikca `alarmEnabled: true` gecer (varsayilan
      zaten oyle olacak, niyet okunur kalsin diye acik yazilir); `alarmUserSet`
      GONDERILMEZ (0 kalir, bu bir kullanici secimi degil).
    - Her iki fonksiyonda `requestNotificationPermission()` cagrisindan hemen
      sonra `ensureAlarmAuthorizationOnce()` (dosya ici yardimci + `useRef`
      kilidi): `isAlarmKitAvailable()` ve `getAlarmAuthorizationStatus() ===
      "notDetermined"` ise `requestAlarmAuthorization()`. Ret veya hata
      akisi hicbir sekilde durdurmaz, `next()` her kosulda calisir.
    - Iki hatirlatici adiminin metnine, AlarmKit varken gorunen tek satir:
      `onboarding.alarmNote`.
    - "Simdi degil" yolunda satir yazilmaz, dolayisiyla AlarmKit izni de
      hic istenmez.
19. **Sonradan tekrar isteme**: turun 2. adimi (madde 21) ve satir rozeti
    (madde 7) ayni `requestAlarmAuthorization()` -> `denied` ise
    `Linking.openSettings()` zincirini kullanir. iOS sistem diyalogu bir kez
    gosterir, ikinci istek aninda `denied` doner ve kullanici sistem ayarlarina
    yonlendirilir.

## 5. D. Tanitim turu (2-3 adim, bir kez)

20. **lib/services/alarmTour.ts (yeni)**: `ALARM_TOUR_KEY =
    "zerospike.alarmTourSeen"` (deger: `Constants.expoConfig?.version`,
    lib/services/review.ts'teki `reviewLastPromptVersion` deseni),
    `markAlarmTourSeen()`, `hasSeenAlarmTour()`. AsyncStorage kullanilir,
    app_meta degil: bu bir arayuz "gorulme" bayragi, tipki
    `zerospike.widgetTipDismissed` / `zerospike.winbackShown`.
21. **app/alarm-tour.tsx (yeni modal rota)**: 3 adim, mevcut modal rotalarin
    (paywall/winback) gorsel dili.
    1. Ne degisti: `alarmTour.step1Title/step1Body`.
    2. Izin: `alarmTour.step2Title/step2Body` + `alarmTour.step2Cta` ->
       `requestAlarmAuthorization()`; `denied` ise
       `reminders.alarmPermissionDenied` + `settings.openSystemSettings`.
    3. Kontrol sizde: `alarmTour.step3Title/step3Body` + `alarmTour.step3Cta`
       -> kapat ve `/settings/reminders`.
    Her adimda `alarmTour.skip`; kapanis hangi yoldan olursa olsun
    `markAlarmTourSeen()`.
22. **app/_layout.tsx**: `alarm-tour` Stack.Screen kaydi (`presentation:
    "modal"`), ve RootNavigator icinde winback push'unun (satir ~328) yanina
    ayni desende tek seferlik efekt: `ready && onboarded && settled` iken
    `isAlarmKitAvailable()` && `!(await hasSeenAlarmTour())` &&
    `(await listReminders()).length > 0` ise `markAlarmTourSeen()` sonra
    `router.push("/alarm-tour")`. Isaretleme push'tan ONCE yapilir (winback
    deseni), boylece cift acilma imkansiz.
23. **lib/store/AppContext.tsx / completeOnboarding**: `markAlarmTourSeen()`
    cagrilir. Yeni kullanici onboarding'de kapsandi, tur ona hic gorunmez;
    surum karsilastirmasi yapmaya gerek kalmaz.

## 6. Migration detayi (v21)

Uc ifade, bu SIRAYLA, tek transaction icinde:

```sql
ALTER TABLE reminders ADD COLUMN alarm_user_set INTEGER NOT NULL DEFAULT 0;
UPDATE reminders SET alarm_user_set = 1 WHERE alarm_enabled = 1;
UPDATE reminders SET alarm_enabled = 1 WHERE alarm_user_set = 0;
```

- **Neden bu sira**: ikinci ifade, ucuncunun her satiri 1 yapmasindan ONCE
  2.2.0'in tek bilinen niyet izini (alarm_enabled = 1) kalicilastirir.
  Ters sirada bu bilgi geri donulmez sekilde kaybolurdu.
- **Neden kolonu nullable uc-durumlu yapmiyoruz**: `alarm_enabled` NOT NULL
  DEFAULT 0 olarak duruyor; NULL kabul eden bir hale getirmek tabloyu yeniden
  kurmayi gerektirir, v8/v9/v11 dersi tam olarak "yeniden kurmak satir riskidir"
  diyor. Ayri kolon, ADD COLUMN ile risksiz.
- **Kolonun okuyuculari** (olu kolon degildir): (a) bu migration'in kendi
  filtresi, (b) satir rozeti / duzenleme sayfasi kullanicinin dokundugunu
  isaretler, (c) ileride varsayilan tekrar degisirse (ornegin Android
  full-screen dalgasinda) ayni koruma tekrar kullanilir.
- **Idempotans**: kolon kontrolu transaction DISINDA PRAGMA table_info ile
  yapilir (migrateToV8/V13/V15/V16/V19/V20 deseni); kolon zaten varsa ADD
  atlanir. user_version damgasi zaten ikinci calismayi engeller; UPDATE'ler
  tekrar calissa bile isaretli satirlara dokunmaz.
- **Taze kurulum**: createSchemaV1 yolunda kolon kosulsuz eklenir; tablo bos
  oldugundan UPDATE'ler no-op, DDL iki yolda birebir ayni.
- **Profil kapsami**: v19'un `profile_id` runtime devri (adoptOrphanReminders)
  ile hicbir etkilesim yok; v21 profil bilmez, tum satirlara ayni kurali uygular.

## 7. i18n anahtarlari (9 dil: en/tr/de/fr/es/it/pt/ar/ja)

Hitap kurallari CLAUDE.md'deki gibi: de Sie/Ihr, fr vous/votre, es usted/su,
tr cogul-nazik, it Lei/Suo, pt voce/sua (pt-BR), ar resmi MSA, ja teineigo.
Yuzde/para yok, upper() gerekmiyor.

| Anahtar | en | tr |
| --- | --- | --- |
| reminders.modeAlarm | Alarm | Alarm |
| reminders.modeNotification | Notification | Bildirim |
| reminders.modeHint | Choose how each reminder reaches you. | Her hatırlatıcının size nasıl geleceğini seçin. |
| reminders.alarmDefaultHint | New reminders ring as a real alarm. You can switch any of them to a notification. | Yeni hatırlatıcılar gerçek alarm olarak çalar. İstediğinizi bildirime çevirebilirsiniz. |
| reminders.alarmPermissionHint | Allow the alarm permission so the reminders you set up can ring as real alarms. | Kurduğunuz hatırlatıcıların gerçek alarm olarak çalması için alarm iznini verin. |
| settings.postMealAlarm | Post-meal timer as an alarm | Tokluk sayacı alarm olarak |
| settings.postMealAlarmHint | When the countdown ends, a real alarm rings instead of a notification arriving. | Sayaç bittiğinde bildirim yerine gerçek alarm çalar. |
| onboarding.alarmNote | If you allow it, the reminder you set up rings as a real alarm. | İzin verirseniz kurduğunuz hatırlatıcı gerçek alarm olarak çalar. |
| alarmTour.step1Title | Your reminders can ring now | Hatırlatıcılarınız artık çalabilir |
| alarmTour.step1Body | A reminder you set up rings as a real alarm: full screen, with the system's own stop control. | Kurduğunuz hatırlatıcı gerçek alarm olarak çalar: tam ekran ve sistemin kendi durdurma ekranıyla. |
| alarmTour.step2Title | Alarm permission | Alarm izni |
| alarmTour.step2Body | iOS asks for this once. Without it your reminders keep arriving as notifications. | iOS bunu bir kez sorar. İzin olmadan hatırlatıcılarınız bildirim olarak gelmeye devam eder. |
| alarmTour.step2Cta | Allow | İzin ver |
| alarmTour.step3Title | You decide, reminder by reminder | Her hatırlatıcı için siz karar verirsiniz |
| alarmTour.step3Body | In My reminders you can switch any reminder between alarm and notification. | Hatırlatıcılarım'da her hatırlatıcıyı alarm ile bildirim arasında değiştirebilirsiniz. |
| alarmTour.step3Cta | Open my reminders | Hatırlatıcılarıma git |
| alarmTour.next | Continue | Devam |
| alarmTour.skip | Not now | Şimdi değil |

Mevcut ve YENIDEN KULLANILAN anahtarlar (yeni metin yazilmaz):
`reminders.playAsAlarm`, `reminders.alarmPermissionDenied`,
`reminders.alarmStopButton`, `settings.openSystemSettings`,
`notifications.postmealTitle`.

## 8. Native / app.json / store

24. **app.json + ios-locales/*.json (9 metin)**: `NSAlarmKitUsageDescription`
    metni artik yanlis ("only for the reminders where you turn this on").
    Yeni cerceve: "kurdugunuz hatirlaticilar gercek alarm olarak calabilsin
    diye; her hatirlatici icin bunu kapatabilirsiniz". app.json'daki en metni +
    ios-locales/{tr,de,fr,es,it,pt,ar,ja}.json. i18n-check bu dosyalari zaten
    denetliyor.
25. **app.json surum**: `version` 2.3.0, `ios.buildNumber` ve
    `android.versionCode` bir artar. package.json version 2.3.0.
26. **prebuild/build**: native modul degistigi icin `npx expo prebuild` + yeni
    build ZORUNLU. Build ve cihaz QA kullanicidadir, ajan calistirmaz.
27. **Surum notlari (9 dil)**: tek satir, "Kurdugunuz hatirlaticilar iOS 26'da
    gercek alarm olarak calabilir; tokluk sayaci icin de secilebilir."
    Apple review notu: alarms are user-created, fixed-time reminders and a
    user-started countdown timer via AlarmKit; no value-triggered alarm exists
    in the app; Critical Alerts are not used; every alarm can be switched back
    to a notification per reminder.

## 9. Testler (kapilar: npm run typecheck, npm run i18n:check, scripts/*.test.ts)

28. **scripts/alarmSelect.test.ts genisler**:
    - E: `alarmModeOf` sekiz kombinasyonda `shouldUseAlarm` ile birebir ayni
      karari verir ("alarm" ancak ucu de true iken).
    - F: tokluk cagricisi senaryosu, `alarmEnabled` yerine `postMealAlarm`
      gecildiginde ayni uc'lu AND (tercih acik + AlarmKit var + yetkili).
    - G: yetkisiz cihazda mod her zaman "notification" (rozetin yalan
      soylememesi kuralinin testi).
29. **scripts/migration.test.ts genisler** (M-deseni, bolum harfi Q):
    - Q. v21 sema sekli: `alarm_user_set` kolonu var, NOT NULL DEFAULT 0.
    - Q2. Idempotans: migrateToV21 iki kez calisir, kolon tek, damga 21.
    - Q3. Ifadeler + taze kurulum esdegerligi: migre edilmis reminders DDL'i
      createSchemaV1'in urettigiyle birebir.
    - Q4. Varsayilan cevrimi: alarm_enabled=1 olan satir (1,1) olur ve oyle
      kalir; alarm_enabled=0 olan satir (1,0) olur; migration sonrasi eklenen
      satir ikinci calismada degismez.
    - K1 zinciri 21'e kadar uzatilir, her baslangic surumunden satir kaybi yok.
30. **Yeni saf modul testi gerekmez**: B karari yeni karar fonksiyonu
    getirmiyor, mevcut lib/alarmSelect.ts tek tanim olarak kaliyor.

## 10. Cihaz QA senaryolari (kullanici, gercek iOS 26 cihaz + bir eski iOS + bir Android)

1. 2.2.0'dan guncelleme: mevcut hatirlaticilar listede "Alarm" rozetiyle
   gorunuyor, saatleri ve siralari degismemis.
2. 2.2.0'da "Alarm olarak cal" acik birakilan satir hala alarm; kapali olan
   satir alarma cevrilmis ve rozetten tek dokunusla bildirime donuyor.
3. Tur: guncellemeden sonra BIR KEZ aciliyor, kapatip uygulamayi yeniden
   baslatinca tekrar acilmiyor; temiz kurulumda (onboarding'i bitirince) hic
   acilmiyor.
4. Tur 2. adimda izin ver -> hatirlatici saatinde tam ekran alarm; reddet ->
   ayarlar linki, hatirlatici bildirim olarak geliyor.
5. Onboarding: olcum hatirlaticisi "Kur" sonrasi once bildirim, hemen ardindan
   alarm izni soruluyor; "Simdi degil" secildiginde alarm izni HIC sorulmuyor.
6. Satir rozetiyle alarm -> bildirim -> alarm gecisleri: hicbir gecisde ayni
   hatirlatici hem calip hem bildirim dusurmuyor.
7. Sessiz mod ve Uyku Focus'ta alarm calisi; sistem durdurma ekrani calisiyor.
8. Uygulama oldurulmusken ve cihaz yeniden baslatildiktan sonra alarm hala
   calisiyor.
9. Tokluk: Ayarlar'da "Alarm olarak" acik iken (VARSAYILAN) "Yemeye basladim"
   -> sure sonunda gercek alarm; bildirim GELMIYOR; kilit ekraninda iki ayri
   sayac karti gorunmuyor.
9b. Sistem sayac kartinin gorunumu: kilit ekraninda ve Dynamic Island'da
   AlarmKit'in kendi countdown karti okunakli, marka rengi (tint) dogru,
   basligi dogru dilde. Kabul edilemez gorunurse geri alma tek satir
   (DEFAULT_PREFS.postMealAlarm = false) ve bizim markali kartimiz geri gelir.
9c. Alarm modu KAPALIYKEN (kullanici bildirime cevirdiginde) eski akis aynen:
   markali PostMealActivity karti + bildirim, sayac ayni anda bitiyor.
10. Tokluk alarm modu acikken sayaci elle iptal / erken olcum kaydi ->
    alarm da iptal oluyor, sure sonunda hicbir sey calmiyor.
11. Tokluk sayaci calisirken modu Ayarlar'dan degistirmek: kalan sure ayni
    kaliyor, yeni modda calisiyor (bitis ani kaymiyor).
12. Tokluk penceresini (60/90/120/150) calisan sayac uzerinde degistirmek:
    mevcut davranis bozulmamis.
13. Dil degisimi: alarm basligi ve durdurma dugmesi yeni dilde; calisan tokluk
    timer'i yeni dilde ve ayni bitis aniyla yeniden kuruluyor.
14. Coklu profil: profil degistirince diger profilin alarmlari susuyor
    (applyReminders yetim supurgesi), tokluk sayaci sahibi profilde kaliyor.
15. iOS<26 cihaz ve Android: rozet, mod secici, tokluk alarm anahtari ve tur
    HIC gorunmuyor; her sey bildirim olarak calisiyor.
16. Dusuk-sonrasi takip: hicbir ekranda alarm secenegi YOK, bildirim olarak
    geliyor (regulasyon kontrolu).
17. AlarmKit izni sistem ayarlarindan geri alindiginda: uygulama bir sonraki
    apply'da sessizce bildirime dusuyor, hicbir hatirlatici kaybolmuyor. Tokluk
    sayaci CALISIRKEN izni geri al ve uygulamayi one getir: kalan sure icin
    bildirim kuruluyor ve markali sayac karti geri geliyor, sure sonunda tek
    bir teslim var (ne sessizlik ne cift).
18. Alarm modunda calisan tokluk sayacini SISTEM kartindan iptal et: bilinen
    sinir (bolum 14) dogrulanacak - panodaki sayac calismaya devam eder, sure
    sonunda hicbir sey calmaz. Rahatsiz edici cikarsa 2.4.0 icin modulden geri
    cagirim notu.

## 11. Riskler

- **R1. AlarmKit countdown kendi Live Activity'sini cizer**: tokluk alarm
  modunda bizim markali PostMealActivity karti devre disi birakiliyor (madde
  13). Varsayilan acik oldugu icin bu risk artik her kullaniciya dokunuyor
  (karar 0.B). Cihazda sistem karti kabul edilemez cikarsa: (a) DEFAULT_PREFS
  tek satiriyla opt-in'e donmek, (b) B'yi tamamen ertelemek. Bizim kartimizi ve
  sistem kartini AYNI ANDA acik birakmak kabul edilmez.
- **R2. Varsayilan cevrimi gurultu olarak algilanabilir**: 2.2.0'da alarmi
  bilincli kapatan kullanici 2.3.0'da alarm alir. Telafi: tur + satir rozeti.
  Geri alma maliyeti tek satir: v21Sql'deki `V21_DEFAULT_TO_ALARM` ifadesini
  cikarmak (kolon ve isaretleme kalir, yeni satirlar yine alarm dogar).
- **R3. Apple review**: varsayilan acik alarm + kullanim aciklamasi metni.
  Azaltma: madde 24 metin duzeltmesi, madde 27 review notu, deger-tetiklemeli
  hicbir alarm olmamasi (bolum 1).
- **R4. Countdown API adlari dogrulanmadi**: bu ortamda iOS 26 SDK yok, 2.2.0'da
  `cancel(id:)` ve `alarms` gerceklerinin ilk derlemede cikmasi gibi bir tur
  daha duzeltme beklenmeli. Azaltma: modulun asla-throw-etmez sozlesmesi,
  false donunce bildirime dusme.
- **R5. Bir kullanicinin ayni anda cok alarmi olmasi**: profil basina 10
  hatirlatici x profil sayisi + tokluk timer'i. AlarmKit sinirlari belgesiz;
  QA'da coklu profil senaryosu (madde 14) bunu zorlar.
- **R6. Tek izin, toplu etki**: izin verildigi anda TUM satirlar alarma gecer
  (varsayilan tercih 1 oldugu icin). Bilincli bir karar; tur ve rozet bunu
  gorunur kiliyor, ama izin diyalogunun oncesindeki metnin bunu soylemesi sart
  (madde 8, 18, 21).
- **R7. Android/iOS<26'da alarm_enabled=1**: tercih platformdan bagimsiz
  saklandigi icin UI'nin `isAlarmKitAvailable()` kapisini KACIRMASI durumunda
  yanlis rozet cikar. Madde 7 bunu tek yere (alarmModeOf + availability)
  baglar; kod denetiminde acikca kontrol edilir.

## 12. Dalga taslagi (dosya cakismasiz)

- **D1**: v21 (lib/db/v21Sql.ts, migrations.ts, index.ts, types.ts,
  reminders.ts) + lib/alarmSelect.ts alarmModeOf + migration/alarmSelect
  testleri.
- **D2**: native timer (modules/zerospike-alarmkit Swift + index.ts) +
  lib/services/notifications.ts tokluk dallanmasi + notificationPrefs +
  app/settings/notifications.tsx.
- **D3**: UI (app/settings/reminders.tsx rozeti, components/ReminderEditSheet.tsx)
  + onboarding (app/onboarding.tsx) + tur (lib/services/alarmTour.ts,
  app/alarm-tour.tsx, app/_layout.tsx, AppContext).
- **D4**: 9 dil stringleri + ios-locales/app.json metinleri + surum notlari +
  review notu + kapilar (typecheck, i18n:check, tum scripts/*.test.ts) + surum
  bump + commit. Build, cihaz QA ve store yuklemesi kullanicida.

## 13. Uygulama sirasinda alinan ek kararlar (2026-08-23)

Plani degistirmeyen ama plandaki maddelerde yazmayan, kodda gerekli cikan uc
karar:

- **Tokluk alarmi yetim supurgesine yakalanmamali**: `POSTMEAL_ALARM_ID` de
  "zerospike-alarm-" onekini tasidigi icin applyReminders'in
  `listScheduledAlarmIds()` supurgesi onu hicbir satir sahiplenmedigi icin
  IPTAL EDERDI (profil degisimi, ayar kaydi, uygulama acilisi calisan sayaci
  oldururdu). Supurge bu tek id'yi atliyor; yasam dongusu yalniz
  schedulePostMealAt / cancelPostMealTimer / completePostMealTimer'da.
- **v21'in iki UPDATE'i yalniz kolonu EKLEYEN calismada kosar**
  (`missing.length > 0` kosulu). user_version damgasi tek basina yetmiyor: eski
  bir surume dusup geri cikan cihaz (K4 senaryosu) migrasyonu tekrar kosar ve
  ikinci calisma, uygulamanin kendi yazdigi varsayilan satirlari "kullanici
  sectti" diye isaretleyip gelecekteki her varsayilan degisikligine kapatirdi.
- **completePostMealTimer alarmi IPTAL ETMEZ**: sayacin bitmesi zaten alarmin
  caldigi andir; bu fonksiyon hem panodaki tick'ten hem de getPostMealTimerEnd
  okumasindan cagriliyor, iptal etseydi kullanicinin sectigi tek teslimi
  susturabilirdi. Kimlik sizmasi yok: bir sonraki kurulum ayni id'yi
  cancel-then-schedule ile devraliyor. Erken bitirmede (cancelPostMealTimer)
  iptal duruyor.
- **Legacy koprusu de alarm dogurur**: bridgeLegacyReminders artik
  `alarm_enabled = 1` yaziyor (alarm_user_set 0 kaliyor). Kopru v21'den SONRA,
  calisma zamaninda kosuyor; 1 yazmasaydi 2.1.x'ten guncelleyen kullanicinin
  bazal/ilac/olcum satirlari cihazdaki diger her satir calarken bildirim olarak
  kalirdi.

## 14. Bilinen sinirlar (denetimden cikti; aksi belirtilmedikce DEGISTIRILMEDI)

- **Alarm teslimi hala bildirim iznine bagli**: applyReminders'in `granted`
  kapisi (prefs.enabled + OS bildirim izni) 2.2.0'dan devralindi ve madde 9
  geregi dokunulmadi. Sonuc: iOS 26'da AlarmKit iznini verip bildirim iznini
  reddeden kullanicida hicbir hatirlatici calmaz. Varsayilan alarm oldugu icin
  bu kapi artik daha gorunur; 2.4.0 adayi olarak not.
- **Yalniz bazal hatirlatici kuran yeni kullanici onboarding'de AlarmKit izni
  gormez**: izin yalniz medReminder/glucoseReminder "Kur" akislarinda isteniyor
  (karar 0.C). Bazal satiri finishToReveal icinde syncBasalReminderRow ile
  yaziliyor, oraya sistem diyalogu koymak tamamlama animasyonunun ortasina
  denk gelirdi. Satir alarm olarak kayitli kalir, bildirim olarak gelir,
  Ayarlar > Hatirlaticilar rozetine dokunmak izni ister.
- **Rozet iki dar durumda gercegi soylemez**: rozet artik SAKLANAN niyeti
  gosteriyor ve yetkisiz cihazda "Alarm (izin gerekli)" diye ucuncu bir durum
  aciyor (denetim sonrasi duzeltme), ama (a) ana bildirim anahtari kapaliyken
  yine "Alarm" der (ekran NotificationPrefs okumuyor), (b) ekran acikken
  sistem ayarlarindan AlarmKit izni geri alinirsa rozet bir sonraki degisiklige
  kadar tazelenmez. Ikisi de yalnizca gorsel, zamanlama dogru kalir.
- **Tokluk alarm kimliginin tek toplayicisi bir sonraki kurulum**: yetim
  supurgesi `POSTMEAL_ALARM_ID`'yi bilincli atliyor (madde 13), yani o kimligi
  toplayan tek yer `cancelPostMealTimer` ile `schedulePostMealAt`'in kendi
  cancel-then-schedule'i. Native `cancel` hata verirse (modulun sozlesmesi
  geregi sessizce yutulur) kurulu kalan alarm hicbir supurgeye yakalanmaz;
  yalnizca bir sonraki tokluk sayaci kurulumu ayni kimligi devralarak temizler.
  Kabul edilen sinir: alternatifi supurgeyi acmak, o da calisan sayaci her
  apply'da oldururdu.
- **Sistem sayac kartindan yapilan iptal dinlenmiyor**: alarm modunda countdown
  AlarmKit'in kendi kartinda duruyor; kullanici oradan alarmi iptal ederse
  uygulama bunu HIC ogrenmiyor (modulde geri cagirim yok). Sonuc: panodaki
  sayac ve saklanan bitis ani calismaya devam eder, sure sonunda hicbir sey
  calmaz ve sayac normal sekilde kapanir. Ters yon guvenli: uygulamadan iptal
  (cancelPostMealTimer) alarmi da indirir. Cihaz QA maddesi 18.
