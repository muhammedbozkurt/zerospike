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
| **US** | Mikro test, ~%17, 14 gunde kes | 240 gosterimde 0 tap; modelde indirme basina 1,78 EUR maliyet, tavan 1,16 EUR. Kanit olmadan buyutulmez. Yapi: bolum 6b |
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

## 5b. v1 sonucu (26 Agustos - 2 Eylul 2026)

Ilk test yapisi (ZS-DE-Search, ZS-DE-Discovery, ZS-FR-Search, toplam 3 kampanya) canli kosuldu.
Sonuc: DE CPT 1,00 $, CPA 3,48 $, 2 indirme; tum tiklar Brand-Broad marka teriminden geldi, Generic/Core
exact kelimeler sifir tiklama cekti. Discovery-SearchMatch 0,20 $ teklifle 30 gosterim, 0 tik aldi.

Ders: marka trafigi tek butce havuzunu tuketiyor ve exact generic kelimeler hic sans bulamiyor; asagidaki
v2 yapisi butceyi kampanya bazinda ayirarak bunu duzeltmek icin tasarlandi.

## 6. Kampanya yapisi: v2 (Eylul 2026)

Pazar basina 4 kampanya, butce ayrimi marka trafiginin generic butceyi yemesini engeller.

| Kampanya | Butce/gun | Eslesme | Ad group'lar | Teklif araligi |
|---|---|---|---|---|
| ZS-DE-Brand | 1,00 $ | Exact | Brand | 0,45 $ |
| ZS-DE-Generic | 5,00 $ | Exact | Glucose-Diary, Insulin-Log, HbA1c-Report, Carbs-Food, Injection-Rotation, Condition, Reminders, Privacy, Watch-Widget | 0,40-0,90 $ |
| ZS-DE-Competitor | 1,50 $ | Exact | Comp-Core | 0,60-0,90 $ |
| ZS-DE-Discovery | 3,00 $ | Broad + Search Match | Broad (0,60-0,80 $), SearchMatch (kelime yok, Search Match acik, varsayilan CPT 0,50 $) | |
| ZS-FR-Brand | 1,00 $ | Exact | Brand | 0,40 $ |
| ZS-FR-Generic | 2,00 $ | Exact | ayni 9 ad group | 0,20-0,40 $ |
| ZS-FR-Competitor | 1,00 $ | Exact | Comp-Core | 0,30-0,40 $ |
| ZS-FR-Discovery | 2,00 $ | Broad + Search Match | Broad (0,30 $), SearchMatch (0,20 $) | |

Toplam tavan 16,50 $/gun; gercek harcama v1'de tavanin bes'te biriydi.

Ortak ayarlar: yalniz Search Results yerlesimi; iPhone; Audience New Users (tum kampanyalar); yas/cinsiyet/
gun-saat hedeflemesi yok; Search Match yalniz Discovery/SearchMatch ad group'unda acik, diger tum ad
group'larda kapali.

Negatifler: negatives-XX.csv dort kampanyaya da uygulanir; negatives-XX-discovery.csv yalniz Discovery'ye
(paylasilan liste + wearable marka negatifleri + tum exact kelimelerin exact negatifi).

