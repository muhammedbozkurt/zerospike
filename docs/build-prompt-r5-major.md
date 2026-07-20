# zerospike R5 (BUYUK TUR): kalem kaldirma + tam gorsel elden gecirme + rapor + bildirim/live-activity/widget/Apple Watch + Spike AI (2026-07-20)

Sen zerospike reposunda calisan bir BUILD session'isin. Bu portfoydeki en buyuk tek turdur;
kalite ve kurallar oncelik, is buyuklugu onemsiz. Cikti tek surum: 1.5.0.

## DEGISMEZ KURALLAR
- Em-dash ("—") HICBIR YERDE. Gereksiz yorum yok (yalniz "neden" gerektiginde). Match the
  file's style. Her yeni string 5 dilde (en/tr/de/fr/es; tr.ts sema kaynagi; `npm run
  i18n-check` parite; TR diakritikleri dogru).
- REGULASYON SERT SINIR (pazarliksiz): "uyarir / alarm / tani / tedavi / onerilen doz /
  bayilabilirsin / mudahale et" sinifi TIBBI dil YASAK. zerospike bir GUNLUK DEFTERIDIR:
  girileni kaydeder, ozetler, gorsel sunar; hicbir yuzey tavsiye/karar vermez. "Alarm gibi
  bildirim" TEKNIK bir istektir (rahatsiz-etme'yi delen, one cikan, israrci bildirim);
  METIN yine notr hatirlatici ("olcum zamani"), asla "tehlike/alarm/mudahale".
- Kapilar (her faz sonunda yesil): `npx tsc --noEmit` + `npm run i18n-check`. app.json
  version/build'e DOKUNMA (bump hub'da). Fazlar arasi onay bekleme.
- Cihaz QA + native imza + servis deploy = HUMAN: raporda AYRI, eksiksiz listele.
- Reduced-motion (erisim): HER animasyonun anlik/snap karsiligi olacak. Dynamic type ve
  VoiceOver kirilmayacak. Dokunma hedefleri >= 44pt. Kontrast WCAG AA.

## FAZ 0: Kalem (insulin pen) ozelligini kaldir
Gerekce (kullanici): kullanici kalemde kac doz kaldigini fiziksel kalemde zaten goruyor;
uygulama ici stok takibi gereksiz karmaşa.
- KALDIR: app/pens.tsx ekrani ve rotasi; insulin_pens tablosu/CRUD (lib/db/injections.ts
  pen fonksiyonlari); remaining_units/total_units muhasebesi ve dususu; LOW_PEN_THRESHOLD
  ve dusuk-kalem hatirlaticilari/bildirimleri; dashboard'daki aktif-kalem gosterimi; onboarding
  ve profile-setup'ta kalem kurulumu; injection ekranindaki kalem SECICI.
- KORU: enjeksiyon kaydinda `insulin_type` (hizli/uzun vb.) ve `dose_units` DOGRUDAN alan
  olarak kalir. Kalem yerine kullanici insulin tipini DOGRUDAN secer (basit segmented
  secici; profilin varsayilan tipi on-secili). Gecmis enjeksiyonlar korunur (pen_id zaten
  nullable, veri kaybi yok). R4'teki updateInjection kalem-muhasebesi tamamen cikar.
- Migration: insulin_pens tablosunu birakabilirsin (okumayi kes) ya da drop et; karar senin,
  veri kaybi enjeksiyonlarda OLMAMALI. Rapora yaz.
- i18n: kalemle ilgili olu anahtarlari temizle; yeni insulin-tipi secici anahtarlarini 5 dilde.

## FAZ 1: Tasarim sistemi + hareket dili (TEMEL, once bunu kur)
Ekranlara dokunmadan once tek kaynak tasarim sistemi:
- Token'lar: renk paleti (mevcut dagimik zinc-* siniflari tek merkeze), boşluk 4/8pt izgara,
  radii, elevation. **Glukoz renk dili** tek kaynak ve HER yuzeyde ayni (uygulama + rapor +
  widget + watch): dusuk=kirmizi, hedef=yesil, yuksek=amber, cok-yuksek=turuncu; classifyGlucose
  ile hizala (lib/glucose.ts).
- Tipografi: yeni ACIK LISANSLI font ailesi (expo-font); rakamlar icin tabular figures
  (animasyonlu sayimda ziplamasin). Type scale (display/title/body/caption).
- Bilesenler (yeni, tema-token'li): StatCard (buyuk sayi + kucuk etiket + opsiyonel sparkline),
  IconRow, SegmentedStat, Skeleton (shimmer), AnimatedNumber (count-up), tutarli EmptyState.
- Hareket dili (react-native-reanimated 4.5, KURULU):
  - Ekran enter: stagger fade+slide (~350ms, 60ms adim).
  - AnimatedNumber: ortalama/TIR/seri 0'dan gercege sayar.
  - Grafik: path stroke draw-on, bar tabandan buyume.
  - Liste (journal): entering FadeInDown / exiting FadeOutUp + layout animation; swipe-to-edit/delete spring.
  - Sheet: spring + backdrop fade + icerik stagger.
  - Buton: press scale 0.96 + haptic (lib/haptics.ts).
  - Yukleniyor: Skeleton (spinner degil). Basari: check morph + hapticSuccess.
  - Tab bar: aktif ikon micro-bounce + renk gecisi.
  - HEPSI reduced-motion'da snap.

## FAZ 2: Tum ekranlarin yeniden tasarimi (istisnasiz)
Bilgi mimarisi/navigasyon KORUNUR; gorsel dil + hareket + yogunluk-azaltma degisir. Her ekran
Faz 1 sistemine tasinacak. Ekran ekran:
- onboarding.tsx: statura kalitesinde animasyonlu, metin-minimal slaytlar; quiz mantigi + reveal korunur.
- (tabs)/index.tsx (Dashboard): en ustte tek HERO durum karti (aktif tokluk zamanlayici =
  canli halka; yoksa son glukoz + trend oku + "N dk once"). "Bu hafta" -> yan yana StatCard'lar
  + sparkline. Enjeksiyon karti -> mini vucut silueti onizleme. Belirgin tek "＋ Kaydet" aksiyonu
  (bkz Faz 3 birlesik hizli-kayit). Journal satirlari (JournalItem) renk-kodlu glukoz hapi +
  ikon + swipe + layout animasyon.
- (tabs)/food.tsx: gorsel ogun satirlari, karbonhidrat toplami buyuk rakam, gune gore gruplama.
- (tabs)/injection.tsx: merkez = ISI HARITASI (Faz 4). Insulin tipi secici (kalem yerine).
- insights.tsx: mevcut grafikler (ChartCard/DailyProfileChart/HourlyChart/TrendChart/
  TimeInRangeBar) yeni token + draw-on animasyonuna gecer; TIR animasyonlu donut; en uste
  raporla AYNI ozet StatCard seridi (app<->rapor<->widget tek gorsel dil).
- (tabs)/settings.tsx: bolumlu, ikonlu satirlar; Spike, bildirim tercihleri, widget/watch
  ayarlari buraya.
- add-food.tsx + calculator.tsx: az yazi, buyuk rakam girisi, segmented, canli hesap animasyonlu.
  DIL: "onerilen doz" YOK; kullanicinin surdugu hesap makinesi.
- profile-setup, paywall (statura kalitesi), downsell, winback, scan, sos, emergency-contacts,
  injection-guide, sources: hepsi sisteme gecer.
- Cikti: raporda ekran-ekran once/sonra.

## FAZ 3: Kurgu (akis) duzenlemeleri
- Birlesik HIZLI KAYIT: her yerden tek dokunusla acilan tek sheet (glukoz / ogun / insulin
  sec) -> birincil aksiyon bir dokunus. Mevcut ayri sheet'ler bunun altina toplanir.
- Dashboard onceligi: sabit kart sirasi yerine "o an en onemli" (aktif zamanlayici / son olcum) uste.
- Ilk-kullanim: gorsel, elden tutan ilk kayit akisi.

## FAZ 4: Enjeksiyon bolge isi haritasi
- ONEMLI: `site` alani ZATEN VAR (injection.tsx usageBySite / INJECTION_SITES / recommendedSite);
  yeni sema/migration GEREKMEZ. "recommendedSite" kelimesi tibbi cagrisim tasiyorsa notr'a cek
  ("en az kullanilan").
- Isi haritasi: injection sekmesinde SVG vucut silueti (tema uyumlu), son 30 gun kullanim
  yogunlugu bolge basina renk siddetiyle. Kayit akisinda siluet uzerinden dokunarak bolge secimi.
  Dil notr ("son 30 gun kullanim", "en az kullanilan bolge"); "onerilir" YOK. Bos durum soluk.

## FAZ 5: Doktor PDF raporu -> mySugr paritesi
Mevcut (lib/services/report.ts): bas + AGP SVG + 3 tablo. Referans (mySugr) analiz edildi.
Getirilecek gorsel yapi (kendi verimiz, kendi marka dili, KOPYA DEGIL):
1. OZET STAT KARTLARI (rapor bası): tahmini HbA1c (mevcut hesap varsa; yoksa UYDURMA, olcum
   tabanli goster + durust "tahmin, CGM icermez" notu), ortalama, sapma, TIR %, Lows/Highs
   SAYI + "N kayittan" baglami. Chip gorunum, uygulama StatCard diliyle ayni.
2. ARALIK GOSTERGESI: renkli esik cetveli (glukoz renk dili) + kullanici esikleri + birim.
3. HAFTALIK OZET: hafta basi ayni stat seti.
4. GUNLUK 24-SAAT ZAMAN CIZELGESI (asil wow): gun basi 1AM-11PM serit; bazal/bolus/kan-sekeri/
   karbonhidrat lane; kan sekeri degeri saatine yerlesik + aralik rengi; gunluk TOTAL kolonu.
   SVG (expo-print HTML'ine gomulu; buildAgpSvg deseni). Cok gunde: sayfa basi hafta, makul
   sayfa; buyuk pencerede ozetle.
- Regulasyon: rapor tibbi YORUM eklemez; yalniz veriyi gorsellestirir. Footer notr. expo-print
  + expo-sharing zaten dep.

## FAZ 6: Spike AI (statura Ask desenini UYARLA)
Kaynak: ../statura lib/ai/askClient.ts + supabase/functions/ai-ask + AiDataExplainer onay kapisi.
- Yeni edge function: supabase/functions/ai-ask-spike/ (ayri system prompt + gunluk cap). Deploy HUMAN.
- SYSTEM PROMPT SERT KURAL: Spike gunluk-defteri + genel diyabet egitimi + uygulama kullanimi.
  DOZ SORUSUNA ASLA sayi vermez (kibar ret + saglik profesyoneline yonlendir). Tani/tedavi/ilac
  onerisi YOK. Acil belirtide tek cumle profesyonel yardima yonlendir (panik dili yok).
- VERI SINIRI (v1): yalniz yazilan soru + sohbet penceresi gonderilir. SAGLIK KAYITLARI
  (seker/ogun/insulin) GONDERILMEZ; system prompt kullanici verisi icermez.
- Onay kapisi (Apple 5.1.1 dersi): ilk mesajdan once acik onay (ne gonderilir / kime: sunucumuz
  -> OpenAI / neyin GONDERILMEDIGI / gizlilik linki). MMKV persist, fail-closed (client giriste
  bayrak), Settings'ten geri cekme. Buton notr ("Kabul et ve devam et").
- Erisim: sekme DEGIL; insights/settings girisi + dashboard kucuk kart. Free/Pro gunluk cap
  (RC config; serbest karar, raporla). Her yanit alti: "Spike tibbi tavsiye vermez."

## FAZ 7: Bildirim + alarm + Live Activity/Dynamic Island (native baslangici)
Tek veri kaynagi: "siradaki hatirlatici hedef zamani" + "son glukoz degeri/zamani" tek
fonksiyondan (lib/postMealTimer.ts + notifications). Tum yuzeyler (bildirim/LA/widget/watch)
bunu okur.
- 7a Bildirim guclendirme: iOS Time-Sensitive interruption level (Odak/sessiz deler, one cikar).
  Android yuksek onem kanali + opsiyonel ongoing/israrci hatirlatici. Ayarlarda "Israrci
  hatirlaticilar" aç/kapa (opt-in): ayri ses + kalici bildirim. iOS CRITICAL ALERTS
  ENTITLEMENT'INI KULLANMA (tibbi-cihaz riski). Metin notr.
- 7b iOS Live Activity + Dynamic Island: aktif tokluk-olcum geri sayimi kilit ekraninda +
  Dynamic Island'da CANLI (`Text(timerInterval:)`, ActivityKit). Kompakt/expanded: kalan sure +
  son glukoz. Yalniz GORSEL veri (kullanicinin kendi logu), yorum yok.

## FAZ 8: Home widget (iOS + Android)
- iOS WidgetKit small: siradaki hatirlaticiya kalan sure (canli) + son glukoz. Tik = uygulama.
- Android react-native-android-widget: hedef saat + son glukoz.
- App Group (group.com.greeneyeapp.zerospike) paylasimli storage: RN yazar, native okur.

## FAZ 9: Apple Watch
- Watch app (SwiftUI target): bilekten hizli glukoz kaydi, aktif zamanlayici geri sayimi,
  son olcumler.
- Kadran komplikasyonu: siradaki hatirlaticiya kalan sure + son glukoz (bilekte hep gorunur).
- Bildirimler saate yansir (native). Veri: App Group / WatchConnectivity.
- Dil: sistem lokalizasyonu (watch .strings).

## NATIVE ALTYAPI (Faz 7-9 ortak)
- `@bacons/apple-targets` config plugin: Live Activity + WidgetKit + Watch Swift target'lari.
- Yeni native yapi = prebuild sart. HUMAN adimlarini raporda TEK TEK listele: Apple Developer
  portal (App Group, Live Activity capability, Watch app id + provisioning, Push if needed),
  EAS credentials/entitlements, Supabase function deploy (Spike), acik-font lisans dosyasi.
- Widget/LA/watch metinleri sistem lokalizasyonu (iOS .strings, Android resources); nasil
  cozuldugu rapora.

## FAZ SIRASI VE TESLIM
Sira: 0 (kalem kaldir) -> 1 (tasarim sistemi) -> 2 (ekranlar) -> 3 (akis) -> 4 (isi haritasi)
-> 5 (rapor) -> 6 (Spike) -> 7 (bildirim/LA) -> 8 (widget) -> 9 (watch). Her faz kendi kapisini
gecmeden sonrakine gecme. Native fazlar (7-9) once JS/paylasimli-veri katmanini kurup sonra
target'lari eklesin ki takilirsa oncekiler saglam kalsin.
Teslim raporu: faz basi once/sonra + dosya yollari; tasarim sistemi + hareket dili ozeti;
kalem kaldirmanin dokundugu yerler + migration karari; rapor gorsel yapisi; Spike function
yolu + cap + onay metinleri; TUM native HUMAN adimlari (portal/EAS/Supabase/font lisans);
tsc + i18n-check ciktilari; faz basi onerilen commit listesi. docs/ altina widget+LA+watch
mimari notu (App Group anahtar adlari; paylasimli veri sekli).
