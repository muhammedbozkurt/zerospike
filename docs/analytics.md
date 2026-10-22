# Analytics notlari

Kullanim analitigi opt-in'dir: izin verilmeden hicbir olay yazilmaz ve gonderilmez. Sema: `lib/analytics/eventSchema.ts` (v6), sunucu aynasi `supabase/functions/_shared/event-schema.json`.

## Kurulum kimligi ve yedek (A6)

- Kimlik `lib/identity/deviceId.ts`: AsyncStorage'daki rastgele uuid. Depolama okunamazsa `DEVICE_ID_FALLBACK` doner (Spike/besin tahmini sunucu deseni icin); analitik ve silme yalniz uuid olan kimligi gonderir (`isInstallId`), aksi halde o oturumda olay gonderilmez, kuyrukta bekler.
- Android `allowBackup: true` acik birakildi (`app.json`). AsyncStorage'daki kimlik ve analitik izni Android otomatik yedeginden yeni cihaza geri yuklenebilir. Bu kabul edilen davranistir: ayni kisi, ayni izin, ayni kimlik; yeni cihazda sayim ayni kurulum gibi devam eder. Kimlik veya saglik verisine bagli degildir.

## Olay adlari (A7)

- `analytics_opt_out {enabled: true}` adinin aksine opt-in anidir: yalniz kullanici analitigi actiginda yazilir. Ret hic gonderilmez, bu yuzden "izin vermeyen" sayisi tablodan okunmaz.
- Ad degistirilmez (gecmis satirlari bolmemek icin). View yorumu: `v_event_daily` (migration `20261022120100`).
- Opt-in orani = `analytics_opt_out` olayi yapan cihaz / (ASC ilk indirme, Play yeni kurulum veya RevenueCat yeni musteri). `node scripts/metrics-weekly.mjs [--play-csv <dosya>]` bu uc payda ile hesaplar. Izin oncesi olay yoktur; uygulama ici oranlar izin verenlerin alt kumesidir.

## Olcum notlari

- Build alani `lib/appVersion.ts` (expo-application, yoksa app config). Eski satirlarda `build = unknown`.
- `restore_result {result}` ve `winback_dismiss` v6 ile eklendi; sunucu semasi deploy edilene kadar track bu olaylari dusurur.

## Test ve gelistirme trafigi

Gercek kullanici disindaki cihazlar kayit dusurmez; izin akisi ve uygulama davranisi bundan etkilenmez (izin anahtari gorunur, olaylar atilir).

- Istemci (`lib/analytics/testEnvironment.ts`, ilk kapi: `initSupabaseSink` ve `postBatch`): emulator/simulator (`expo-device` `isDevice === false`), gelistirme build'i (`__DEV__`; `EXPO_PUBLIC_ANALYTICS_DEV=1` gercek cihazda denemeye izin verir), ekran goruntusu modu ve Android Firebase Test Lab / Play on-lansman raporu (`Settings.System "firebase.test.lab" == "true"`, `ZerospikeLiveActivity.isTestLab()`) icin sink hic baslamaz: kuyruga olay alinmaz, istek gitmez. `isTestLab` native oldugu icin eski build'lerde yoktur; bu durumda `false` doner ve sunucu kurali devrede kalir.
- Sunucu (`supabase/functions/track/testDevices.ts`): `public.test_devices` (migration `20261022130000`) icindeki bir cihaz kimliginden gelen toplu istek 202 `{accepted: 0, dropped: n, test_device: true}` ile kabul edilir, hicbir satir yazilmaz ve hiz siniri sayaclari artmaz. Sorgu 60 sn onbellekli; tablo veya ag hatasinda yazmaya devam eder (fail-open, loglanir, 15 sn sonra yeniden dener).
- Gorunumler (`20261022130100`): `v_event_daily`, `v_retention_cohort`, `v_funnel_daily`, `v_paywall_daily`, `v_purchase_results_daily`, `v_onboarding_dropoff`, `v_third_log`, `v_feedback_sent_daily` test cihazlarini disarida birakir.
- Cihaz ekleme: Ayarlar > Veri'de gorunen kurulum kimligi kopyalanir ve `insert into public.test_devices (device_id, note) values ('<uuid>', 'telefonum') on conflict do nothing;` ile eklenir (service role). Eski satirlari silmek icin tek seferlik temizlik sablonu hub'dadir (onayli kimlikler icin).
- Sinir: bir test cihazi `test_devices`'a eklenmedikce ve istemci sinyallerinden birini tasimadikca (ornegin TestFlight'ta calisan gercek bir iPhone) normal kullanici gibi sayilir.
