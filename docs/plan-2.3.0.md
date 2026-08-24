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
9b. **[KAPSAM 2 / K2-F ile degisti]** Sistem sayac karti ARTIK YOK. Alarm
   modunda kilit ekraninda ve Dynamic Island'da yalnizca BIZIM markali
   PostMealActivity kartimiz gorunur; AlarmKit'in kendi geri sayim karti hic
   cikmaz. Bkz. bolum 15.10 madde 19.
9c. Alarm modu KAPALIYKEN (kullanici bildirime cevirdiginde) akis aynen:
   markali PostMealActivity karti + bildirim, sayac ayni anda bitiyor. Alarm
   modunda tek fark teslimdir: ayni kart, sonunda bildirim yerine alarm.
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
  gormez**: izin yalniz medReminder ve reminderPlan ("Duzeni kur") akislarinda
  isteniyor (karar 0.C, Kapsam 2'de glucoseReminder adiminin yerini reminderPlan
  aldi). Bazal satiri finishToReveal icinde syncBasalReminderRow ile yaziliyor,
  oraya sistem diyalogu koymak tamamlama animasyonunun ortasina denk gelirdi.
  Satir alarm olarak kayitli kalir, bildirim olarak gelir, Ayarlar >
  Hatirlaticilar rozetine dokunmak izni ister.
- **[KAPSAM 2 / R12 kapandi] Widget glukoz kisayolu**: `?sheet=glucose` artik
  app/(tabs)/index.tsx'te ACIKCA taniniyor ve formu, uygulama ici hizli ekleme
  dugmesiyle ayni tek sabitten (`DEFAULT_LOG_PERIOD`) aciyor; deep link tarafi
  degismedi. Tanimlanmayan bir `sheet` degeri artik hicbir form acmiyor
  (eskiden else kolu her degeri "aclik" formuna ceviriyordu). Varsayilan hala
  "fasting", ama tek yerde ve iki yuzey icin ayni; degistirilecekse o sabit
  degisir.
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
  **[KAPSAM 2 / K2-F ILE DUSTU]**: countdown timer'i tek seferlik sabit alarma
  cevrildigi icin ortada bir sistem sayac karti kalmiyor, dolayisiyla bu sinirin
  dayanagi da yok. Bolum 15.6.

# KAPSAM 2 (onay: 2026-08-24, build alinmadan kapsam genislemesi)

Yukaridaki 1-14. bolumler UYGULANDI (84d1b15 + e3e4a14) ve build beklerken
kapsam buyudu. Asagisi onun UZERINE gelir: uygulanmis maddelere dokunulmaz,
DEGISEN davranislar **[DEGISIM]** etiketiyle isaretlenir. Is maddesi numaralari
31'den devam eder. Bolum 1'deki sert sinirlar aynen gecerlidir ve Kapsam 2'de
hicbiri gevsetilmez.

## 15.0 Kritik tasarim kararlari (Kapsam 2 ozeti)

- **K2-A / kaynak**: yaklasan liste OS kuyruklarindan degil, reminders
  TABLOSUNDAN hesaplanir (saf modul), teslim ikonu `alarmModeOf`'tan gelir;
  kapsam kullanicinin kurdugu satirlar + calisan tokluk sayacidir, haftalik ozet
  ve bos gunluk bilincli olarak DISARIDA.
- **K2-B / alarm dokunusu**: AlarmKit alarmina ikinci dugme (`secondaryButtonBehavior:
  .custom` + `secondaryIntent`) eklenip App Group uzerinden rota birakilarak
  ilgili ekrana dusulur; Xcode 26'da derlenmezse sinir olarak yazilir ve alarm
  bugunku gibi yalniz "Durdur" ile kapanir.
- **K2-C / sure secici**: birincil buton varsayilan pencereyi (120) kullanir,
  ikincil kucuk buton tek seferlik sure secer (cip 60/90/120/150/180 + serbest
  15 dk adim); secim AYARI DEGISTIRMEZ, yalniz o sayaci kurar.
- **K2-D / onboarding**: tokluk sorusu tamamen kalkar, herkes 120 ile baslar,
  gestasyonelin sessiz 60 turetmesi de kalkar (soru yokken kullaniciya
  gosterilmeyen bir tibbi cikarim olurdu), pencere ayari Ayarlar'da kalir.
- **K2-E / hazir duzen**: onboarding'in tek saatlik "olcum hatirlaticisi" adimi
  (2.2.0 C8) yerini tani tipine gore hazirlanmis 2-4 satirlik ONIZLEMELI duzene
  birakir; ekranda tip adi ve siklik onerisi dili GECMEZ, cerceve "baslangic
  icin hazir bir duzen"dir; izin anlari bu adima taşinir.
- **K2-F / LA politikasi [DEGISIM]**: Apple'in sistem geri sayim karti
  istenmiyor; countdown timer kaldirilir, yerine bitis anina kurulan TEK
  SEFERLIK sabit AlarmKit alarmi gelir ve markali PostMealActivity HER modda
  yasar; alarm yalniz ses ve tam ekran teslimi ekler.

## 15.1 K2-A. Yaklasan hatirlaticilar gorunumu

31. **lib/upcomingReminders.ts (yeni, saf modul)**: `nextOccurrenceAt(hhmm,
    now)` (bugunun saati gectiyse yarina taşir) ve `buildUpcoming(input):
    UpcomingItem[]`. `UpcomingItem = { kind: "reminder" | "postMeal"; id: string;
    at: number; mode: "alarm" | "notification"; type?: ReminderType; label?: string }`.
    Girdiler cagirandan gelir: satirlar, `now`, `windowMs` (24 saat), kapilar
    (`granted`, `showsBasal`, `showsMeds`), AlarmKit ucusu (`alarmKitAvailable`,
    `alarmAuthorized`) ve calisan tokluk sayacinin bitisi. Saat/lokal yok,
    lib/postMealTimer.ts ve lib/alarmSelect.ts ile ayni bagimsizlik sozlesmesi.
