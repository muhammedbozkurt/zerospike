# CLAUDE.md: zerospike

zerospike: diyabet gunlugu uygulamasi (Expo + RN + TS, iOS + Android). Saglik verisi hassastir; dil ve kapsam regulasyona gore sinirlidir.

## Kapilar

- npm run typecheck (i18n-check dahil)
- npm run i18n:check

## Sert kurallar (ihlali store reddi)

- Regulasyon dili: "uyarir", "hipoglisemi alarmi", "tani", "tedavi", "onerilen doz" ve turevleri YASAK; izinli cerceve gunluk, takip, hatirlaticidir. Uygulama tibbi cihaz gibi konusamaz.
- Android'e Health Connect GERI EKLENMEZ (Play kurulus hesabi sarti; sirket hesabi yok).
- Her yeni string 9 dilde (en/tr/de/fr/es/it/pt/ar/ja), Turkce diyakritikleri dogru.
- HITAP: her dil TEK bir hitap kullanir, resmi olan. de = Sie/Ihr, fr = vous/votre, es = usted/su, tr = cogul-nazik ("-niz/-iniz"), it = Lei/Suo, pt = voce/sua (pt-BR), ar = resmi MSA, ja = teineigo (desu/masu). Ayni ekranda iki hitap karisamaz; yeni string eklerken o dosyanin hitabina uy.
- Yuzde isareti elle yazilmaz: lib/format pct() / pctParts() kullanilir (tr "%92", en "92%", de/fr/es "92 %"). Para icin money(); Intl'e undefined locale gecilmez.
- Buyuk harf her zaman lib/upper upper() ile; duz toUpperCase() Turkce "i" yi bozar.
