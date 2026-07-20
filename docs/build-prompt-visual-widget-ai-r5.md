# zerospike R5: tam gorsel elden gecirme + rapor + bildirim/widget/live activity + Spike AI (2026-07-20)

Sen zerospike reposunda calisan bir BUILD session'isin. Bu BUYUK bir turdur; isin
buyuklugu onemsiz, kalite ve kurallar oncelik.

## Degismez kurallar
- Em-dash ("—") HICBIR YERDE. Gereksiz yorum yok. Her yeni string 5 dilde
  (en/tr/de/fr/es; tr.ts sema kaynagi, `npm run i18n-check` parite).
- REGULASYON SERT SINIR (pazarliksiz): "uyarir / alarm / tani / tedavi / onerilen doz /
  bayilabilirsin / dusuk-yuksek sekere mudahale" sinifi TIBBI dil YASAK. zerospike bir
  GUNLUK DEFTERIDIR: kullanicinin girdigini kaydeder, ozetler, gorsel sunar. Hicbir
  yuzey tavsiye/karar vermez. "Alarm gibi bildirim" istegi TEKNIK bir istek (rahatsiz-
  etme modunu delen, gorunur bildirim); metin dili yine NOTR hatirlatici olacak
  ("olcum zamani", "tokluk olcumu" gibi), asla "tehlike/alarm/mudahale" degil.
- Kapilar: `npx tsc --noEmit` + `npm run i18n-check` yesil. app.json version/build'e
  DOKUNMA (bump hub'da; bu tur 1.5.0). Fazlar arasi onay bekleme.
- Cihaz QA + native-imza + servis-deploy kalemleri HUMAN: raporda ayrı liste.

## Faz 1: TAM uygulama gorsel elden gecirme (onboarding'ten ayarlara)

Kapsam kullanici direktifi: "en yogun 5 ekran" DEGIL, uygulama GENELI: onboarding,
dashboard, log akislari (add-food/calculator/injection), insights, pens, profile-setup,
settings, paywall/onboarding dahil HER ekran. Fontlar dahil her sey degisebilir.
- Bir TASARIM SISTEMI kur (once bunu yap, sonra ekranlara uygula): tipografi olcegi
  (gerekiyorsa yeni font ailesi; expo-font ile; okunur + modern + saglik-notr),
  renk/spacing token'lari, tekrar eden bilesenler (StatCard = buyuk sayi + kucuk
  etiket + opsiyonel sparkline; IconRow; SegmentedStat). Token'lari tek kaynakta topla.
- Ilke: metin bloklarini SAYIYA + IKONA + MINI GRAFIGE cevir. Paragraf yerine kart.
  Aciklama gereken yerde caption/tooltip. react-native-svg mevcut: sparkline, mini
  donut (TIR), bar. Bilgi mimarisi/navigasyon KORUNUR (yeniden konumlandirma degil,
  gorsel dil degisimi).
- Onboarding: statura kalitesinde animasyonlu, metin-minimal, gorsel-oncelikli
  (mevcut quiz mantigi korunur, sunum yenilenir).
- Erisilebilirlik: kontrast + dynamic type kirilmamali; her StatCard'in metin
  karsiligi (VoiceOver) olmali.
- Cikti: raporda once/sonra ekran listesi + tasarim sistemi dosya yolu.

## Faz 2: Enjeksiyon bolge isi haritasi

- ONCE DOGRULA: enjeksiyon kaydinda bolge (site) alani var mi (lib/db semasi +
  (tabs)/injection.tsx). Yoksa nullable `site` alani + migration (eski kayitlar
  site'siz; kirilma yok) + kayit akisina govde-silueti secici (karin 4 ceyrek,
  sol/sag uyluk, kol, kalca).
- Isi haritasi: injection sekmesinde SVG govde silueti, son 30 gun kullanim yogunlugu
  bolge basina renk siddetiyle. Dil notr: "son 30 gun kullanim", "en az kullanilan
  bolge". "Onerilir" YOK; gorsel kendi anlatir. Bos durum soluk + tek satir.

## Faz 3: Doktor PDF raporunu yeniden tasarla (mySugr paritesi hedef)

Mevcut rapor tablo agirlikli (lib/services/report.ts: bas + AGP SVG + 3 tablo).
Referans rakip (mySugr) analiz edildi; asagidaki gorsel yapiyi bizim rapora getir
(kendi verimizle, kendi marka dilimizle; kopya degil, PARITE):
1. OZET ISTATISTIK KARTLARI (rapor bası): tahmini HbA1c (mevcut hesabimiz varsa;
   YOKSA hesaplama, sadece olcum tabanli goster, honest caveat), ortalama, standart
   sapma, TIR (%), Lows/Highs SAYI + "N kayittan" baglami. Chip/pill gorunum.
   HbA1c gosterirsek mySugr'daki gibi durust not: "tahmin, CGM verisi icermez".
2. ARALIK GOSTERGESI (Settings kutusu): renkli esik cetveli (Very high/High/Target/
   Low/Very low) + kullanicinin esikleri + karbonhidrat/glukoz birimi. Doktor esikleri
   gorsun.
3. HAFTALIK OZET: her hafta icin ayni istatistik seti (ort/sapma/low/high + toplam
   bazal/bolus birimi).
