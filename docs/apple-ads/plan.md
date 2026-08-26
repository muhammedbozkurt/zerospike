# zerospike Apple Ads plani (2026-08-26)

Bu dosya artifact'in ozetidir. Veri: `greeneyeapp-pulse/data/pulse.db`, zerospike = `apple_app_id 6778782351`,
donem 2026-06-17 .. 2026-08-24 (69 gun). Fiyat referansi `docs/pricing-2026-08.md`, dil ve kapsam kurallari
`docs/aso-appstore.md`.

## 1. Karar ozeti

Kampanya kurulmadan once iki on kosul yapilmali; bunlar yapilmadan her butce kademesi modelde
yaklasik %40 zarar veriyor, yapildiginda basa bas seviyeye geliyor.

1. **Small Business Program kaydi.** Tek gercek satistan geri hesap: 89,99 EUR brut, %19 KDV, net 52,94 EUR.
   Bu yalniz **%30 komisyon** ile tutuyor (89,99 / 1,19 x 0,70 = 52,93). Yani hesap SBP'ye kayitli gorunmuyor.
   Kayit komisyonu %15'e indirir, net geliri %21 artirir. Maliyeti sifir.
2. **Fiyat artisi.** `docs/pricing-2026-08.md` tablosunun uygulanmasi (DE aylik 6,99 / yillik 39,99 / lifetime 119,99).

Ikisi birlikte DE'de indirme basina LTV tavanini 0,49 USD'den 0,79 USD'ye cikariyor.

## 2. Veri ozeti

| Pazar | Gosterim | Arama payi | Tap | Urun sayfasi | Yeni indirme | TTR | Sayfa -> indirme |
|---|---|---|---|---|---|---|---|
| TR | 255 | %67 | 12 | 30 | 3 | %4,71 | %10,0 |
| US | 240 | %100 | 0 | 3 | 2 | %0,00 | %66,7 |
| DE | 226 | %97 | 16 | 19 | 6 | %7,08 | %31,6 |
| FR | 142 | %100 | 2 | 6 | 2 | %1,41 | %33,3 |
| MX | 103 | %100 | 2 | 4 | 2 | %1,94 | %50,0 |
| JP | 80 | %100 | 0 | 5 | 0 | %0,00 | %0,0 |
| **Toplam** | **1.316** | **%93** | **37** | **75** | **18** | **%2,81** | **%24,0** |

- Gelir: **tek satis**. 2026-08-13, DE, lifetime, net 52,94 EUR = 61,06 USD. Baska hicbir odeme yok.
- RevenueCat: zerospike icin deneme baslangici, deneme donusumu, ulke ve paket kirilimi **YOK**.
  `rc_chart_points` yalniz 4 grafik tutuyor, segment alani bos, tum projelerde MRR 0.
- GA4: D1 %35,1 (n=92), D7 %19,6 (n=38), D30 %36,5 (n=15, guvenilmez). iOS her metrikte Android'in onunde.
  Aktivasyon hunisi metrigi yok, `app_events` yalniz `version_released` tutuyor.
- Anahtar kelime: 9 ulkede 45 takip edilen kelime, 16'si siralaniyor. Siralanmayanlar reklamin birincil hedefi.

## 3. Hedef pazarlar

| Storefront | Karar | Gerekce |
|---|---|---|
| **DE** | Cekirdek, butcenin ~%50'si | En yuksek TTR (%7,08), arama kaynakli 6/6 indirme, tek odeme yapan pazar, EUR fiyatlama, 5 takip kelimesinin 3'unde organik siralama yok |
| **FR** | Ikincil, ~%21 | EUR pazar, %100 arama kaynakli, "comptage des glucides" siralanmiyor, rakip yogunlugu DE'den dusuk |
| **TR** | Kucuk ve capali, ~%12 | En cok gosterim ama gelir sifir; tiklama cok ucuz oldugu icin olcum altyapisini dogrulamanin en ucuz yeri. Marka savunmasi zorunlu |
| **US** | Mikro test, ~%17, 14 gunde kes | 240 gosterimde 0 tap; modelde indirme basina 1,78 EUR maliyet, tavan 1,16 EUR. Kanit olmadan buyutulmez |
| ES, IT | Faz 2 | Olcek kademesinde acilir, test fazinda degil |
| JP | Disarida | 80 gosterim, 0 tap, 0 indirme. Rank 1 oldugumuz halde tiklanmiyoruz; once urun sayfasi duzeltilir |
| MX, BR, SA | Disarida | Fiyat tablosunda dusuk bant, ARPU kaniti yok |

