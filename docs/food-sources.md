# Yiyecek veri kaynaklari

Erisim tarihi: 2026-10-19. Satirlar lib/db/seedCarb.ts icinde; scripts/seed.test.ts (bolum J) src, srcId, aralik ve cakisma kurallarini zorlar. Kaynaksiz yiyecek eklenmez.

## Kaynaklar ve lisanslar

| Kaynak | Kullanim | Lisans |
|---|---|---|
| USDA FoodData Central (SR Legacy 2018-04, Survey/FNDDS 2024-10-31) | karbonhidrat (by difference, g/100 g), ev olcusu gramajlari | Kamu malı (CC0). Atif zorunlu degil, onerilir: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, fdc.nal.usda.gov." |
| Open Food Facts (OFF) | uretici etiket degeri `nutriments.carbohydrates_100g`; kategori medyani | ODbL 1.0 (veritabani), DbCL (icerik). Atif ve share-alike yukumlulugu: "Open Food Facts contributors, openfoodfacts.org" |
| Grands Moulins de Paris (GMP) urun fisi | Chouquette 100 g karb ve adet gramaji | uretici teknik fisi, yalniz olgusal sayilar |

Atif uygulama icinde: app/sources.tsx "sources.foodData" metni (9 dil).

DOGRULANMADI: kullanici lisans onayi. OFF'tan alinan sayisal degerler uygulamaya gomulu; bunun ODbL anlaminda "turev veritabani" sayilip sayilmadigi belirsiz (tek tek olgusal sayilar, medyanla uretilmis). Onay gelene kadar OFF satirlari kaynak gostergesiyle (src: "off", srcId) tutulur; gerekirse tek commit'te cikarilabilir.

BLS ve TurKomp: lisans onayi bekleniyor, eklenmedi.

## Karbonhidrat tabani

USDA "by difference" karbonhidrat lifi icerir; AB etiketleri icermez. Lifi 25 g/100 g ustu olan gidalarda (Chia tohumu 34.4 g lif, Keten tohumu 27.3 g lif) kullanilabilir karbonhidrat (karb - lif) kullanildi: Chia 42.1 -> 8, Keten (tam ve ogutulmus) 28.9 -> 2. Diger yiyeceklere dokunulmadi.

## Eklenen yiyecekler (10)

