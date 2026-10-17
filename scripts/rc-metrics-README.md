# rc-metrics

RevenueCat REST API v2 ile abonelik metriklerini ceker. Bagimlilik yok (node:https).

    node scripts/rc-metrics.mjs [--chart trial_conversion]

- Anahtar: `~/.revenuecat/zerospike.key` (tek satir, v2 secret key; yalniz Authorization basliginda kullanilir, yazdirilmaz).
- Cikti: projeler, `metrics/overview` tablosu (P28D = son 28 gun penceresi, P0D = anlik), apps, products, entitlements, offerings (+paketler).
- Deneme donusumu: overview'da yok; `--chart trial_conversion` chart endpoint'ini dener (`charts_metrics:charts:read` izni gerekir).
- 401/403: anahtar gecersiz veya izin eksik. 429: rate limit (25 istek/dk).