## 4. Birim ekonomi

LTV/odeyen = (%30 aylik x net aylik x 3,5 ay) + (%55 yillik x net yillik x 1,25) + (%15 lifetime x net lifetime).
Net = brut / (1 + KDV) x (1 - komisyon). Indirme basina LTV = LTV/odeyen x indirme->odeyen orani.

| Pazar | Senaryo | LTV/odeyen | i2p | LTV/indirme = CPA tavani | Hedef CPA (%40 marj) | Hedef CPT |
|---|---|---|---|---|---|---|
| DE | mevcut fiyat + %30 | 27,00 $ | %3,0 | 0,81 $ | 0,49 $ | 0,24 $ |
| DE | onerilen fiyat + SBP | 44,01 $ | %3,0 | **1,32 $** | 0,79 $ | 0,40 $ |
| FR | onerilen fiyat + SBP | 43,64 $ | %2,5 | 1,09 $ | 0,65 $ | 0,33 $ |
| TR | onerilen fiyat + SBP | 16,81 $ | %1,5 | 0,25 $ | 0,15 $ | 0,08 $ |
| US | onerilen fiyat + SBP | 44,91 $ | %3,0 | 1,35 $ | 0,81 $ | 0,40 $ |

Tum plan **indirme->odeyen oranina** dayaniyor ve bu oran veride yok. DE duyarliligi:
%2,0 ise ROI -32%, %3,0 ise +2%, %4,0 ise +36%. Test fazinin tek isi bu sayiyi olcmektir.

## 5. Butce kademeleri

Etkin CPT varsayimi DE 0,50 / FR 0,45 / TR 0,11 / US 0,80 EUR; tap->indirme %45; fiili harcama butcenin %60'i.

| Kademe | Gunluk | Donem | Beklenen indirme | Deneme | Odeyen | ROI (simdi) | ROI (on kosullar sonrasi) |
|---|---|---|---|---|---|---|---|
| Test, 14 gun | 24 EUR | 336 EUR | ~255 | ~15 | ~6 | %-43 | %-8 |
| Olcek, 30 gun | 55 EUR | 1.650 EUR | ~1.205 | ~77 | ~29 | %-39 | %-2 |
| Agresif, 30 gun | 153 EUR | 4.590 EUR | ~3.123 | ~207 | ~79 | %-39 | %0 |

Dagilim: test DE 12 / FR 5 / TR 3 / US 4. Olcek DE 35 / FR 15 / TR 5. Agresif DE 80 / FR 35 / ES 15 / IT 15 / TR 8.

## 5b. Ilk test: 80 USD

Butce 80 USD'ye indirilince 5. bolumdeki dort storefront'luk yapi tasinamaz: 15 kampanyaya bolunen
80 dolar kampanya basina 5 dolar demektir ve hicbir seyi olcemez. Ilk test **DE ve TR ile sinirli**,
Competitor kampanyalari ve FR ile US faz 2'ye birakildi.

| Kampanya | Ad group | Gunluk | 14 gun | Max teklif |
|---|---|---|---|---|
| ZS-DE-Search | Brand, Core, Carbs-Food, Injection-Rotation | 2,70 $ | 37,80 $ | 0,45 |
| ZS-DE-Discovery | Discovery-SearchMatch | 1,00 $ | 14,00 $ | 0,30 |
| ZS-FR-Search | Brand, Core | 2,00 $ | 28,00 $ | 0,40 |
| **Toplam** | | **5,70 $** | **79,80 $** | |

Apple kampanya gunluk butcesinin Max CPT teklifinden buyuk olmasini sart kosuyor. 80 dolar alti
kampanyaya bolununce gunluk butceler tekliflerin altina dusuyordu; bu yuzden kampanya sayisi uce
indirildi. Butce kampanya seviyesinde, teklif ve Search Match ad group seviyesinde oldugu icin
birlestirme hicbir kontrolu kaybettirmiyor. Tek odun: marka artik kendi butce havuzunda degil.

