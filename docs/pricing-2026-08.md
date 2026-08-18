# zerospike fiyat politikasi - analiz ve oneri (2026-08, 2.0.0 oncesi)

Karar sahibi: Muhammed. Bu dosya oneri ve uygulama adimlaridir; magaza fiyatlari
App Store Connect / RevenueCat / Play Console uzerinden elle degistirilir.

## Mevcut durum (ekran goruntulerinden, 2026-08-17)

| Paket | US | TR |
|---|---|---|
| Aylik | $4.99 | 149,99 TL |
| Yillik (7 gun deneme) | $29.99 | 499,99 TL |
| Yillik downsell (denemesiz) | $19.99 | (oranli) |
| Lifetime | $109.99 | 2.499,99 TL |

## Degerlendirme

1. Saglik/wellness kategorisinde abonelik normlari $8-15/ay ve $40-80/yil bandinda.
   zerospike'in Pro seti (Insights, PDF doktor raporu, Health senkron, coklu profil,
   9 dil, ilac takibi) bu banda rahat girer; mevcut fiyatlar dusuk kaliyor.
2. Aylik $4.99 yillik icin zayif bir canta (anchor): yillik/aylik orani 6x,
   aylik cok ucuz oldugu icin yilliga gecis baskisi dusuk. Aylik yukselirse
   yillik daha cazip gorunur.
3. Lifetime $109.99 = ~3.7 yillik; makul, Almanya'dan organik lifetime satisi
   fiyat toleransinin kanitidir.
4. Deneme suresi: 7 gunde kalinmasi onerilir. Gunluk tutma aliskanligi ilk
   hafta olusur; aliskanlik olusan kullanicinin donusum kalitesi (iptal orani)
   daha iyidir. 3 gune indirme ancak RevenueCat deneyi olarak A/B ile test
   edilmeli, sabit karar olarak degil.
5. Downsell kurali korunmali: kod gercek indirim yoksa downsell gostermiyor;
   fiyat guncellemesinde downsell urunu her zaman standart yilligin ALTINDA
   kalmali.

## Onerilen tablo (yeni kullanicilar; mevcut aboneler ASC'de korunur)

| Bolge | Aylik | Yillik (7g deneme) | Downsell yillik | Lifetime |
|---|---|---|---|---|
| US | $6.99 | $39.99 | $24.99 | $119.99 |
| EUR (DE/FR/IT/ES) | 6,99 EUR | 39,99 EUR | 24,99 EUR | 119,99 EUR |
| TR | 199,99 TL | 699,99 TL | 449,99 TL | 2.999,99 TL |
| BR | R$ 19,90 | R$ 99,90 | R$ 69,90 | R$ 299,90 |
| Korfez (SAR/AED) | 24.99 | 129.99 | 84.99 | 399.99 |
| JP | 900 JPY | 5.800 JPY | 3.800 JPY | 15.800 JPY |

Notlar:
- Degerler ASC fiyat noktalarina yuvarlanir; en yakin resmi tier secilir.
- BR bilincli dusuk (satin alma gucu, hacim pazari); Korfez ve JP standart bant.
- Artis yalniz yeni kullanicilari etkiler; mevcut abonelerde ASC "preserve price"
  secilir (fiyat koruma), boylece odeyen Almanya kitlesi rahatsiz edilmez.

## Sabah yapilacaklar (insan, ~20 dk)

1. ASC > My Apps > zerospike > Subscriptions: aylik ve yillik fiyat noktalarini
   tabloya gore guncelle; mevcut abonelere "preserve current price" sec.
2. ASC > In-App Purchases > lifetime fiyatini guncelle.
3. RevenueCat > downsell offering'in bagli oldugu yillik urunun fiyat noktasini
   guncelle (denemesiz yillik); downsell < standart yillik kuralini dogrula.
4. Play Console (Android yayindaysa) ayni tabloyla guncelle.
5. Uygulamada dogrulama: paywall fiyatlari RevenueCat offering'den canli geldigi
   icin kod degisikligi gerekmez; sandbox hesapla paywall/downsell/winback
   ekranlarinda yeni fiyatlarin gorundugunu kontrol et.
6. Deneme suresi degisecekse (onerilmez, once A/B): ASC intro offer suresi
   degistirilir; 2.0.0 kodu deneme suresini offering'den dinamik okur, kod
   dokunusu gerekmez.
