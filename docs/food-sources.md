# Yiyecek veri kaynaklari

Erisim tarihi: 2026-10-19. Satirlar lib/db/seedCarb.ts icinde; scripts/seed.test.ts (bolum J) src, srcId, aralik ve cakisma kurallarini zorlar. Kaynaksiz yiyecek eklenmez.

## Kaynaklar ve lisanslar

| Kaynak | Kullanim | Lisans |
|---|---|---|
| USDA FoodData Central (SR Legacy, Survey/FNDDS) | karbonhidrat (by difference, g/100 g), ev olcusu gramajlari | Kamu malı (CC0). Atif zorunlu degil, onerilir: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, fdc.nal.usda.gov." |
| Open Food Facts (OFF) | uretici etiket degeri `nutriments.carbohydrates_100g`; kategori medyani | ODbL 1.0 (veritabani), DbCL (icerik). Atif ve share-alike yukumlulugu: "Open Food Facts contributors, openfoodfacts.org" |

DOGRULANMADI: kullanici lisans onayi. OFF'tan alinan 4 sayisal deger uygulamaya gomulu; bunun ODbL anlaminda "turev veritabani" sayilip sayilmadigi belirsiz (tek tek olgusal sayilar, medyanla uretilmis). Onay gelene kadar OFF satirlari kaynak gostergesiyle (src: "off", srcId) tutulur; gerekirse tek commit'te cikarilabilir. Uygulama icinde "Open Food Facts katkicilari" atif metni henuz YOK (app/** bu partinin disinda).

BLS ve TurKomp: lisans onayi bekleniyor, eklenmedi.

## Eklenen yiyecekler (10)

OFF satirlarinda carb, ilgili OFF kategorisindeki carbohydrates_100g degeri olan urunlerin yuvarlanmis medyanidir; srcId referans urunun barkodudur (https://world.openfoodfacts.org/product/BARKOD).

| Yiyecek (en) | src | srcId | 100 g karb | Not |
|---|---|---|---|---|
| Marie biscuit | usda | 171867 | 70.5 | SR Legacy "Cookies, Marie biscuit"; Galletas María karsiligi |
| Poppadom (papad) | usda | 168106 | 59.9 | SR Legacy "Papad" |
| Roast potato | usda | 2709402 | 20.45 | FNDDS "Potato, roasted, NFS"; porsiyon medium 170 g, cup 160 g |
| Pan-fried potatoes (home fries) | usda | 2709474 | 18.76 | FNDDS "Potato, home fries, from fresh"; Bratkartoffeln karsiligi; cup 200 g |
| Natillas (custard) | usda | 2705682 | 10.97 | FNDDS "Custard"; yakin karsilik, ev yapimi natillas tarife gore degisir; cup 260 g, tipik 130 g |
| Chouquette (plain cream puff) | usda | 2708033 | 22.8 | FNDDS "Cream puff, no filling or icing"; 1 adet 27 g |
| Digestive biscuit | off | 5010251830160 | 63 | kategori Digestives, n=3 (60 / 62.8 / 69), medyan 62.8 |
| Yorkshire pudding | off | 5052004690065 | 36 | kategori Yorkshire puddings, n=10, medyan 36.3, aralik 32.3-38.9 |
| Flapjack | off | 00364317 | 58 | kategori Flapjacks, n=11, medyan 57.6, aralik 39.7-62.1 |
| Oatcake | off | 5015168000019 | 62 | kategori Oatcakes, n=6, medyan 62.4, aralik 45.5-68 |

OFF verisi etiket degeridir ve urune gore degisir; USDA satirlari uretici markasiz genel girislerdir. Ev olcusu yalniz USDA household measure ile verilen gramajdan alinmistir; gramaj belirsiz oldugu icin OFF satirlarinda ve Marie/papad satirlarinda porsiyon yok.

## Zaten katalogda olanlar (eklenmedi)

Sekerpare, Salgam suyu, Eclair, Weissbier (Wheat beer), Nutella (Hazelnut spread), crisps (Potato chips), jacket potato (Baked potato), Reibekuchen (Potato pancakes), Hash browns, Biscuit, Flan.

## KAYNAK YOK, eklenmez

- Cornish pasty, Weetabix, Sticky toffee pudding, Ensaimada, Rosquilla, Sobrasada, Chip butty, Rich tea, Hobnobs (marka): USDA'da karsilik yok; OFF kategori sorgusu 0 urun dondurdu ya da API 503 verdi (arama terimi sorgusu filtre uygulamadi, sonuc kullanilmadi). Dogrulanmis kayit olmadan eklenmedi.
- Weetabix icin USDA shredded wheat ayni urun degil, kullanilmadi.
