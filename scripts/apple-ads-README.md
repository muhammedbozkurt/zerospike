# apple-ads-setup.mjs

`docs/apple-ads/` v2 yapisini Apple Ads Campaign Management API v5 ile kurar.
Bagimlilik yok, yalniz Node stdlib. Depoda gizli bilgi tutulmaz.

## Tek seferlik kurulum

    mkdir -p ~/.apple-ads/zerospike
    openssl ecparam -genkey -name prime256v1 -noout -out ~/.apple-ads/zerospike/private-key.pem
    openssl ec -in ~/.apple-ads/zerospike/private-key.pem -pubout -out ~/.apple-ads/zerospike/public-key.pem

`public-key.pem` icerigini ads.apple.com > Account Settings > API alanina yapistirip kaydedin;
ekranda `clientId`, `teamId`, `keyId` cikar. Bunlari `~/.apple-ads/zerospike/config.json` icine yazin:

    {"clientId": "SEARCHADS....", "teamId": "SEARCHADS....", "keyId": "....",
     "orgId": 0, "adamId": 6778782351,
     "privateKeyPath": "~/.apple-ads/zerospike/private-key.pem"}

`orgId` icin `--whoami`, `adamId` icin `--find-app zerospike` calistirin.

## Komutlar

    node scripts/apple-ads-setup.mjs --dry-run --market all   # varsayilan, aga cikmaz
    node scripts/apple-ads-setup.mjs --whoami                 # orgId listesi
    node scripts/apple-ads-setup.mjs --find-app zerospike     # adamId
    node scripts/apple-ads-setup.mjs --apply --market de      # olusturur, tekrar calistirilabilir
    node scripts/apple-ads-setup.mjs --export-search-terms --campaign ZS-DE-Discovery --days 7

Kampanyalar `PAUSED` olusturulur; yayina almayi konsoldan siz yaparsiniz.
Tum secenekler icin `--help`.
