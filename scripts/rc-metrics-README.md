# rc-metrics

RevenueCat REST API v2 ile abonelik metriklerini ceker. Bagimlilik yok (node:https).

    node scripts/rc-metrics.mjs [--chart trial_conversion|churn|actives] [--days 90] [--resolution month] [--raw]

- Anahtar: `~/.revenuecat/zerospike.key` (tek satir, v2 secret key; yalniz Authorization basliginda kullanilir, yazdirilmaz).
- Cikti: projeler, `metrics/overview` tablosu (P28D = son 28 gun penceresi, P0D = anlik), apps, products, entitlements, offerings (+paketler).
- Deneme donusumu: overview'da yok; `--chart trial_conversion` donem (kohort) tablosu basar (`charts_metrics:charts:read` gerekir). `active_subscriptions` icin chart adi `actives` (alias var). `--raw` ham JSON basar. `*` = donem tamamlanmadi.
- 401/403: anahtar gecersiz veya izin eksik. 429: rate limit (25 istek/dk).
