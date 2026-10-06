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

    node scripts/apple-ads-setup.mjs --dry-run --market us                    # plani ve kampanya govdesini gosterir, aga cikmaz
    node scripts/apple-ads-setup.mjs --apply --market us                      # tarihsiz: PAUSED olusur, bitis tarihi yok
    node scripts/apple-ads-setup.mjs --apply --market us --start 2026-10-14   # yalniz baslangic gunu, bitis tarihi yok
    node scripts/apple-ads-setup.mjs --apply --market us --start 2026-10-14 --end 2026-10-28   # 14 gunluk pencere
    node scripts/apple-ads-setup.mjs --update-schedule --market us --dry-run  # mevcut kampanyaya gidecek PUT govdesini gosterir, aga cikmaz
    node scripts/apple-ads-setup.mjs --update-schedule --market us            # canli: bitis tarihini siler, kampanya ve sonra baslayan ad group baslangicini simdiye (+15 dk) ceker
    node scripts/apple-ads-status.mjs enabled ZS-US-Test                      # yayina alir
    node scripts/apple-ads-status.mjs paused ZS-US-Test                       # durdurur

- Tarih opsiyoneldir. `--start` verilmezse kampanya govdesine `startTime` ve `endTime` hic yazilmaz (Apple
  varsayilani: olusturuldugu anda baslar, bitis tarihi yok); kampanya yine `PAUSED` olusur. `--start YYYY-MM-DD`
  (UTC 00:00, release gunu) yalniz `startTime` yazar; `--start now` su an + 15 dk demektir, gecmis tarih verilirse
  baslangic simdiye cekilir. `endTime` yalniz `--end YYYY-MM-DD` ile yazilir (UTC 00:00, yani o gunun basi);
  `--end` tek basina verilemez, `--start` ister ve baslangictan sonra olmalidir. Dry-run kampanya govdesini
  (POST /campaigns) basar, hangi tarih alanlarinin gidecegi oradan gorulur.
- Kampanya gelecek tarihli `startTime` ile `enabled` yapilirsa baslangic gunune kadar bekler; release gununu
  beklemeden de acilabilir.
- `status` scriptinde kampanya on eki verin (`ZS-US-Test`). Onek vermezseniz `ZS-` ile baslayan tum kampanyalar
  (DE/FR dahil) acilir.
- Yapi: 3 ad group. `SearchMatch` (Search Match acik, kelime yok, 0.45), `Broad` (Search Match kapali, 10 broad
  kelime, 0.45), `Brand` (exact zerospike, zero spike, zerospike app, 0.30). Cihaz iPhone + iPad, kitle tum
  kullanicilar (New Users kisiti yok), yas ve cinsiyet hedefi yok. Negatifler kampanya duzeyinde.
- Apple gunluk butcenin teklifi asmasini ister (3.50 > 0.45); script bunu plan asamasinda kontrol eder.
- Toplam (lifetime) butce alani Campaign API 5.6'da kaldirildi; toplam tavan gunluk butce x 14 gun = 49 USD ile
  saglanir (hedef 50 USD). `--end` verilmediyse Apple kampanyayi kendiliginden durdurmaz; 14. gunde siz durdurun
  (`apple-ads-status.mjs paused ZS-US-Test`).
- Default Ad: script her ad group icin ad listesini kontrol eder. Search Results ad group'unda varsayilan ad
  Apple tarafindan saglanmasi beklenir (hesapta DEFAULT_PRODUCT_PAGE creative'i yok, konsol kampanyalari yine de
  calisti), bu yuzden listede ad yoksa yalniz bilgi basilir. Gosterim gelmezse ve ad group `NO_AVAILABLE_ADS`
  gosterirse ayni komutu `--create-default-ad` ile tekrar calistirin (creative'i bulur veya olusturur, Default Ad
  ekler; kampanya ve ad group'lar zaten var oldugu icin atlanir). Bu uclar belgelenmis ama canli denenmedi; hata
  olursa kurulum durmaz, `UYARI` basilir, Default Ad konsolda ad group > Ads sekmesinden elle eklenir.
- `--apply` mevcut kampanyanin takvimini guncellemez; farkliysa `UYARI` basilir. Takvimi `--update-schedule`
  duzeltir: `PUT /campaigns/{id}` govdesine yalniz `startTime` ve `endTime` koyar, durum ve butceye dokunmaz.
  `--start`/`--end` verilmezse `endTime: null` ile bitis silinir ve baslangic simdiye (+15 dk) cekilir (mevcut
  baslangic bundan once ise gonderilmez); `--start`/`--end` verilirse o tarihler yazilir. Apple baslangic
  degisikligini reddederse yalniz bitis guncellenir ve `UYARI` basilir. Sonuc `GET /campaigns/{id}` ile dogrulanir.
  Apple'in `CampaignUpdate` belgesi `startTime`/`endTime` listelemez, ama canli API 2026-10-06'da `endTime: null`
  ve one cekilen `startTime` ile calisti.
- `--update-schedule` ad group baslangiclarini da duzeltir: baslangici kampanyanin yeni baslangicindan sonra olan
  ad group, kampanya `ENABLED` olsa da kendi tarihine kadar yayina girmez (`ON_HOLD`). Bu ad group'lar
  `PUT /campaigns/{id}/adgroups/{adGroupId}` govdesi `{"startTime": ...}` ile kampanyanin baslangicina cekilir
  (AdGroupUpdate zarf istemez; Apple startTime'in simdiden buyuk olmasini ister, bu yuzden +15 dk). Daha once
  baslayan ad group'lara ve ad group durumuna (status) dokunulmaz; kampanya takvimi zaten istenen gibiyse kampanya
  icin PUT gonderilmez. Ad group listesi GET ile basilir; cekilemeyen ad group `HATA` ve cikis kodu 1 verir.
- `--market all` artik us'u da kapsar, yalniz de/fr icin `--market de` ve `--market fr` kullanin
  (`--update-schedule` yalniz `--market us` kabul eder).

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
