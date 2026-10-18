# supabase

Aktif proje ref: `jcpepqectdubbmchhdsn` (eu-central-1, org greeneyeapp, 2026-10-18'de acildi; eski veri tasinmadi). Fonksiyon adresleri: `https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/{track,rc-webhook,delete-device,ai-ask-spike}`; uygulama adresleri app.json extra (spikeFnUrl, trackFnUrl, deleteDeviceFnUrl).

Eski proje `zobtmenqgsradocrxdtc` baska bir hesapta: 2.3.7 kullanicilari icin dort fonksiyon yonlendirici olarak durur (`supabase/legacy-forwarders/`), yeni adrese iletir. 2.3.7 payi mağaza verisinde yuzde ikinin altina inince eski proje kapatilir.

## Sirlar
Dosya `~/.supabase/zerospike.secrets.env` (chmod 600; degerler hicbir yere yazilmaz): AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, SPIKE_MODEL, SPIKE_MODEL_PREFIX, RC_WEBHOOK_SECRET. Yukleme: `supabase secrets set --env-file ~/.supabase/zerospike.secrets.env`. Veritabani sifresi `~/.supabase/zerospike.dbpass` (chmod 600). Listede yalniz ad gorunur: `supabase secrets list` (degerler ozet olarak doner).

RevenueCat webhook: adres `https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/rc-webhook`; Authorization alani RC_WEBHOOK_SECRET ile BIREBIR ayni olmali (kodda `Bearer ` on eki islenmez; onek isteniyorsa secret'in kendisi "Bearer <deger>" olmali).

## Deploy (kullanici yapar)
1. `supabase login`, `SUPABASE_DB_PASSWORD="$(cat ~/.supabase/zerospike.dbpass)" supabase link --project-ref jcpepqectdubbmchhdsn`.
2. Migration: `SUPABASE_DB_PASSWORD="$(cat ~/.supabase/zerospike.dbpass)" supabase db push`. Cron isleri migration ile gelir: purge-app-events 03:17, purge-spike-logs 03:17, purge-subscription-events 03:27 (UTC).
3. Fonksiyonlar: `supabase functions deploy <ad> --project-ref jcpepqectdubbmchhdsn --use-api` (track, rc-webhook, delete-device, ai-ask-spike). `functions/_shared/event-schema.json` degisince track yeniden deploy edilmeli: sunucu once, uygulama surumu sonra.
4. Duman testi: /track 202, /rc-webhook yanlis sirla 401 dogru sirla 200, /delete-device 200, /ai-ask-spike 200.
5. Eski projeye yonlendirici deploy (eski hesaba `supabase login`): `supabase functions deploy <ad> --project-ref zobtmenqgsradocrxdtc --workdir supabase/legacy-forwarders --use-api` (repo kokunden).
6. Eski projede yonlendiricilerce kullanilmayan sirlari sil (eski hesapta): `supabase secrets unset AWS_BEARER_TOKEN_BEDROCK RC_WEBHOOK_SECRET SPIKE_MODEL SPIKE_MODEL_PREFIX AWS_REGION --project-ref zobtmenqgsradocrxdtc`. Bedrock token'i yenilendiyse eskisini AWS'den iptal et.

## Bilinen kisit
Eski surum (2.3.7) trafigi yonlendirici uzerinden yeni projeye TEK IP (eski projenin egress IP'si) olarak gorunur. Per-IP tavanlar (track 600/saat, ai-ask-spike 60/saat, delete-device 30/saat) tum eski surum kullanicilarini birlikte sinirlar. Haftalik ~44 indirme ile organik tasma beklenmez; kotu niyetli bir istemci eski adrese istek atarak 2.3.7 kullanicilarini 429'a kilitleyebilir. Izle: v_event_daily ve track 429 orani. Sorun gorulurse gizli basliktan gercek IP'ye guvenme yoluna gidilir (iki projede secret + callerIp degisikligi).

## Eski projede kalan veri (KULLANICI ONAYI GEREKIR)
Eski projede kisisel satirlar duruyor: subscription_events 24 ay, spike_calls ve spike_usage 90 gun, app_events 30 gun. Yonlendirici dogrulandiktan sonra eski proje tablolari bosaltilabilir (once disa aktarim istenirse `supabase db dump --data-only`). Bu YIKICIDIR ve kullanici onayiyla yapilir. Yapilana kadar gizlilik metnindeki "cihaza ozel silme" vaadi icin eski projede delete_device_data_v2 manuel cagrilabilir.

## Haftalik olcum
`node scripts/metrics-weekly.mjs` (`--dry` ag cagrisi yapmaz). Service role anahtari `~/.supabase/zerospike.service.key` dosyasindan okunur, hicbir yere yazilmaz. Cikti `scratchpad/metrics/YYYY-WW.md`.
