# supabase

Proje ref: `zobtmenqgsradocrxdtc`. CLI oturumu baska bir hesapta olabilir: deploy oncesi ayri `supabase login` ve `supabase link --project-ref zobtmenqgsradocrxdtc` gerekir.

## Deploy (kullanici yapar)

1. Migration: `supabase db push` (ornek: `20261017120000_funnel_views.sql`, yalniz v_* gorunumleri, purge sureleri degismez).
2. `track` fonksiyonu YENIDEN deploy edilmeli: `supabase functions deploy track`. `functions/_shared/event-schema.json` yeni olay/alanlari (schema v2) icerir; sunucu eski surumde kalirsa yeni olaylar sessizce dusurulur. Sira: sunucu once, uygulama surumu sonra.

## Haftalik olcum

`node scripts/metrics-weekly.mjs` (`--dry` ag cagrisi yapmaz). Service role anahtari `~/.supabase/zerospike.service.key` dosyasindan okunur, hicbir yere yazilmaz. Cikti `scratchpad/metrics/YYYY-WW.md`.