32. **Kaynak karari (gerekce)**: hesap TABLODAN yapilir, `getAllScheduledNotificationsAsync()`
    + `listScheduledAlarmIds()` cifti kullanilmaz. Sebepler: (a)
    `listScheduledAlarmIds()` yalniz kimlik dondurur, saat tasimaz
    (modules/zerospike-alarmkit/index.ts:132), yani alarm satirlarinin ne zaman
    calacagi oradan OGRENILEMEZ; (b) expo'nun DAILY tetikleyicisinin okunan
    sekli platforma gore degisir, ayni ekrani iki platformda ayni gostermek
    icin yeniden normalize etmek gerekirdi; (c) tablo zaten applyReminders'in
    tek dogruluk kaynagi, ayni kapilarla hesaplanan liste ile gercek teslim
    arasinda ikinci bir gercek olusmaz; (d) saf hesap Node testine girer.
    Teslim ikonu satirdan degil `alarmModeOf` (lib/alarmSelect.ts:44) uzerinden
    alinir, boylece liste yetkisiz cihazda "alarm" iddia edemez.
33. **Kapsam karari (gerekce)**: listeye YALNIZ kullanicinin kurdugu hatirlatici
    satirlari ve calisan tokluk sayaci girer. Haftalik ozet, bos gunluk, deneme
    ve dusuk-sonrasi takip DISARIDA: ilk ucu kullanicinin kurdugu hatirlatici
    degil uygulamanin kendi durum bildirimidir, dordunculeri listeye koymak ise
    deger-tetiklemeli bir teslimi "yaklasan alarm" gibi gostermek olur ve bolum
    1'deki cizgiyi bulanikltirir.
34. **components/settingsUi.tsx**: `Row`'a opsiyonel `sub?: string` eklenir
    (etiketin altinda tek satir, `THEME.muted`). Mevcut cagiranlar etkilenmez.
35. **app/settings/reminders.tsx**: (a) liste basina "Siradaki" karti,
    onumuzdeki 24 saatin birlesik listesi, en fazla 6 satir + kalan sayisi;
    her satirda saat, tur adi ve teslim ikonu (`alarm` / `notifications-outline`);
    (b) her hatirlatici satirinda `sub` ile "siradaki: bugun 22:00". Kart
    bildirim izni yokken GIZLENIR (mevcut izin banner'i zaten o durumu
    anlatiyor) ve satirlar zaten kapali olan hatirlaticilari icermez.
36. **Tazeleme**: kart `afterChange()` ve ekran odaginda yeniden hesaplanir;
    surekli tick YOK (saatler oturum icinde sabit). Gece yarisi "bugun/yarin"
    etiketinin kaymasi kabul edilen sinirdir, bir sonraki odakta duzelir.
37. **Bicimleme**: satir saatleri tabloda zaten "HH:MM" olarak duruyor ve ekranda
    bugun de oyle gosteriliyor, aynen kullanilir; tokluk sayaci girdisi epoch
    oldugu icin `formatTimeForLang` (lib/format.ts:55) ile bicimlenir. Gun
    etiketi `reminders.nextToday` / `reminders.nextTomorrow`.

## 15.2 K2-B. Deep link denetimi ve tamamlama

Denetim ciktisi (ONCE = denetim ani, SONRA = 2026-08-24 uygulamasi):