Orta senaryoda (butcenin %65'i harcanir) beklenen: ~243 tap, ~109 indirme, ~51 $ fiili harcama,
indirme basina ~0,47 $.

**Bu butcenin olcemedigi sey:** indirme -> odeyen orani. Beklenen odeyen sayisi ~2, yani istatistiksel
olarak hicbir sey. 80 dolar **CPT'yi ve tap -> indirme oranini** olcer, LTV'yi olcmez. Planin dayandigi
%3 varsayimi ancak olcek kademesinde sinanabilir. Bu bir kusur degil dogru sira: gercek CPT hedef
bandin disindaysa zaten olcek kademesine hic gecilmeyecek ve 80 dolar bunu 300 dolar harcamadan soyler.

## 6. Kampanya yapisi

Storefront basina ayri kampanya (butce kampanya seviyesinde, pazarlarin birbirinin butcesini yemesi engellenir).

| Kampanya | Ad group | Eslesme | Search Match | CPP |
|---|---|---|---|---|
| ZS-xx-Brand | Brand-Core, Brand-Broad | Exact + Broad | Kapali | Glucose Diary |
| ZS-xx-Generic | Glucose-Diary, HbA1c-Trends, Carbs-Food, Injection-Rotation, Condition | Exact | Kapali | Grup basina (bkz. cpp-*.md) |
| ZS-xx-Competitor | Comp-Core | Exact | Kapali | Glucose Diary |
| ZS-xx-Discovery | Discovery-SearchMatch | kelime yok | **Acik** | Glucose Diary |

Her ad group: cihaz yalniz **iPhone**, musteri tipi **yalniz yeni kullanicilar**, yas ve cinsiyet hedeflemesi
**yok**, gun ici zamanlama **yok**. Search Match yalniz Discovery'de. Negatif listeler kampanya seviyesinde.

## 7. Durdurma ve olcekleme esikleri

| Seviye | Durdur | Olcekle |
|---|---|---|
| Kelime | 30 tap ve 0 indirme | 10+ indirme ve indirme maliyeti tavanin %80'i altinda: teklif +%20 |
| Ad group | 14 gun sonunda indirme maliyeti tavanin 1,5 katinin uzerinde | 20+ indirme ve tavan altinda: butce +%50 |
| Kampanya | US: 100 tap sonrasi indirme maliyeti 1,50 EUR ustunde | DE: i2p %3'un uzerinde olcuyorsa olcek kademesine gec |
| Hesap | Toplam harcama 336 EUR'yu 14 gunden once bulursa hepsi durur | i2p %4 uzerinde ise agresif kademe |

## 8. Olcum zinciri

Apple Ads attribution -> AdServices token (kod eklendi, `lib/services/purchases.ts:85`) ->
RevenueCat musteri ozniteligi -> pulse.

Haftalik izlenen: TTR, tap->indirme, indirme maliyeti, indirme->deneme, deneme->ucretli, D7 tutunma.
Deneme 7 gun oldugu icin donusum sinyali kurulumdan ~10 gun sonra gelir: **14 gun harca, 14 gun daha
olcmeden olcekleme yapma.**

## 9. Dosyalar

| Dosya | Icerik |
|---|---|
| `keywords-de.csv` | 51 kelime, 4 kampanya, 8 ad group |
| `keywords-fr.csv` | 37 kelime |
| `keywords-tr.csv` | 34 kelime |
| `keywords-us.csv` | 14 kelime (mikro test) |
| `negatives-<ulke>.csv` | Ulke basina 25-30 negatif; regulasyon, urun uyumsuzlugu, kategori disi, dusuk niyet |
| `cpp-glucose-diary.md`, `cpp-injection-rotation.md`, `cpp-carb-tracking.md` | Ekran goruntusu sirasi ve Promotional Text |
| `privacy-2.3.1.md` | Attribution gizlilik beyani: app.json privacy manifest blogu ve App Store Connect formu kontrol listesi |

CSV'ler 6 sutunlu: `campaign,ad group,keyword,match type,bid,note`. `note` sutunu gerekcedir, konsola
girmez. Ice aktarmaya hazir dilim: `cut -d, -f1-5 keywords-de.csv`. Yalniz kelime listesi (Apple Ads
"Add Keywords" kutusuna yapistirmak icin): `tail -n +2 keywords-de.csv | cut -d, -f3 | grep .`

Teklifler **USD** cinsindendir. Apple Ads hesabi USD tabanli Advanced olarak zaten acik, hesap para
birimi kurulumda belirlenir ve degistirilemez, dolayisiyla bu bir karar degil veridir. Teklifler EUR'dan
cevrilmedi; her ad group icin hedef CPT'ye capalanip yeniden hesaplandi, grup ici goreli farklar korundu.
