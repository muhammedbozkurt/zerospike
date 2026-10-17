# CLAUDE.md: zerospike

zerospike: diyabet gunlugu uygulamasi (Expo + RN + TS, iOS + Android). Saglik verisi hassastir; dil ve kapsam regulasyona gore sinirlidir.

## Kapilar

- npm run typecheck (i18n-check dahil)
- npm run i18n:check
- npm run theme:lint

## Sert kurallar (ihlali store reddi)

- Regulasyon dili: "uyarir", "hipoglisemi alarmi", "tani", "tedavi", "onerilen doz" ve turevleri YASAK; izinli cerceve gunluk, takip, hatirlaticidir. Uygulama tibbi cihaz gibi konusamaz.
- Health Connect Android'de aktif (Play kurulus hesabi alindi). Kan sekeri okuma/yazma Play saglik veri beyanina baglidir; beyan onaylanmadan production release cikmaz.
- Health Connect'te insulin veri turu YOKTUR ve aktif dakika okunmaz: icgoru saglik ozeti karti iOS-only kalir. Android okuma penceresi 30 gun (iOS 90).
- Her yeni string 9 dilde (en/tr/de/fr/es/it/pt/ar/ja), Turkce diyakritikleri dogru.
- HITAP: her dil TEK bir hitap kullanir, resmi olan. de = Sie/Ihr, fr = vous/votre, es = usted/su, tr = cogul-nazik ("-niz/-iniz"), it = Lei/Suo, pt = voce/sua (pt-BR), ar = resmi MSA, ja = teineigo (desu/masu). Ayni ekranda iki hitap karisamaz; yeni string eklerken o dosyanin hitabina uy.
- Yuzde isareti elle yazilmaz: lib/format pct() / pctParts() kullanilir (tr "%92", en "92%", de/fr/es "92 %"). Para icin money(); Intl'e undefined locale gecilmez.
- Buyuk harf her zaman lib/upper upper() ile; duz toUpperCase() Turkce "i" yi bozar.
- Tema: yeni renk yalniz lib/theme token'indan (THEME / useTheme) gelir; app, components ve lib UI kodunda sabit hex ve rgba( yasak (kapsam disi: report.ts, androidWidget.ts, pdfColors.ts, scWidgets, wear). Kapi: npm run theme:lint.
- Hedef aralik varsayilanlarinin tek kaynagi lib/diabetesDefaults.ts (TARGET_DEFAULTS_MGDL, mg/dL, tipe gore); esik ve donusum lib/glucose.ts. Yeni kopya sabit eklenmez.
- Yeni UI metninde tasma kontrolu en uzun ceviriyle (genelde Almanca) yapilir; iOS metin API'leri (adjustsFontSizeToFit) Android'de sessizce kirpar. de/fr/es gercek odeme yapan kullanici dilleridir.