| Yuzey | ONCE | SONRA |
| --- | --- | --- |
| Bildirim rotalari (postMeal/glucose/basal/med/weekly/trial/lowFollowup) | Var, app/_layout.tsx:80-108 | Degismedi |
| Ozel (custom) hatirlatici bildirimi | **Rota YOK** | `route: "custom"` -> pano, SHEET'SIZ (notifications.ts reminderContent + _layout `case "custom"`) |
| Bos gunluk (idle) bildirimi | Pano + aclik olcum sheet'i | **[DEGISIM]** pano, SHEET'SIZ (_layout `case "idle"`, custom ile ayni kol) |
| QuickAdd iOS widget | Tam ama 4 literal URL | `DeepLinks.addGlucose/addMeal/addInjection/addMed` (QuickAdd.swift:81/88/98/109) |
| Ana iOS widget | systemSmall/Medium yalniz `zerospike:///` | **[DEGISIM]** her aile `DeepLinks.addGlucose` (index.swift `tapURL`) |
| PostMealActivity (kilit ekrani + Dynamic Island) | **Deep link YOK** | `.widgetURL(DeepLinks.postMeal2h)` iki yerde: kart govdesi + DynamicIsland (keylineTint'in yaninda) |
| Android QuickAdd widget | Tam | Degismedi |
| Android ana widget | Kok view `URI_DASHBOARD` | **[DEGISIM]** `URI_ADD_GLUCOSE` (androidWidget.ts, iOS ile simetri); `URI_DASHBOARD` sabiti tamamen kalkti |
| AlarmKit alarmi | Yalniz sistem "Durdur" | "Ac" ikinci dugmesi -> `ZerospikeAlarmOpenIntent` App Group'a rota yazar, `takePendingAlarmRoute()` + _layout AppState "active" ayni `routeForNotification`a verir |
| Scheme sabiti | Swift'te 6 literal | `targets/widget/DeepLinks.swift` (6 sabit), JS tarafi androidWidget.ts ile birebir ayni metinler |
| watchOS complication | URL tasiyamaz | Degismedi (madde 45b, kabul edilen sinir) |

38. **lib/services/notifications.ts**: `NotificationRoute` birligine `"custom"`
    eklenir ve `reminderContent`'in custom kolu `data: { route: "custom" }`
    yazar. app/_layout.tsx'te `case "custom"` panoyu SHEET ACMADAN acar: ozel
    hatirlaticinin ne hakkinda oldugunu uygulama bilmez, bir kayit formunu
    varsaymak yanlis olur.
39. **[DEGISIM] Bos gunluk rotasi**: `case "idle"` bugun `sheet: "glucose"` ile
    aclik olcum formunu aciyor (app/_layout.tsx:92-94); panoya SHEET'SIZ
    yonlendirmeye cevrilir. Gerekce: nudge "gunlugunuz bos" diyor, ne
    ekleyecegini kullanici secer (glukoz / yemek / ilac); sabit bir form
    varsayim uretir. Diger rotalar aynen kalir.
40. **targets/widget/DeepLinks.swift (yeni)**: tek yerde `static let` sabitleri
    (`dashboard`, `addGlucose`, `addMeal`, `addInjection`, `addMed`,
    `postMeal2h`), JS tarafindaki lib/services/androidWidget.ts:31-35 ile
    birebir ayni metinler. QuickAdd.swift, index.swift ve PostMealActivity.swift
    literal yerine buradan okur.
41. **targets/widget/PostMealActivity.swift**: kilit ekrani icerigine
    `.widgetURL(DeepLinks.postMeal2h)` ve Dynamic Island genisletilmis bolgesine
    ayni hedef. Boylece sayac kartina dokunmak tokluk olcum sheet'ini acar
    (altyapi hazir: app/(tabs)/index.tsx:415-428).
42. **targets/widget/index.swift**: `tapURL`'in systemSmall/Medium kolu
    `DeepLinks.addGlucose` olur (accessory ile ayni). Gerekce: widget bir
    kayit kisayolu; "sadece uygulamayi ac" davranisi accessory ile tutarsizdi.
43. **lib/services/androidWidget.ts:190-191**: ana widget kok view'inin
    `clickActionData.uri` degeri `URI_ADD_GLUCOSE` olur (iOS ile simetri).
44. **AlarmKit alarm dokunusu (arastirma sonucu, uygulanacak tasarim)**:
    `AlarmPresentation.Alert(title:stopButton:secondaryButton:secondaryButtonBehavior:)`
    ile ikinci dugme eklenir, davranis `.custom`, ve
    `AlarmManager.AlarmConfiguration(..., secondaryIntent:)` bir `LiveActivityIntent`
    alir. iOS 26'da `openAppWhenRun` KULLANILMAZ (deprecated), yerine
    `static var supportedModes: IntentModes = .foreground(.immediate)`.
    Uygulama: modules/zerospike-alarmkit/ios/ZerospikeAlarmOpenIntent.swift
    (yeni) `perform()` icinde App Group UserDefaults'a
    (`group.com.greeneyeapp.zerospike`, targets/widget/LiveData.swift:84 ile
    ayni) `zerospike.pendingAlarmRoute` yazar ve uygulamayi one getirir. Modulun
    `scheduleDailyAlarm` / `scheduleOneShotAlarm` imzalarina `route: String`
    eklenir (hatirlatici turunden turetilir: basal/med/glucose/custom, tokluk
    icin postMeal). JS'e yeni senkron `takePendingAlarmRoute(): string | null`
    (okur ve siler), app/_layout.tsx AppState "active" gecisinde okuyup mevcut
    `routeForNotification`'a verir. Yeni i18n: `reminders.alarmOpenButton`.
45. **Sinir (K2-B kapsaminda kabul edilen)**: (a) ikinci dugme API'si Xcode
    26'da bu sekilde derlenmezse alarm bugunku gibi yalniz "Durdur" tasir,
    uygulama acilmaz, HUMAN-TODO maddesi olur ve baska hicbir sey bozulmaz
    (modulun asla-throw-etmez sozlesmesi); (b) watchOS complication'lari
    (targets/watch-widget) URL tasiyamaz, dokunma yalniz saat uygulamasini
    acar; (c) onboarding tamamlanmamis kullanicida cold-start deep link'i
    onboarding yonlendirmesine takilir (app/_layout.tsx:353-360), widget
    ancak kurulumdan sonra eklenebildigi icin gercekte ulasilmaz, degistirilmez.

## 15.3 K2-C. Tokluk cift buton ve GECIKME TELAFISI

> **[DEGISIM 2026-08-24 / G15, kullanici karari]** Bu bolumun ilk hali "sure
> secici" idi (60/90/120/150/180 cipleri, serbest sure, kalici pencere ayari).
> Kullanici karari: pencere HER ZAMAN 120 dakika, degistirilemez. Ikincil
> butonun tek isi gecikme telafisidir: "yemege basladigimi kaydetmeyi unuttum,
> X dakika gecti". Sayac 120 - X dakikaya kurulur ve `startedAt` GERIYE yazilir,
> boylece Live Activity, ilerleme cubugu ve olcum ani fizyolojik olarak dogru
> kalir. X >= 120 ise sayac KURULMAZ, kisa aciklama gosterilir ve kullanici
> dogrudan olcum kaydina yonlendirilir.
>
> Sonuclar: (a) Ayarlar'daki 60/90/120/150 secicisi KALKTI, yerine tek satirlik
> "olcum her zaman yemekten 120 dk sonradir" notu geldi; (b)
> `applyPostMealWindowChange` ve `retimePostMealWindow` artik ulasilamaz oldugu
> icin SILINDI; (c) ozel-sure bayragi (`POSTMEAL_TIMER_CUSTOM_KEY`) da silindi -
> tek okuyucusu (b)'ydi ve pencere degisemedigine gore koruyacak bir sey
> kalmadi; (d) `NotificationPrefs.postMealMinutes` artik OKUNMUYOR,
> `lowThresholdMgdl` gibi yalniz saklanmis degerin ayristirilabilmesi icin
> duruyor; tek gercek `POST_MEAL_WINDOW_MIN = 120`.
>
> Saf mantik: `startPostMealLate({ minutesAgo, now })` (lib/postMealTimer.ts) ve
> `clampPostMealLateMinutes` (0-240; 240'a kadar cikar ki "cok gec" durumu
> KULLANICI ICIN ULASILABILIR olsun). Sheet: components/PostMealLateSheet.tsx
> (5/10/15/20/30 dk once cipleri + 5 dk adimli serbest secim).

### 15.3.1 Ilk hali (uygulanmadi, kayit icin)

46. **lib/postMealTimer.ts**: saf `clampPostMealMinutes(n: number): number`
    (tam sayiya yuvarlar, 5-360 araligina kirpar). Tek dogrulama noktasi.
47. **components/PostMealDurationSheet.tsx (yeni)**: alt sayfa (ReminderEditSheet
    ile ayni Modal dili). Icerik: cip sirasi 60/90/120/150/180 (mevcut
    `Segmented`), altinda "Ozel" acilinca 15 dk adimli artir/azalt kontrolu ve
    "Baslat" CTA. **UX gerekcesi**: karar tek bir sayidan ibaret, ayri ekran
    fazla; cipler vakalarin buyuk cogunlugunu tek dokunusta karsilar, serbest
    secenek 45 veya 180+ calisan kullanicilari disarida birakmamak icin var,
    15 dk adim ise klavye acmadan makul araligi tarar.
48. **app/(tabs)/index.tsx (yemek karti, 1499-1550 civari)**: birincil
    "Yemege basladim" pill'i AYNEN kalir ve `prefs.postMealMinutes` (varsayilan
    120) ile calisir; saginda DAHA KUCUK ikincil ikon buton (`timer-outline`,
    `accessibilityLabel = dashboard.postMealCustomA11y`) sure secici sayfayi
    acar. Sayac calisirken ikisi de gizlidir (mevcut davranis).