4. GUNLUK 24-SAAT ZAMAN CIZELGESI (asil wow): gun basina 1AM-11PM serit; bazal/bolus/
   kan sekeri/karbonhidrat lane'leri; kan sekeri degerleri saatine yerlesik + aralik
   rengine gore renkli kutu; gunluk TOTAL kolonu. SVG ile uret (expo-print HTML'ine
   gomulu SVG; mevcut buildAgpSvg deseni). Cok gunde performans: sayfa basi hafta,
   makul sayfa sayisi; windowDays buyukse ozetle.
- Regulasyon: rapor tibbi yorum EKLEMEZ; yalnizca kullanicinin verisini gorsellestirir.
  "Estimated HbA1c" disinda turetilmis klinik ifade yok. Footer: veri gunluk amaclidir,
  tibbi karar icin degildir (notr).
- expo-print + expo-sharing zaten bagimlilik; yeni paket gerekmez.

## Faz 4: Bildirim + kilit-ekrani/dinamik-ada + home widget (hatirlatici gorunurlugu)

Amac (kullanici): kullanici uygulamayi ACMADAN siradaki hatirlaticiya kalan sureyi,
son glukoz degerini gorebilsin; bildirimler kalabalikta kaybolmasin.
- Tek veri kaynagi: "siradaki hatirlatici hedef zamani" + "son glukoz degeri/zamani"
  tek fonksiyondan (lib/postMealTimer.ts + notifications). Tum yuzeyler bunu okur.
- 4a) Bildirimleri one cikar: iOS Time-Sensitive interruption level (Odak/sessiz modu
  deler, gorunur kalir) + Android yuksek onem kanali + tam-ekran degil ama sabit/
  ongoing hatirlatici stili. KRITIK: iOS Critical Alerts entitlement'ini KULLANMA
  (tibbi-cihaz sinifi riski + Apple ozel izni). Metin notr hatirlatici.
- 4b) iOS Live Activity + Dynamic Island: aktif tokluk-olcum geri sayimi Live Activity
  olarak kilit ekraninda + Dynamic Island'da CANLI sayar (`Text(timerInterval:)`,
  ActivityKit). Kompakt/expanded gorunum: kalan sure + son glukoz (varsa). Kullanici
  "sistemde en ustte surekli gorunen yapi" = bu. Sadece GORSEL veri gosterimi (kendi
  logu), yorum yok.
- 4c) Home widget: WidgetKit small (iOS) + react-native-android-widget (Android):
  siradaki hatirlaticiya kalan sure (iOS canli, Android hedef saat) + son glukoz
  degeri. Tik = uygulama.
- Teknik: `@bacons/apple-targets` (Live Activity + WidgetKit Swift target'lari),
  App Group (group.com.greeneyeapp.zerospike) paylasimli storage; RN yazar, native
  okur. Yeni native yapi = prebuild sart. Apple portal (App Group + Live Activity
  capability) + EAS credentials HUMAN adimlarini raporda listele. Widget/activity
  metinleri sistem lokalizasyonu (iOS .strings, Android resources).

## Faz 5: Spike AI (statura Ask desenini UYARLA)

Isim: **Spike**. Kaynak: ../statura lib/ai/askClient.ts + supabase/functions/ai-ask +
AiDataExplainer onay kapisi. Uyarla (kopya degil):
- Yeni edge function `supabase/functions/ai-ask-spike/` (ayri system prompt + gunluk
  cap). Deploy HUMAN.
- SYSTEM PROMPT SERT KURAL: Spike gunluk-defteri + genel diyabet egitimi + uygulama
  kullanimi anlatir. DOZ SORUSUNA ASLA sayi vermez (kibar ret + saglik profesyoneline
  yonlendir). Tani/tedavi/ilac degisikligi onerisi YOK. Acil belirtide tek cumleyle
  profesyonel yardima yonlendir (panik dili yok).
- VERI SINIRI (v1): yalniz yazilan soru + sohbet penceresi gonderilir. SAGLIK KAYITLARI
  (seker/ogun/insulin) AI'ya GONDERILMEZ. system prompt kullanici verisi icermez.
- Onay kapisi (Apple 5.1.1 dersi): ilk mesajdan once acik onay: ne gonderilir, kime
  (sunucumuz -> OpenAI), neyin GONDERILMEDIGI (saglik kayitlarin, kimligin), gizlilik
  linki. MMKV persist, fail-closed (client giriste bayrak), Settings'ten geri cekme.
  Buton notr ("Kabul et ve devam et").
- Erisim: sekme degil; insights/settings girisi + dashboard kucuk kart. Free/Pro gunluk
  soru cap'i (RC config; serbest karar, raporla). Her yanit alti: "Spike tibbi tavsiye
  vermez."

## Faz sirasi ve teslim

Sira: Faz 1 (tasarim sistemi once) -> 2 -> 3 -> 5 -> 4 (native en riskli, sona). Her faz
kendi kapisini gecmeden sonrakine gecme. Rapor: faz basi once/sonra + dosya yollari,
tasarim sistemi ozeti, rapor gorsel yapisi, native HUMAN adimlari (App Group, Live
Activity capability, Supabase deploy, EAS credentials), tsc + i18n-check ciktilari,
onerilen commit listesi (faz basi ayri commit). docs/ altina widget+live-activity
mimari notu (App Group anahtar adlari).
