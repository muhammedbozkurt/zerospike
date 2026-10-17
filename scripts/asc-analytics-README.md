# asc-analytics

App Store Connect API "Analytics Reports" icin salt okuma/istek araci. Bagimlilik yok (node:crypto + fetch).

Kimlik: `~/.appstoreconnect/config.json` ({keyId, issuerId, privateKeyPath, appId}). p8 yalniz imzalamak icin okunur, hicbir yere yazilmaz.

Komutlar:
- `node scripts/asc-analytics.mjs --request` : ONGOING ve ONE_TIME_SNAPSHOT rapor istegi olusturur (varsa mevcut id'yi yazar).
- `node scripts/asc-analytics.mjs --list` : istekler, rapor adlari, instance tarih araligi.
- `node scripts/asc-analytics.mjs --fetch --report "App Downloads" --days 30 --out <klasor>` : segment CSV'leri indirir, US/DE/FR/ES/TR ve toplam icin ozet basar (App Store Search ayri satir).

Notlar: Apple ilk raporu istekten 1-2 gun sonra uretir. 403 = anahtar rolu yetersiz (Admin/App Manager). Varsayilan cikti klasoru scratchpad/asc-analytics.