49. **lib/services/notifications.ts**: `startPostMealTimer(minutes?: number)`
    opsiyonel parametre alir; verilmezse bugunku gibi `prefs.postMealMinutes`.
    Deger `clampPostMealMinutes`'tan gecer.
50. **Tek seferlik sure ile ayar catismasi**: yeni AsyncStorage anahtari
    `zerospike.postMealTimerCustom`. Sure secicisinden kurulan sayac bunu
    yazar; `applyPostMealWindowChange` (Ayarlar'daki pencere degisimi) bayrak
    varken calisan sayaci YENIDEN OLCMEZ ve "idle" doner; `cancelPostMealTimer`
    ile `completePostMealTimer` bayragi siler. Gerekce: 180 dk'lik bilincli bir
    secim, Ayarlar'da pencere 90'a cekildiginde sessizce 90'a inmemeli.
51. **Ayarlar penceresi kalir**: app/settings/notifications.tsx'teki 60/90/120/150
    secici ve `postMealDelayRunningNote` aynen durur; varsayilan
    `DEFAULT_PREFS.postMealMinutes = 120` degismez.

## 15.4 K2-D. Onboarding'den tokluk adimi kaldirilir

52. **app/onboarding.tsx**: `StepId` birliginden `"postMeal"` (satir 125),
    `steps` dizisinden (satir 282), `POSTMEAL_MINUTE_OPTIONS` / `PostMealMinutes`
    (88-89), `postMealMinutes` state'i (234), `effectivePostMealMinutes` (256)
    ve adimin render kolu (948-960) ile ipucu kolu (514) kaldirilir.
53. **[DEGISIM] Gestasyonel 60 dk sessiz turetmesi kalkar**: soru ekrandan
    kalkinca `diabetes === "gestational" ? 60 : 120` kullaniciya hic
    gosterilmeyen bir tibbi cikarima donusurdu. Herkes 120 ile baslar, Ayarlar
    tek dokunusla degistirir. Geri istenirse tek satir.
54. **Profil kaydi**: onboarding'in bildirim tercihlerine `postMealMinutes`
    yazmasi (satir 478) kaldirilir; `DEFAULT_PREFS` zaten 120.
55. **Adim sayaci ve analitik**: `progress` steps.length'ten turedigi icin
    kendiliginden duzelir; `onboarding_step` olayi artik "postMeal" degeri
    uretmez (gecmis veri korunur, yeni akista bos kalir). Adim sayisi her yolda
    bir azalir, K2-E ile birlikte net degisim: postMeal ve glucoseReminder
    cikar, reminderPlan girer (bir adim net azalma).
56. **i18n temizligi**: `onboarding.qPostMeal` ve `onboarding.qPostMealHint`
    9 dilden silinir (kullanilmayan anahtar i18n-check'i kirmaz, ama semada
    olu metin birakmayiz).

## 15.5 K2-E. Tani tipine gore hazir hatirlatici duzeni

57. **lib/reminderPresets.ts (yeni, saf modul)**: `presetFor(type: DiabetesType):
    { type: "glucose"; time: string }[]`. Tipler lib/db/types.ts:71'deki
    birlikten: `type1 | type2 | gestational | prediabetes | unknown | none`.
    Yalniz OLCUM satiri uretir: bazal satirini `syncBasalReminderRow`, ilac
    satirini medReminder adimi zaten yonetiyor, ikisini burada tekrar uretmek
    cift satir demek olurdu.

    | Tip | Saatler | Satir |
    | --- | --- | --- |
    | type1 | 07:30, 12:30, 18:30, 22:30 | 4 |
    | gestational | 07:30, 10:00, 14:00, 20:30 | 4 |
    | type2 | 08:00, 13:00, 21:00 | 3 |
    | prediabetes | 08:00, 13:00, 20:00 | 3 |
    | unknown / none | 08:00, 13:00, 20:00 | 3 |

    Saatler notr saat dilimleridir; hicbiri "kahvaltidan 2 saat sonra" gibi bir
    klinik cerceveye baglanmaz ve ekranda oyle anlatilmaz. En kalabalik duzen
    4 satir, bazal + ilac ile birlikte bile MAX_REMINDERS = 10 tavaninin
    altinda.
58. **[DEGISIM] app/onboarding.tsx / adim degisimi**: 2.2.0'in tek saatlik
    `glucoseReminder` adimi (C8, satir 573 `setupGlucoseReminder`) KALDIRILIR,
    yerine `reminderPlan` adimi gelir. Gerekce: kullaniciya once tek bir olcum
    saati sordurup hemen ardindan 3-4 satirlik bir duzen gostermek ayni seyi iki
    kez sormaktir. `medReminder` adimi aynen kalir (ilac ayri bir tur).
59. **Onizleme ekrani (`reminderPlan`)**: aktif profilin tani tipine gore
    `presetFor` ciktisinin listesi, her satirda saat + "Olcum"
    (`reminders.typeGlucose`) ve satir basina kaldirma (X). Ekranda tip adi
    GECMEZ. Iki eylem: `onboarding.planSetup` ("Duzeni kur") ve
    `onboarding.planSkip` ("Simdi degil"). Saat duzenleme onizlemede YOK:
    Hatirlaticilarim ekrani zaten tam duzenleyici, onboarding'de ayni
    kontrolleri tekrar cizmek adimi sisirir; kaldirma ise "kurulunca kalabalik
    olur" endisesini yerinde cozer.
60. **[DEGISIM] Izin ani buraya taşinir (karar 0.C guncellemesi)**: "Duzeni kur"
    once satirlari yazar (`createReminder({ type: "glucose", time, enabled: true,
    alarmEnabled: true })`, `alarmUserSet` GONDERILMEZ), sonra
    `requestNotificationPermission()`, sonra `ensureAlarmAuthorizationOnce()`.
    "Simdi degil" hicbir satir yazmaz ve hicbir izin istemez. medReminder
    adimindaki mevcut izin akisi aynen durur; iki adimda da ayni tek-sefer
    kilidi gecerli.
61. **Yeniden calisan onboarding korumasi**: duzen kurulmadan once o profilin
    mevcut satirlari okunur; ayni saatte bir `glucose` satiri varsa o satir
    ATLANIR, tavan asilirsa kalan satirlar sessizce yazilmaz (mevcut
    `setupGlucoseReminder`'daki "ayni satiri guncelle" disiplininin duzene
    genellenmis hali).
62. **Regulasyon (K2-E'nin sert kurali)**: "size onerilen olcum sikligi",
    "gunde N kez olcum yapin", "doktorunuzun onerdigi" ve benzeri hicbir ifade
    kullanilmaz. Tek cerceve: "Baslangic icin hazir bir duzen. Saatleri
    degistirebilir, hatirlaticilari silebilirsiniz."

## 15.6 K2-F. LA politikasi degisiyor: countdown yerine tek seferlik alarm

63. **[DEGISIM] modules/zerospike-alarmkit/ios/ZerospikeAlarmKitModule.swift**:
    `scheduleCountdownTimer` (satir 265-300 civari) ve `AlarmPresentation.Countdown`
    kullanimi tamamen KALDIRILIR. Yerine `AsyncFunction("scheduleOneShotAlarm")
    { (id: String, epochSeconds: Double, label: String, stopLabel: String,
    route: String) -> Bool }`: `Alarm.Schedule.fixed(Date(timeIntervalSince1970:))`
    ve `scheduleDailyAlarm` ile AYNI `AlarmPresentation.Alert` govdesi (countdown
    sunumu yok, dolayisiyla sistem geri sayim karti da yok). Kimlik haritasi,
    cancel-then-schedule ve sessiz degradasyon aynen paylasilir.
64. **[DEGISIM] modules/zerospike-alarmkit/index.ts**: `scheduleCountdownTimer`
    sarmalayicisi silinir, `scheduleOneShotAlarm({ id, atMs, label, stopLabel,
    route })` eklenir (`atMs` iceride saniyeye cevrilir).
65. **[DEGISIM] lib/services/notifications.ts / schedulePostMealAt**:
    (a) `endsAt` / `startedAt` hesabi alarm kolundan ONCE'ye alinir (bugun 1259-1261'de
    sonra hesaplaniyor), cunku tek seferlik alarm tam olarak `endsAt`'e kurulur;
    (b) alarm kolu `scheduleOneShotAlarm` cagirir; (c) **bugunku 1290-1293'teki
    `if (armedAsAlarm) { endPostMealActivity(); return; }` blogu SILINIR**:
    `startPostMealActivity` artik her iki modda da calisir. Bildirim yalniz
    bildirim modunda kurulur, `cancelAlarm(POSTMEAL_ALARM_ID)` karsi-kol
    temizligi aynen durur. Cift teslim kurali degismez: ayni pencerede ya alarm
    ya bildirim, hicbir zaman ikisi.
66. **[DEGISIM] reconcilePostMealDelivery (1694-1725)**: mantik aynen kalir
    (yetki kaybinda kalan sureyi bildirime cevirir), yalniz "Live Activity'yi
    geri getirir" gerekcesi gecersizlesir ve doc yorumu duzeltilir: LA zaten
    ayakta, uzlastirma artik SADECE teslimi tasir.
67. **applyPostMealAlarmModeChange (1637-1667)**: imza ve mantik degismez,
    `minSeconds: 1` korunur; artik mod degisimi LA'yi hic etkilemedigi icin
    gecis gozle gorulur sekilde daha sakin.
68. **[DEGISIM] Bolum 14 sinirlari**: "Sistem sayac kartindan yapilan iptal
    dinlenmiyor" maddesi DUSER (ortada sistem karti yok). "Tokluk alarm
    kimliginin tek toplayicisi bir sonraki kurulum" maddesi AYNEN gecerli
    kalir (kimlik ve supurge davranisi degismedi).
69. **[DEGISIM] HUMAN-TODO.md**: countdown dogrulama maddeleri
    (`Alarm.CountdownDuration`, `AlarmPresentation.Countdown`,
    `AlarmPresentation(alert:countdown:)`, `AlarmConfiguration(countdownDuration:)`)
    DUSER. Yerine iki madde: `Alarm.Schedule.fixed(_:)` ile tek seferlik alarm,
    ve K2-B'nin `secondaryButton` / `secondaryIntent` / `supportedModes:
    .foreground(.immediate)` ucusu. Ikisi de basarisiz olursa sonuc `false`
    ve bugunku bildirim yoluna dusme.
70. **[DEGISIM] Cihaz QA**: bolum 10'un 9. senaryosu (sistem sayac kartinin
    gorunumu) yerine "alarm modunda BIZIM kartimiz gorunur, sistemin geri
    sayim karti HIC gorunmez" senaryosu gecer (bolum 15.9).

## 15.7 i18n anahtarlari (Kapsam 2, 9 dil)

Hitap kurallari CLAUDE.md'deki gibi; her dilde tek ve resmi hitap.

| Anahtar | en | tr |
| --- | --- | --- |
| reminders.upcomingTitle | Coming up | Sıradaki |
| reminders.upcomingEmpty | Nothing in the next 24 hours. | Önümüzdeki 24 saatte bir şey yok. |
| reminders.upcomingMore | +{{n}} more | +{{n}} tane daha |
| reminders.nextToday | next: today {{time}} | sıradaki: bugün {{time}} |
| reminders.nextTomorrow | next: tomorrow {{time}} | sıradaki: yarın {{time}} |
| reminders.upcomingPostMeal | Post-meal timer | Tokluk sayacı |
| reminders.alarmOpenButton | Open | Aç |
| dashboard.postMealCustomA11y | Start a timer with a different length | Farklı süreyle sayaç başlat |
| dashboard.postMealCustomTitle | How long? | Ne kadar sürsün? |
| dashboard.postMealCustomHint | This applies to this meal only; your saved setting stays as it is. | Bu yalnızca bu öğün için geçerlidir, kayıtlı ayarınız olduğu gibi kalır. |
| dashboard.postMealCustomOther | Custom | Özel |
| dashboard.postMealCustomStart | Start | Başlat |
| onboarding.qReminderPlan | A ready-made reminder set | Hazır bir hatırlatıcı düzeni |
| onboarding.qReminderPlanHint | A starting point, nothing more. You can change the times or remove any of them later. | Yalnızca bir başlangıç. Saatleri sonradan değiştirebilir, dilediğinizi silebilirsiniz. |
| onboarding.planSetup | Set up this plan | Düzeni kur |
| onboarding.planSkip | Not now | Şimdi değil |
| onboarding.planRemoveA11y | Remove this reminder | Bu hatırlatıcıyı kaldır |

Yeniden kullanilanlar (yeni metin yazilmaz): `reminders.typeGlucose`,
`reminders.modeAlarm`, `reminders.modeNotification`, `settings.minutes`,
`notifications.postmealTitle`, `reminders.alarmStopButton`,
`onboarding.alarmNote`.

Silinenler (9 dil): `onboarding.qPostMeal`, `onboarding.qPostMealHint`,
`onboarding.qGlucoseReminder`, `onboarding.qGlucoseReminderTracking`,
`onboarding.qGlucoseReminderHint`, `onboarding.qGlucoseReminderHintTracking`
(K2-D ve K2-E adimlari kalktigi icin).

## 15.8 Store metinlerine etki

71. **What's New 2.3.0 (zerospike-store/aso/{9 dil}.md)**: uc satir. (a)
    "Kurdugunuz hatirlaticilar iOS 26'da gercek alarm olarak calabilir." (b)
    "Kuruluma hazir bir hatirlatici duzeni ve yaklasan hatirlaticilar gorunumu."
    (c) "Tokluk sayacini istediginiz sureyle baslatin." Regulasyon suzgeci:
    "onerilen siklik" yok, "uyari" yok.
72. **review-notes-en.md reviewer steps**: (a) onboarding artik post-meal
    suresini SORMAZ; (b) onboarding sonunda bir ONIZLEME ekrani vardir ("Set up
    this plan" / "Not now"), hicbir sey kullanici onaylamadan kurulmaz; (c) tum
    alarmlar kullanicinin kurdugu sabit saatli hatirlaticilar veya kullanicinin
    kendi baslattigi tokluk sayacinin bitisidir; (d) deger-tetiklemeli hicbir
    alarm yoktur, dusuk-sonrasi takip bilerek bildirimdir; (e) Critical Alerts
    kullanilmaz; (f) her hatirlatici tek tek bildirime cevrilebilir.
73. **ASO uzun aciklama**: "yaklasan hatirlaticilar" ve "hazir duzen" cumleleri
    eklenir, ayni suzgecten gecer.
74. **Gorsel borcu**: 09-reminders paneli artik "Siradaki" kartini ve mod
    rozetini gosterir, 9 dilde yeniden uretilir; onboarding panelinde tokluk
    sorusu varsa o panel de degisir (kayit: docs/store-screenshots-plan.md).

## 15.9 Testler (Kapsam 2)

75. **scripts/upcomingReminders.test.ts (yeni)**: saatin bugun mu yarin mi
    oldugunun sinir vakalari (tam simdi, bir dakika once, bir dakika sonra),
    24 saat penceresi disinda kalan satirlarin dislanmasi, siralama, kapali
    satir / kapali kapi (basal-med gorunurlugu) filtreleri, mod alaninin
    `alarmModeOf` ile ayni cikmasi, tokluk girdisinin dogru yere yerlesmesi.
76. **scripts/reminderPresets.test.ts (yeni)**: her tip icin satir sayisi ve
    saatler, saatlerin "HH:MM" bicimi, tiplerin tamaminin kapsanmasi
    (DiabetesType birligi uzerinde exhaustive), en kalabalik duzenin
    MAX_REMINDERS altinda kalmasi, ayni saatin iki kez uretilmemesi.
77. **scripts/postMealTimer.test.ts genisler**: `clampPostMealMinutes` alt/ust
    sinir, ondalik yuvarlama, gecersiz girdi.
78. **scripts/alarmSelect.test.ts**: DEGISMEZ (mod karari ayni tek tanim).
79. **scripts/migration.test.ts**: DEGISMEZ, Kapsam 2 sema degistirmez (yeni
    kalici alan yok; tek seferlik sure bayragi AsyncStorage'da).
80. **Kapilar**: `npm run typecheck` (i18n-check dahil) + `npm run i18n:check` +
    tum `scripts/*.test.ts`.

## 15.10 Cihaz QA eklemeleri (bolum 10'un ustune)

19. Alarm modunda tokluk sayaci: BIZIM kilit ekrani kartimiz gorunur, sistemin
    geri sayim karti gorunmez; sure sonunda gercek alarm calar.
20. Kilit ekrani kartina / Dynamic Island'a dokunmak tokluk olcum sheet'ini
    acar.
21. Alarm ekranindaki "Ac" dugmesi uygulamayi ilgili ekranda acar (derlenmezse
    HUMAN-TODO sinirina duser: yalniz "Durdur" gorunur). Iki durumda da
    denenir: (a) uygulama tamamen kapaliyken, (b) uygulama ARKA PLANDA acikken
    - ikincisinde rota bir saniyelik tek tekrarla yakalanir (app/_layout.tsx),
    yani dugmeye basar basmaz degil, en gec bir saniye icinde dogru ekran
    acilmalidir. Onboarding'i bitirmemis bir kurulumda birikmis rota sonradan
    surpriz yonlendirme YAPMAMALIDIR (completeOnboarding onu tuketip atar).
22. **[G15 ile degisti]** Gecikme telafisi: pano yemek kartindaki kucuk saat
    dugmesi "Yemege ne zaman basladiniz?" sayfasini acar. (a) "10 dk once" ->
    sayac 110 dk kurulur, kilit ekrani karti ve ilerleme cubugu yemegin gercek
    anindan sayar; (b) serbest secimle 125 dk once -> sayac KURULMAZ, "pencere
    gecti" aciklamasi ve "Olcumu kaydet" eylemi gorunur; (c) Ayarlar'da artik
    pencere suresi secici YOKTUR, yerinde tek satirlik sabit-120 notu vardir.
23. Ozel hatirlatici bildirimine dokunmak panoyu acar (form acmadan).
24. Bos gunluk bildirimine dokunmak panoyu acar (aclik formu ACILMAZ).
25. Ana widget'a (iOS ve Android) dokunmak glukoz ekleme formunu acar.
26. **[G18 ile degisti]** Hatirlaticilar ekraninda "Siradaki" KARTI YOK
    (listenin hemen ustunde ayni bilgiyi tekrarliyordu). Her satir: sol ikon,
    ad, altinda "08:00 · yarin" ve kucuk teslim isareti, sagda yalniz anahtar.
    Isarete dokununca alarm <-> bildirim aninda degisir (dokunma alani 44pt+).
    Sirada olan is artik PANODA tek satirdir: "Sabah olcumu · 08:00" + isaret,
    dokununca Hatirlaticilarim'a gider; hatirlatici yoksa ya da izin/ana
    anahtar kapaliysa o satir HIC cizilmez.
27. Onboarding: tokluk sorusu YOK; hazir duzen onizlemesi geliyor, bir satiri
    kaldirip "Duzeni kur" denince yalniz kalanlar kuruluyor ve izinler o anda
    isteniyor; "Simdi degil" hicbir satir ve hicbir izin uretmiyor.
27b. **[G16]** Hazir duzenin satirlari GUNE GORE adlandirilir: type2'de
    "Sabah olcumu / Ogle olcumu / Aksam olcumu". Onizlemede, kurulum sonrasi
    Hatirlaticilarim listesinde, "Siradaki" kartinda ve onboarding kapanis
    kartinda ayni ad gorunur. Hicbir sablon icinde ayni ad iki kez cikmaz.
27c. **[G16]** Hatirlatici satiri iki katmanli: ust satirda ad + saat, alt
    satirda "siradaki: ..." ve teslim rozeti, sagda dikey ortali anahtar.
    Almanca ve Fransizcada tasma/kirpma olmamali.
27d. **[G13]** Onboarding kapanis karti ("Kayit planiniz") gercekten kurulan
    satirlari listeler: duzeni kuran kullanici kendi olcum satirlarini
    saatleriyle gorur, "Simdi degil" diyen hicbir olcum satiri gormez. Alarm
    modundaki satirlarda alarm ikonu, degilse bildirim ikonu cikar.
27e. **[G14]** Ayni ekrandaki "Ornek veri" grafigi kartin icine tam sigar,
    saginda kirpilma olmaz (dar cihazlarda da).
28. Onboarding'i yarida kesip yeniden baslatmak duzeni ikilemiyor: ikinci turda
    "Duzeni kur" once bu profilin TUM olcum hatirlaticilarini siliyor, sonra
    onizlemedeki satirlari yaziyor. Test edilecek asil hal: ilk turda 4 satirlik
    duzeni kur, uygulamayi oldur, yeniden basla, onizlemeden bir satiri kaldirip
    kur -> Hatirlaticilarim'da tam olarak 3 olcum satiri olmali (eski 4'ten
    kalan tek fazla satir da olmamali). Bazal ve ilac satirlari bu silmeden
    etkilenmez.

## 15.10b Uygulama notu: "Siradaki" kartinda saat bicimi

Kart, hatirlatici satirlari icin satirin KENDI sakli "HH:MM" metnini basiyor
(ekranin geri kalaninda gorunen degerle ayni olsun diye) ve tokluk sayacinin
epoch bitisini de ayni bicimde yaziyor. Yani kart 12 saatlik yerel bicimi
kullanan dillerde de 24 saatlik okunuyor. Bilincli: madde 37 satir saatlerinin
oldugu gibi kullanilmasini istiyor, `formatTimeForLang` ise en icin "10:30 PM"
uretiyor ve tek dar kolonda iki farkli saat bicimi yan yana gelirdi. Bu ekranda
zaten her saat degeri "HH:MM" (satirin `value` alani, duzenleme sayfasi).
Degistirilecekse ikisi birden degismeli.

## 15.11 Riskler (Kapsam 2)

- **R8. Tek seferlik alarm sistem "Alarmlar" listesinde gorunebilir**: AlarmKit
  alarmlari sistemce yonetilir; tokluk alarminin orada bir satir olarak
  gorunmesi olasidir. Zararsiz ama beklenmedik; QA maddesi 19 ile gozlenir.
- **R9. `secondaryIntent` / `supportedModes` ucusu derlenmeyebilir**: iOS 26'da
  `openAppWhenRun` deprecated ve yerine gecen API bu ortamda derlenemedi.
  Azaltma: dugme opsiyonel, basarisizlikta alarm yalniz "Durdur" tasir.
- **R10. Hazir duzen "cok fazla hatirlatici" hissi yaratabilir**: 4 satirlik
  duzen + bazal + ilac gunde 6 teslim demek. Azaltma: onizlemede satir
  kaldirma, notr cerceve metni, Hatirlaticilarim'da toplu gorunurluk.
- **R11. Preset regulasyon algisi**: tani tipine gore satir uretmek "onerilen
  siklik" gibi okunabilir. Azaltma: madde 62'deki dil kurali, ekranda tip
  adinin hic gecmemesi, review notunda acik beyan (madde 72b).
- **R12. Widget tiklama hedefinin degismesi**: ana widget artik dogrudan form
  aciyor; "sadece uygulamayi acmak isteyen" kullanici icin davranis degisikligi.
  Azaltma: form kapatilabilir ve arkasinda pano duruyor; accessory ile tutarli
  hale geldi.
- **R13. Yaklasan liste ile gercek teslim arasinda sapma**: liste tablodan
  hesaplaniyor, OS kuyrugundan degil; OS bir bildirimi dusurduyse liste yine de
  gosterir. Azaltma: mevcut `checkReminderReliability` karti ayni ekranda duruyor,
  liste "kurulu duzen" olarak konumlaniyor, "OS kuyrugu" olarak degil.

## 15.12 Dalga sirasi (dosya cakismasiz)

- **W1**: K2-F (native tek seferlik alarm + LA politikasi). Once yapilir, cunku
  halihazirda commit'lenmis kodu geri alir ve W2-W3 onun uzerine biner.
  Dosyalar: modules/zerospike-alarmkit/**, lib/services/notifications.ts,
  HUMAN-TODO.md.
- **W2**: K2-A (lib/upcomingReminders.ts + components/settingsUi.tsx +
  app/settings/reminders.tsx) ve K2-B (app/_layout.tsx, notifications.ts rota
  birligi, targets/widget/**, lib/services/androidWidget.ts,
  modules/zerospike-alarmkit AppIntent). Iki is farkli dosyalarda, paralel
  gidebilir; notifications.ts'e iki dalganin da dokundugu tek nokta rota
  birligi, W1 bittikten sonra ele alinir.
- **W3**: K2-C (app/(tabs)/index.tsx + components/PostMealDurationSheet.tsx +
  lib/postMealTimer.ts) ve ardindan K2-D + K2-E (ikisi de app/onboarding.tsx,
  ARDISIK: once adim kaldirma, sonra reminderPlan) + lib/reminderPresets.ts.
- **W4**: 9 dil stringleri (yeni + silinen), store/review metinleri, gorsel
  borcu kaydi, HUMAN-TODO guncellemesi, kapilar, surum/build numaralari,
  commit. Build, cihaz QA ve store yuklemesi kullanicida.
