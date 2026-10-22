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
