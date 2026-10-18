# supabase

Aktif proje ref: `jcpepqectdubbmchhdsn` (eu-central-1, org greeneyeapp, 2026-10-18'de acildi; eski veri tasinmadi). Fonksiyon adresleri: `https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/{track,rc-webhook,delete-device,ai-ask-spike}`; uygulama adresleri app.json extra (spikeFnUrl, trackFnUrl, deleteDeviceFnUrl).

Eski proje `zobtmenqgsradocrxdtc` baska bir hesapta: 2.3.7 kullanicilari icin dort fonksiyon yonlendirici olarak durur (`supabase/legacy-forwarders/`), yeni adrese iletir. 2.3.7 payi mağaza verisinde yuzde ikinin altina inince eski proje kapatilir.

## Sirlar
Dosya `~/.supabase/zerospike.secrets.env` (chmod 600; degerler hicbir yere yazilmaz): AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, SPIKE_MODEL, SPIKE_MODEL_PREFIX, RC_WEBHOOK_SECRET, FORWARDER_SECRET (`openssl rand -hex 32` ile uretilir, deger yazilmaz; iki projede de AYNI deger; yenisinde dosyadan `secrets set`, eskisinde `supabase secrets set FORWARDER_SECRET=... --project-ref zobtmenqgsradocrxdtc` ile kullanici kendi uretir). Yukleme: `supabase secrets set --env-file ~/.supabase/zerospike.secrets.env`. Veritabani sifresi `~/.supabase/zerospike.dbpass` (chmod 600). Listede yalniz ad gorunur: `supabase secrets list` (degerler ozet olarak doner).

RevenueCat webhook: adres `https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/rc-webhook`; Authorization alani RC_WEBHOOK_SECRET ile BIREBIR ayni olmali (kodda `Bearer ` on eki islenmez; onek isteniyorsa secret'in kendisi "Bearer <deger>" olmali).

## Deploy (kullanici yapar)
1. `supabase login`, `SUPABASE_DB_PASSWORD="$(cat ~/.supabase/zerospike.dbpass)" supabase link --project-ref jcpepqectdubbmchhdsn`.
2. Migration: `SUPABASE_DB_PASSWORD="$(cat ~/.supabase/zerospike.dbpass)" supabase db push`. Cron isleri migration ile gelir: purge-app-events 03:17, purge-spike-logs 03:17, purge-subscription-events 03:27 (UTC).
3. Fonksiyonlar: `supabase functions deploy <ad> --project-ref jcpepqectdubbmchhdsn --use-api` (track, rc-webhook, delete-device, ai-ask-spike). `functions/_shared/event-schema.json` degisince track yeniden deploy edilmeli: sunucu once, uygulama surumu sonra.
4. Duman testi: /track 202, /rc-webhook yanlis sirla 401 dogru sirla 200, /delete-device 200, /ai-ask-spike 200.
5. SIRA ONEMLI: once yeni projede ai-ask-spike, track, delete-device deploy (adim 3), sonra eski projedeki 4 yonlendirici. Eski projeye yonlendirici deploy (eski hesaba `supabase login`): `supabase functions deploy <ad> --project-ref zobtmenqgsradocrxdtc --workdir supabase/legacy-forwarders --use-api` (repo kokunden).
6. Eski projede yonlendiricilerce kullanilmayan sirlari sil (eski hesapta): `supabase secrets unset AWS_BEARER_TOKEN_BEDROCK RC_WEBHOOK_SECRET SPIKE_MODEL SPIKE_MODEL_PREFIX AWS_REGION --project-ref zobtmenqgsradocrxdtc`. Bedrock token'i yenilendiyse eskisini AWS'den iptal et.

## Bilinen kisit
Yonlendiriciler gercek istemci IP'sini X-Forwarded-For ile ve X-Zs-Forwarder (FORWARDER_SECRET) basligiyla iletir; yeni proje IP'yi yalniz sir birebir eslesirse kullanir (`resolveCallerIp`, `functions/_shared/http.ts`), aksi halde baglanti IP'sine duser. Gelen X-Zs-Forwarder yonlendiriciden gecmez. FORWARDER_SECRET iki projede de ayni degerle ayarlanmazsa eski surum trafigi yine tek IP gorunur ve per-IP tavanlar (track 600/saat, ai-ask-spike 60/saat, delete-device 30/saat) onlari birlikte sinirlar. Izle: v_event_daily ve track 429 orani. Eski proje kapaninca yeni projede `supabase secrets unset FORWARDER_SECRET --project-ref jcpepqectdubbmchhdsn`. Deploy sonrasi dogrulama: eski URL'ye farkli aglardan istek at, sonra `supabase db query --linked "select count(distinct ip_hash) from public.spike_ip_usage where hour_start > now() - interval '1 hour'"` farkli ip_hash sayisini vermeli (tek deger gorunuyorsa sir eslesmiyor).

## Eski projede kalan veri (KULLANICI ONAYI GEREKIR)
Eski projede kisisel satirlar duruyor: subscription_events 24 ay, spike_calls ve spike_usage 90 gun, app_events 30 gun. Yonlendirici dogrulandiktan sonra eski proje tablolari bosaltilabilir (once disa aktarim istenirse `supabase db dump --data-only`). Bu YIKICIDIR ve kullanici onayiyla yapilir. Yapilana kadar gizlilik metnindeki "cihaza ozel silme" vaadi icin eski projede delete_device_data_v2 manuel cagrilabilir.

## Haftalik olcum
`node scripts/metrics-weekly.mjs` (`--dry` ag cagrisi yapmaz). Service role anahtari `~/.supabase/zerospike.service.key` dosyasindan okunur, hicbir yere yazilmaz. Cikti `scratchpad/metrics/YYYY-WW.md`.
