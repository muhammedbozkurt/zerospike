# zerospike REDESIGN: MOCKUP DUZENINI SIFIRDAN INSA ET (renk degil DUZEN) — Midnight Monitor

Sen zerospike reposunda calisan bir BUILD session'isin. Onceki redesign turlari BASARISIZ:
mockup'a bakip "ekran zaten koyu tema + glukoz renkleri + StatCard kullaniyor, UYUMLU" dedi
ve VAR OLAN EKRAN DUZENINI korudu, sadece rengini/token'ini degistirdi. Kullanici uygulamayi
acinca dashboard/insights/onboarding/her sey ESKISIYLE AYNI goruyor: gerceni ayni duzen,
yalniz boyasi degismis. Bu tur bunu bitiriyor.

## TEK VE MUTLAK KURAL: TASARIM > VAR OLAN KOD
- `docs/design/redesign-mockup.html` (yon B · Midnight Monitor) = UYGULAMANIN NASIL
  GORUNECEGININ TEK KAYNAGI. Var olan ekran kodu KUTSAL DEGIL; mockup'a uymuyorsa SILINIP
  YENIDEN YAZILIR.
- Her ekran, mockup'taki ILGILI ekrana BENZEMELI: ayni DUZEN, ayni ELEMANLAR, ayni YERLESIM,
  ayni HIYERARSI, ayni kompozisyon. Sadece ayni RENK/TOKEN YETMEZ.
- Bir ekranin mevcut DUZENI mockup'takinden farkliysa: o ekranin GORUNUM kodunu SIL ve
  mockup'a gore SIFIRDAN yaz. "Recolor" degil, YENIDEN INSA.

## YASAK GEREKCELER (TEKRAR ETME)
- "Ekran zaten Midnight Monitor'di / zaten token/StatCard kullaniyor / ezici cogunluk uyumlu"
  -> YASAK.
- "Var olani bozmamak icin denetledim, uyumlulari birakti" -> YASAK.
- "Sadece gercek ihlalleri duzelttim" -> YASAK. Recolor'dur, redesign degil.
- Faz 1 token/imza-bilesenleri (GlucoseRing/TIRDonut/GradientAreaChart/golgeli body-map)
  YAPI TASI olarak kalir; is o taslarla HER ekrani MOCKUP DUZENINDE yeniden kurmak. Bir ekran
  imza-gorseli (halka/donut/gradyan grafik/golgeli harita) mockup'taki gibi KULLANMIYORSA,
  duz kart+sayi ise, o ekran YENIDEN YAZILACAK.

## KULLANICININ "AYNI KALDI" DEDIGI ALAN: HER EKRAN
Ozellikle mockup'taki bu kompozisyonlara getir (ornek, ama kural HER ekran icin):
- DASHBOARD (mockup B03): MERKEZ GlucoseRing (gradyan+glow halka, ortada 118) + aktif
  zamanlayici karti + renk-kodlu gunluk. Duz sayi karti DEGIL, mockup'taki halka kompozisyonu.
- INSIGHTS: TIR DONUT (renk halkalari + %) + gradyan AGP alan grafigi + StatCard seridi.
- INJECTION: GOLGELI vucut haritasi (siluet + sicak-nokta gradyani), mockup B03.
- ONBOARDING (B02): parlayan marka amblemi karsilama + ikon-kart quiz + gorsel hedef band +
  gradyan alan reveal. Var olan quiz mantigi korunur, SUNUM mockup'a gore yeniden.
- Kayit akislari, Spike sohbet: mockup B04/B06 kompozisyonu.

## YONTEM (her mockup ekrani icin)
Mockup'i tarayicida ac. Bolum bolum ilerle. Her mockup telefon-cercevesi icin: (1) o ekranin
DUZENINI yaz (hangi elemanlar, hangi sirada). (2) Uygulamadaki karsilik ekrani ac; duzeni
mockup'a uyuyor mu? Uymuyorsa gorunum kodunu SIFIRDAN mockup'a gore kur. (3) Kontrol: koyu
katmanli zemin + glukoz renk dili + imza-gorsel + MOCKUP DUZENI. Sonuncusu en onemlisi.
Hicbir ekrani "zaten iyiydi" diye ATLAMA.

## KILITLER + KAPILAR
REGULASYON: nötr dil, "uyarir/alarm/tani/onerilen doz" YASAK, doz "hesaplanan", Spike doz
sayisi VERMEZ + saglik kaydi gondermez, isi haritasi dili nötr. R5 YAPISAL islerine dokunma
(kalem-v7, liveData, ai-ask-spike function); GORUNUMUNU mockup'a cek. Her yeni string 5 dilde
(tr.ts; i18n-check). Em-dash yasak (kod yorumu dahil). app.json version'a DOKUNMA. Kapilar:
`npx tsc --noEmit` + `npm run i18n-check`. Dev screenshot kancasi/gallery store'dan once silinecek.

## TESLIM
TEK rapor, arada durma. Her ekran icin: mockup DUZENIYLE (renk degil) uyumlu hale getirildi mi,
hangi ekranlarin gorunum kodu SIFIRDAN yazildi, degisen dosyalar. "Zaten uyumlu" gerekcesi
YASAK. Hub her ekrani cekip mockup'a karsi DUZEN karsilastirmasi yapacak; uymayan geri gelecek.