CPP eslemesi (ad group -> custom product page): Glucose-Diary, HbA1c-Report, Reminders -> cpp-glucose-diary;
Carbs-Food -> cpp-carb-tracking; Injection-Rotation, Insulin-Log -> cpp-injection-rotation; Condition,
Privacy, Watch-Widget, Brand, Comp-Core, Discovery -> varsayilan urun sayfasi (Privacy, Gestational,
Doctor-Report, Watch CPP'leri sonraki tur).

Apple oneri CSV notu: 26 Agustos - 2 Eylul donemi icin Apple'in sundugu 166 satirlik oneri CSV'si incelendi;
tamami sosyal medya ve fitness marka terimiydi, diyabet ile ilgili tek terim yoktu. Liste dogrudan
kullanilmadi, yalniz wearable/fitness marka isimleri Discovery negatif listesine alindi.

Harvest dongusu: haftada bir Discovery Search Terms raporu okunur; 2+ indirme veya 5+ tik getiren sorgu
Generic'e exact kelime olarak tasinir ve ayni terim Discovery negatifine exact olarak eklenir.

Kelime kapisi: 30 tik 0 indirme = duraklat; 10+ indirme ve CPA < 3 $ = teklif +%20. Kanal esigi: indirme ->
odeyen %5,3 (20-30 indirme birikince okunur, RevenueCat Charts -> Segment).

## 6b. US test kampanyasi (Ekim 2026)

US icin tek kampanya, 14 gun, toplam tavan 49 $ (3,50 $/gun x 14). Amac: US'de gunluk/takip diliyle gosterim,
TTR ve indirme sinyali toplamak; kanit olmadan olceklenmez. Bolum 5'teki US payi (4 EUR/gun) yerine onayli
3,50 $/gun kullanilir.

| Ayar | Deger |
|---|---|
| Kampanya | ZS-US-Test, storefront US, dil en, yalniz Search Results yerlesimi |
| Butce | 3,50 $/gun; Apple gunluk butcenin teklifi asmasini ister (3,50 > 0,45) |
| Takvim | `--start` ile release gunu (UTC 00:00), bitis +14 gun kampanya `endTime`; PAUSED kurulur, `apple-ads-status.mjs enabled ZS-US-Test` ile acilir |
| Cihaz ve kitle | iPhone + iPad; tum kullanicilar (New Users kisiti yok); yas, cinsiyet, gun-saat hedefi yok |
| Ad group SearchMatch | Search Match acik, kelime yok, teklif 0,45 $ |
| Ad group Broad | Search Match kapali, 10 Broad kelime, teklif 0,45 $: blood sugar log / tracker / diary, glucose log / tracker, diabetes diary / log / tracker, insulin log, carb counter diabetes |
| Ad group Brand | Exact zerospike, zero spike, zerospike app; teklif 0,30 $ |
| Negatifler | `negatives-us.csv`, 70 satir Broad, kampanya duzeyi: regulasyon ve doz hesaplayici terimleri, CGM/pompa/glukometre markalari, oyun ve fitness |
| Default Ad | her ad group icin kontrol edilir; Search Results'ta Apple saglar, eksikse `--create-default-ad` veya konsoldan elle |

Kararlar ve riskler:

- Rakip uygulama adlari bu turda negatif degil: Search Match ve Broad'in ne yakaladigini gormek icin acik birakildi.
  Rakip adlari ve alakasiz terimler rapordan okunup sonraki turda negatife alinir.
- Regulasyon: Broad kelimelerde doz ima eden terim yok ("insulin log" kayit cercevesidir). Negatif listesi
  "calculator", doz, bolus ve oran terimlerini keser; reklam dili gunluk, takip, hatirlatici cercevesinde kalir.
- Butce/teklif orani Broad ve SearchMatch'te 7,8x, Brand'de 11,7x. v1 dersi dusuk oranda dagitimin bogulmasi ve
  ~20x hedefiydi; 48 saat sonra gosterim yoksa once bu oran ve teklifler gozden gecirilir.
- Toplam (lifetime) butce alani Campaign API 5.6'da kalkti; tavan gunluk butce x gun ile saglanir (49 $), sure
  asimi kampanya bitis tarihiyle durur.
- Okuma: `node scripts/apple-ads-report.mjs --days 7`. Durdurma esigi bolum 7'dedir (US: 100 tap sonrasi indirme
  maliyeti 1,50 EUR ustunde); 14. gun sonunda sonuc o satirla okunur, genisletme karari ayri verilir.

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
| `keywords-de.csv` | v2: 125 kelime, 4 kampanya (Brand/Generic/Competitor/Discovery), 12 ad group |
| `keywords-fr.csv` | v2: 104 kelime, ayni kampanya/ad group yapisi |
| `keywords-tr.csv` | 34 kelime (v1, degismedi) |
| `keywords-us.csv` | v2: 13 kelime, 1 kampanya (ZS-US-Test), 2 CSV ad group (Broad, Brand); SearchMatch ad group script tarafindan eklenir |
| `negatives-de.csv`, `negatives-fr.csv` | Paylasilan negatif liste, dort kampanyaya da uygulanir (DE 37, FR 30 satir); regulasyon, urun uyumsuzlugu, kategori disi, dusuk niyet |
| `negatives-de-discovery.csv`, `negatives-fr-discovery.csv` | Yalniz Discovery kampanyasina; paylasilan liste + wearable/fitness marka negatifleri + Brand/Generic/Competitor'daki tum exact kelimelerin exact negatifi (DE 178, FR 139 satir) |
| `negatives-tr.csv` | v1, degismedi |
| `negatives-us.csv` | 70 satir Broad (30 v1 + 40 yeni), yalniz ZS-US-Test'e yazilir; ayri Discovery listesi yok |
| `cpp-glucose-diary.md`, `cpp-injection-rotation.md`, `cpp-carb-tracking.md` | Ekran goruntusu sirasi ve Promotional Text |
| `privacy-2.3.1.md` | Attribution gizlilik beyani: app.json privacy manifest blogu ve App Store Connect formu kontrol listesi |

`keywords-*.csv` 6 sutunlu: `campaign,ad group,keyword,match type,bid,note`. `negatives-*.csv` 5 sutunlu:
`campaign,ad group,keyword,match type,note`. `note` sutunu gerekcedir, konsola girmez. Ice aktarmaya hazir
dilim: `cut -d, -f1-5 keywords-de.csv`. Yalniz kelime listesi (Apple Ads "Add Keywords" kutusuna
yapistirmak icin): `tail -n +2 keywords-de.csv | cut -d, -f3 | grep .`

Teklifler **USD** cinsindendir. Apple Ads hesabi USD tabanli Advanced olarak zaten acik, hesap para
birimi kurulumda belirlenir ve degistirilemez, dolayisiyla bu bir karar degil veridir. Teklifler EUR'dan
cevrilmedi; her ad group icin hedef CPT'ye capalanip yeniden hesaplandi, grup ici goreli farklar korundu.
