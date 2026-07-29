# CLAUDE.md: zerospike

zerospike: diyabet gunlugu uygulamasi (Expo + RN + TS, iOS + Android). Saglik verisi hassastir; dil ve kapsam regulasyona gore sinirlidir.

## Kapilar

- npm run typecheck (i18n-check dahil)
- npm run i18n:check

## Sert kurallar (ihlali store reddi)

- Regulasyon dili: "uyarir", "hipoglisemi alarmi", "tani", "tedavi", "onerilen doz" ve turevleri YASAK; izinli cerceve gunluk, takip, hatirlaticidir. Uygulama tibbi cihaz gibi konusamaz.
- Android'e Health Connect GERI EKLENMEZ (Play kurulus hesabi sarti; sirket hesabi yok).
- Her yeni string 5 dilde (en/tr/de/fr/es), Turkce diyakritikleri dogru.