OFF satirlarinda carb, ilgili OFF kategorisindeki carbohydrates_100g degeri olan urunlerin yuvarlanmis medyanidir; srcId referans urunun barkodudur (https://world.openfoodfacts.org/product/BARKOD). Sorgu: `https://world.openfoodfacts.org/api/v2/search?categories_tags=<kategori>&fields=code,product_name,nutriments&page_size=200`, erisim 2026-10-19.

| Yiyecek (en) | src | srcId | 100 g karb | Not |
|---|---|---|---|---|
| Marie biscuit | usda | 171867 | 70.5 | SR Legacy "Cookies, Marie biscuit"; 5 biskuvi 28 g, adet 6 g (std yuvarlama) |
| Poppadom (papad) | usda | 168106 | 59.9 | SR Legacy "Papad"; adet 9 g (FDC 2707429), varsayilan porsiyon 2 adet = 18 g (katalog en az 10 g ister) |
| Roast potato | usda | 2709402 | 20.45 | FNDDS "Potato, roasted, NFS"; medium 170 g, cup 160 g |
| Pan-fried potatoes (home fries) | usda | 2709474 | 18.76 | FNDDS "Potato, home fries, from fresh"; cup 200 g |
| Natillas (custard) | off | 8411400000972 | 18 | kategori es:natillas, n=8, medyan 17.95, aralik 7.7-94; OCU etiket araligi 16-24; cup 260 g, tipik 130 g |
| Chouquette (cream puff) | std | 18404 | 45 | GMP urun fisi https://www.grandsmoulinsdeparis.com/media/fiche_technique/18404.pdf: 6.3 g karb/adet, 100 g'da 45; adet 14 g. USDA "cream puff" farkli urun, kullanilmadi |
| Digestive biscuit | off | 5010251830160 | 63 | KAYNAK ZAYIF: kategori en:digestives n=4 (58.8-67, medyan 65.5); deger urun etiketi 62.8. adet 14 g (urun etiketi) |
| Yorkshire pudding | off | 5052004690065 | 37 | kategori en:yorkshire-puddings, n=49, medyan 36.9, aralik 4.8-89.5; adet 33 g (urun etiketi) |
| Flapjack (oat bar) | off | 5017174096086 | 54 | kategori en:flapjacks, n=25, medyan 54, aralik 32.5-62.3 |
| Oatcake | off | 0612322030278 | 56 | kategori en:oatcakes, n=17, medyan 55.8, aralik 44-65.8 |

OFF verisi etiket degeridir ve urune gore degisir; USDA satirlari uretici markasiz genel girislerdir. Flapjack ve Oatcake icin porsiyon yok (gramaj belirsiz).

## Denetim duzeltmeleri (2026-10-19, katalog surumu 5)

100 g karbonhidrat: Polenta 28 -> 15 (pismis, FDC 2708374); Ispanakli borek 54 -> 28; Pasta ve Spaghetti 25 -> 30 (FDC 2708357); Tam bugday makarna 23 -> 30 (FDC 168910); Boiled potato 17 -> 20 (FDC 170440); Fried rice 26 -> 32 (FDC 2708952); Pita 48 -> 55 (FDC 174915), tr adi "Pita ekmeği"; Salep iki satiri 25/14 yerine ikisi de 14 (sutlu icecek, 200 g), tr adlari Sahlep / Sahlep (sütlü).

Ev olcusu gramaj (usda, SR Legacy ile FNDDS ayrisirsa SR Legacy): Grapefruit medium 123 -> 246 (123 g yarim meyve, FDC 174673); Potato small/medium 138/173 -> 170/213 (cig); Boiled potato medium 136 -> 167; Cupcake 35 -> 75; Bread roll 28 -> 55 (FDC 2707655); Whole wheat bread slice 28 -> 32; Multigrain slice 28 -> 36; Baguette slice 20 -> 32; Whole wheat pasta cup 140 -> 117; Onion rings 14 -> 10; Wafer 6 -> 8; Rice pilaf cup 158 -> 206; Coleslaw cup 120 -> 220; Date 24 -> 8 (24 g Medjool, 7-8 g Deglet Noor, genel "Date" 8; karbonhidrati fazla gostermemek icin kucuk deger); Biscotti 19 -> 32; Shortbread 8 -> 12; Chia tbsp 12 -> 10.

Adlar: es "Tortilla" -> "Tortilla de harina" (Ispanyolcada "tortilla" tortilla de patatas'tir); Wheat tortilla GI 30 -> 52 (Tortilla ile ayni); tr "Tavada patates kızartması" -> "Tavada sote patates"; en "Flapjack" -> "Flapjack (oat bar)"; en "Chouquette (plain cream puff)" -> "Chouquette (cream puff)"; tr portion.cup "Fincan" -> "Su bardağı". Yeniden adlandirmalar RENAMED_EN icinde.

Bilinen sinirlar: Chapati/Roti 40 g ev yapimi, USDA ticari 68 g (std olarak kaldi). Natillas, Chouquette ve Digestive tek kaynakli ya da kucuk orneklidir.

## Otomatik tarama (2026-10-19)

324 porsiyon overlay girdisi USDA'ya (SR Legacy + FNDDS) ad eslemesiyle karsilastirildi; esleme ve sapma sayilari donus raporunda. Eslemesi guvenilir olmayan ya da etiketi USDA'da bulunmayan porsiyonlar degistirilmedi.

## Zaten katalogda olanlar (eklenmedi)

Sekerpare, Salgam suyu, Eclair, Weissbier (Wheat beer), Nutella (Hazelnut spread), crisps (Potato chips), jacket potato (Baked potato), Reibekuchen (Potato pancakes), Hash browns, Biscuit, Flan.

## KAYNAK YOK, eklenmez

- Cornish pasty, Weetabix, Sticky toffee pudding, Ensaimada, Rosquilla, Sobrasada, Chip butty, Rich tea, Hobnobs (marka): USDA'da karsilik yok; OFF kategori sorgusu 0 urun dondurdu ya da API 503 verdi. Dogrulanmis kayit olmadan eklenmedi.
- Weetabix icin USDA shredded wheat ayni urun degil, kullanilmadi.
