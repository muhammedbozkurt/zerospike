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

## US test kampanyasi (ZS-US-Test)

14 gunluk, tek kampanyali test: gunluk 3.50 USD x 14 gun = 49 USD tavan. Tasarim ve esikler:
`docs/apple-ads/plan.md` bolum 6b. Veri: `keywords-us.csv` (13 kelime) ve `negatives-us.csv` (70 negatif).

    node scripts/apple-ads-setup.mjs --dry-run --market us                    # plani gosterir, aga cikmaz
    node scripts/apple-ads-setup.mjs --apply --market us --start 2026-10-14   # kampanya PAUSED olusur
    node scripts/apple-ads-status.mjs enabled ZS-US-Test                      # yayina alir
    node scripts/apple-ads-status.mjs paused ZS-US-Test                       # durdurur

- `--start YYYY-MM-DD` release gunudur (UTC 00:00); bitis her zaman baslangic + 14 gundur ve kampanyaya
  `endTime` olarak yazilir, sure dolunca kampanya kendiliginden biter. US icin `--apply` sirasinda zorunludur
  (unutulursa hicbir sey olusturulmadan hata verir). `--start now` su an + 15 dk demektir; gecmis tarih verilirse
  baslangic simdiye cekilir.
- Kampanya gelecek tarihli `startTime` ile `enabled` yapilirsa baslangic gunune kadar bekler; release gununu
  beklemeden de acilabilir.
- `status` scriptinde kampanya on eki verin (`ZS-US-Test`). Onek vermezseniz `ZS-` ile baslayan tum kampanyalar
  (DE/FR dahil) acilir.
- Yapi: 3 ad group. `SearchMatch` (Search Match acik, kelime yok, 0.45), `Broad` (Search Match kapali, 10 broad
  kelime, 0.45), `Brand` (exact zerospike, zero spike, zerospike app, 0.30). Cihaz iPhone + iPad, kitle tum
  kullanicilar (New Users kisiti yok), yas ve cinsiyet hedefi yok. Negatifler kampanya duzeyinde.
- Apple gunluk butcenin teklifi asmasini ister (3.50 > 0.45); script bunu plan asamasinda kontrol eder.
- Toplam (lifetime) butce alani Campaign API 5.6'da kaldirildi; toplam tavan gunluk butce x 14 gun = 49 USD ile
  saglanir (hedef 50 USD).
- Default Ad: script her ad group icin ad listesini kontrol eder. Search Results ad group'unda varsayilan ad
  Apple tarafindan saglanmasi beklenir (hesapta DEFAULT_PRODUCT_PAGE creative'i yok, konsol kampanyalari yine de
  calisti), bu yuzden listede ad yoksa yalniz bilgi basilir. Gosterim gelmezse ve ad group `NO_AVAILABLE_ADS`
  gosterirse ayni komutu `--create-default-ad` ile tekrar calistirin (creative'i bulur veya olusturur, Default Ad
  ekler; kampanya ve ad group'lar zaten var oldugu icin atlanir). Bu uclar belgelenmis ama canli denenmedi; hata
  olursa kurulum durmaz, `UYARI` basilir, Default Ad konsolda ad group > Ads sekmesinden elle eklenir.
- Mevcut kampanyanin takvimi guncellenmez; farkliysa `UYARI` basilir. `--market all` artik us'u da kapsar,
  yalniz de/fr icin `--market de` ve `--market fr` kullanin.

## Rapor (apple-ads-report.mjs)

Salt okunur; hicbir sey olusturmaz veya degistirmez. `config.json` ve JWT akisi setup scriptiyle aynidir.

    node scripts/apple-ads-report.mjs                                  # son 7 gun, ZS-US ile baslayan kampanyalar
    node scripts/apple-ads-report.mjs --days 14 --prefix ZS-US-Test
    node scripts/apple-ads-report.mjs --days 3 --top 50 > rapor.md     # dosyaya markdown

Secenekler: `--days N` (bugun dahil son N gun, varsayilan 7), `--prefix` (kampanya adi on eki, varsayilan `ZS-US`),
`--top N` (arama terimi tablolarinda en fazla N satir, varsayilan 25).

Cikti stdout'a markdown olarak gelir. Tablolar: kampanya, ad group ve keyword duzeyinde Impr (gosterim), Tap, TTR,
Kur (kurulum), Yeni (yeni indirme), Harcama, CPT (ortalama tap maliyeti), CPA (harcama / kurulum); ardindan
Search Match arama terimleri (kaynak AUTO) ve hedefli kelimelerin arama terimleri (Broad ve Exact) ayri tablolar.
Her tablonun son satiri toplamdir.

- Apple 502 dondururse istek 2 kez daha denenir (3 sn ve 6 sn bekleyerek); tekrar denemeler stderr'e yazilir.
- Bir bolum hata verirse (ornek: arama terimi raporu) hata o bolumde `> HATA` olarak gorunur, kalan tablolar
  yine basilir ve cikis kodu 1 olur.
- Apple arama terimi raporunda 10 gosterimin altindaki terimleri gizler; kucuk butcede cogu terim `diger`
  satirinda kalir. Raporlar birkac saat gecikmelidir, sifir gosterim kararini 24 saatten once vermeyin.
- Tarihler UTC gunu olarak hesaplanir, rapor saat dilimi ORTZ'dir.
