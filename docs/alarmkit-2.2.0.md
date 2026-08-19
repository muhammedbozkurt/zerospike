# AlarmKit: gercek alarm destegi (2.2.0 ana ozelligi)

Onay: kullanici 2026-08-19 ("alarmkit'e onay veriyorum fakat eksik hicbir yer birakma").
Kapsam karari: 2.1.0 QA dongusunu bozmamak icin 2.2.0'da; bu dosya tam kapsam kaydidir.

## Amac
Hatirlatici Merkezi'ndeki kullanicinin kendi kurdugu saatli hatirlaticilar (ilac, bazal,
glukoz olcum, ozel) istege bagli olarak GERCEK sistem alarmi calabilsin: tam ekran,
sessiz modu deler, sistem erteleme/durdurma arayuzu.

## Kesin cizgiler (regulasyon)
- YALNIZ kullanicinin kendisinin kurdugu sabit saatli hatirlaticilar alarm olabilir.
- Degere bagli hicbir bildirim (dusuk-sonrasi takip dahil) AlarmKit'e TASINMAZ; o
  Time Sensitive bildirim olarak kalir. Deger-tetiklemeli alarm = tibbi cihaz cizgisi.
- Metin cercevesi "hatirlatici"dir; "uyari/alarm verir" pazarlama dili KULLANILMAZ
  (UI'da "Alarm olarak cal" anahtari islev adidir, savunulabilir).

## Platform davranisi
- iOS 26+: AlarmKit framework. Ozellikler: tam ekran alarm arayuzu, sessiz anahtari
  ve Focus'u deler, sistem snooze/stop. Izin: ayri AlarmKit yetkisi (Info.plist
  NSAlarmKitUsageDescription + runtime authorization). Uygulama basina alarm listesi
  sistemce yonetilir.
- iOS < 26: ozellik yok; "Alarm olarak cal" anahtari GIZLENIR, mevcut bildirim akisi
  aynen calisir. Kod calisma zamaninda availability kontrolu yapar (derleme hedefi
  16.4 kaldigi icin weak-link/if #available).
- Android: bu dalgada mevcut exact-alarm bildirimleri kalir (SCHEDULE_EXACT_ALARM
  manifest'te, kanal reminders-v2 + followup-v1). Tam ekran alarm (full-screen
  intent + USE_FULL_SCREEN_INTENT) AYRI arastirma maddesi; Play politikasi izin
  gerekcesi istiyor, 2.2.0'a girecekse ayrica karara baglanir. Anahtar Android'de
  simdilik gorunmez (veya "yalniz iOS" notu; karar UI tasariminda).

## UX
- Hatirlatici Merkezi satir duzenleyicisine anahtar: "Alarm olarak cal" (yalniz
  iOS 26+). Ilk acista AlarmKit izni istenir; reddedilirse anahtar kapali kalir ve
  kisa aciklama gosterilir (sistem ayarlarina yonlendirme).
- Alarm acik satirlar bildirim YERINE alarm kurar (cift teslim olmaz). Anahtar
  kapatilinca alarm iptal edilir, bildirim planlamasina geri doner.
- Onboarding'e eklenmez (sadelik); kesif Hatirlatici Merkezi'nden.

## Teknik plan
- Yeni native modul: modules/zerospike-alarmkit (expo-modules-core Swift moduli;
  zerospike-live-activity ornek alinir). API: isAvailable(), getAuthorization(),
  requestAuthorization(), scheduleAlarm({id,time,label,repeatsDaily}),
  cancelAlarm(id), listScheduledIds().
- Kimlik: "zerospike-alarm-<reminderId>"; reminders tablosuna kolon EKLENMEZ,
  yeni alan reminders.alarm_enabled (v19 migration, default 0) VEYA app_meta json;
  karar: kolon (sorgulanabilir, temiz). v19 create-only + damga deseni.
- applyReminders yasam dongusu: satir apply edilirken alarm_enabled=1 ve iOS26+ ve
  izin verilmisse -> alarm kur, bildirim kurma; degilse mevcut yol. Dil degisimi
  re-arm'i alarm etiketlerini de yeniler. Yetim temizligi listScheduledIds ile
  ayni desene baglanir. Gate'ler (basal/med gorunurluk) aynen uygulanir.
- prebuild etkisi: yeni modul native; kullaniciya prebuild/eas build hatirlatilir.
- Testler: alarm secim mantigi sade fonksiyona cekilir (unit test edilebilir);
  migration testi v19 icin M-deseni.

## Stringler (9 dil, hitap kurallari)
- reminders.playAsAlarm ("Alarm olarak cal"), reminders.alarmPermissionHint,
  reminders.alarmPermissionDenied (sistem ayarlarina yonlendirme metni),
  reminders.alarmOnlyNewIos benzeri kisa aciklama. Kesin liste implementasyonda.

## Store / review
- Surum notu satiri (9 dil): "Hatirlaticilar artik istege bagli gercek alarm
  calabilir (iOS 26+)".
- Apple review notuna madde: alarms are user-created fixed-time reminders via
  AlarmKit; no value-triggered alarms; Critical Alerts not used.
- ASO aciklamalarina "gercek alarm" ifadesi eklenirken regulasyon suzgecinden
  gecirilir (alarm kelimesi yalniz ozellik adi olarak, saglik iddiasiz).

## Cihaz QA listesi
- Izin ver/reddet/ayarlardan geri ac dongusu.
- Sessiz mod + Uyku Focus'ta alarm calisi; snooze/stop davranisi.
- Uygulama kapaliyken/oldurulmusken alarm; cihaz yeniden baslatma sonrasi kalicilik.
- Anahtar ac/kapat gecislerinde cift teslim olmamasi (alarm+bildirim ayni anda yok).
- iOS < 26 cihazda anahtarin hic gorunmemesi; Android'de gorunmemesi.
- Dil degisiminde alarm etiketinin yeni dilde gelmesi.
