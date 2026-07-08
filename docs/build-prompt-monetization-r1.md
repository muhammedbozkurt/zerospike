# zerospike monetizasyon + ozellik turu: build prompt R1 (Temmuz 2026)

Bu dosya, portfoy analizi sonrasi zerospike icin onaylanan is listesidir. Repo kokunde
CLAUDE.md/AGENTS.md yok (dogrulandi); bu dosya calisma sozlesmesidir. Kurallar:

- Em dash ("—") hicbir yerde kullanilmaz: kod, string, locale, commit mesaji dahil.
  Virgul, iki nokta, parantez veya ayri cumle kullan.
- Gereksiz yorum yok: yalnizca acik olmayan bir NEDEN'i yorumla. Kodun soyledigini anlatma.
- Her kullanici metni i18next uzerinden gider; yeni her anahtar 5 dile girer
  (lib/i18n/locales: tr, en, de, es, fr). TR ve EN dogal ceviri, digerleri de gercek ceviri.
- mg/dL ve mmol/L: esik, ortalama ve grafik iceren her yeni ozellik birim ayarina uyar.
- Paket eklerken yalnizca `npx expo install`. patch-package kullaniliyor (patches/):
  surum degisikliklerinde patch'lerin hala uygulanip uygulanmadigini kontrol et.
- Fazlar arasinda kullanici onayi BEKLEME: 2026-07-08 karariyla tum fazlar icin onay pesinen
  verildi; tum fazlar bitene kadar durmadan calis. Faz basina baseline commit at, faz sonunda
  kisa ozet + bu dosyanin HUMAN TODO ve cihaz QA bolumlerini guncelle. Cihaz QA en sonda toplu.
- Statik kapi: `npx tsc --noEmit` her faz sonunda temiz (package.json'a "typecheck" script'i
  olarak ekle). Sibling Expo hatalari icin referans: ../expo-uygulama-hatalari-ve-cozumleri.md.

Buradaki dosya referanslari 2026-07-08 denetiminden geliyor; uygulamadan once dogrula.

## REGULASYON KURALLARI (her fazda gecerli, ihlal edilemez)

FDA 2026 CDS/wellness rehberleri + EU MDR Rule 11 ozeti: kayit, gosterim, istatistik ve
kullanici-ayarli hatirlaticilar serbest; hastaya yonelik tani/sonuc/uyari dili ve doz onerisi
cihaz sinifina sokar.

- YASAK dil (uygulama ici + bildirim + store metni): "hipoglisemi uyarisi", "bayilabilirsin",
  "tehlikedesin", "su dozu yap", hastalik sonucu tahmini, "warns/alerts about hypos" tarzi
  listing cumleleri.
- SERBEST dil: olculen degerin gosterimi, "Son olcumun X. 15 dakika sonra tekrar olcmeyi
  hatirlatalim mi?", "doktorunla paylas", nötr istatistik ("ortalaman 126 mg/dL").
- Doz hesaplayici mevcut ve en riskli kalem: Faz 3.0'da dili "senin girdigin oranlarin
  aritmetigi" cercevesine cekilir, tavsiye dili temizlenir, disclaimer guclenir.

## Baglam: neden bu isler

- Free cit urunu olduruyor: 5 log OMUR BOYU cap'i (lib/guardrails.ts FREE_LOG_LIMIT=5,
  countAllLogs tum glukoz+yemek satirlarini sayiyor) gercek bir insulin kullanicisinda ilk gun
  doluyor; hatirlatici dongusu aliskanlik kuramadan urun bitiyor. Ustelik Health/CGM importu
  cap'i bypass ediyor (lib/services/health.ts addSugarLog'u limitsiz cagiriyor): tutarsiz.
- Sifir olcum: analytics/crash SDK'si yok; paywall gosterimi, gate bazinda donusum, onboarding
  kopmasi bilinmiyor.
- Trial, downsell, winback yok; paywall proaktif hic gosterilmiyor; review prompt hic yok.
- Paywall "Unlimited favorites" vaat ediyor ama favoriler kodda hic kapili degil
  (lib/db/favorites.ts): yanlis vaat, duzeltilecek.
- Google Play target API zorunlulugu: Expo SDK 51 Android API 34 hedefler; Play guncellemeleri
  icin API 35 gerekiyor. SDK yukseltmesi bu yuzden opsiyonel degil, on kosul (Faz 0).
- Kullanici istek listesi (2026-07-08): tokluk olcum alarmi (ilk lokma butonu), 90 gunluk
  grafik + sayisal ortalamalar + trendler, acil durum (SOS), cihaz/saat entegrasyonlari,
  hipo sonrasi bildirim, tum hatirlaticilara kullanici saati.
- Entegrasyon gercekleri (2026 web arastirmasi): Dexcom G7 Apple Health + Health Connect'e
  yaziyor (3 saat gecikme), yani Dexcom destegi mevcut Health importuyla FIILEN VAR. Abbott
  Libre resmi olarak hicbir Health platformuna yazmiyor ve resmi API'si yok (gayriresmi
  LibreLinkUp API'si ToS + App Review riski: GIRME). Pompalar (Omnipod/Tandem/Medtronic) veri
  acmiyor; HealthKit'in insulin delivery tipi okunabilir (DIY Loop kitlesi). 112 otomatik
  arama ve otomatik SMS iki platformda da ucuncu parti app'e KAPALI: dialer + hazir mesaj
  composer deseni sart.

## Kilitli kararlar (yeniden tartisma, uygula)

- Free/Pro citi yeniden cizilir (Faz 1'deki tablo). 5-log cap tamamen kalkar.
- Fiyat: monthly 4.99 aynen, yearly 29.99 + 7 gun trial (varsayilan secili), lifetime 79.99
  (59.99'dan yukselir). Magaza/RC tarafi HUMAN TODO; kodda fallback guncellenir.
- Analytics: Firebase Analytics + Crashlytics (ucretsiz). PostHog KULLANILMAZ (tek PostHog
  projesi Statura'da). Remote Config bu turda kurulmaz.
- Downsell standardi (Statura kaskadi): ana paywall'da trial'li yillik varsayilan secili;
  kapatana BIR KEZ indirimli-ilk-yil downsell (yalniza RC'de gercek indirim varsa, ayni para
  biriminde dogrulanarak); entitlement kaybinda bir kez winback; uygulama ici dismiss'lerde
  7 gun sonra bir kez re-arm (omur boyu toplam 2 downsell gosterimi).
- Offline-first konumlanma korunur: bu turda backend YOK. Supabase'li aile/bakici uzaktan
  paylasimi R2 kalemidir (dosyanin sonunda cerceve).
- Dark pattern yok: sayac, sahte kitlik, korku dili yasak. Ozellikle bu app'te korku dili
  ayni zamanda regulasyon ihlalidir.

## FAZ 0: Platform tabani

### 0.1 Expo SDK yukseltmesi (51 -> 57)
- Zorunlu neden: Play target API 35. npx expo install --fix ile surum hizala; react-native-
  purchases 8 -> 10, @kingstinct/react-native-healthkit, expo-notifications, expo-camera,
  expo-sqlite API degisikliklerini gecir. patches/ altindaki her patch'i yeni surumlere karsi
  dogrula (gerekirse yeniden uret veya kaldir). prebuild --clean + iOS/Android derleme.
- NativeWind ve Reanimated surum uyumu: sibling app'ler SDK 56/57'de ayni stack'i calistiriyor,
  takildiginda ../statura (SDK 57) package.json'ini referans al.
- Kabul: iki platformda uygulama aciliyor, log/olcum/bildirim/satin alma smoke akisi calisiyor,
  tsc temiz.

### 0.2 Firebase Analytics + Crashlytics
- @react-native-firebase/app + analytics + crashlytics (npx expo install, config plugin'ler).
  google-services.json + GoogleService-Info.plist repo kokunde HAZIR (2026-07-08 kondu,
  paket/bundle id'ler dogrulandi: com.greeneyeapp.zerospike, proje zerospike-fb4ce);
  config plugin'lere dogrudan bagla. Yine de ince bir sarmalayici (lib/analytics/) yaz ki
  event isimleri tek dosyada dursun.
- Cekirdek event seti (Firebase rezerve isimlerinden kacin, Faunade'nin isimlendirme deseni
  ornek): app_open_custom yerine mevcutlari kullan; ozel event'ler: onboarding_step (step),
  onboarding_done, log_added (kind: glucose|meal|insulin, source: manual|health),
  paywall_view (source, trial_eligible), paywall_dismiss (source), paywall_tier_selected
  (tier), downsell_view/accept/dismiss (trigger), winback_view, trial_started,
  purchase_completed (tier), tokluk_timer_started, sos_opened, sos_action (call|sms|contact),
  report_generated, insights_view (window), review_prompted, offerings_fallback_shown (reason).
- Kabul: dev'de event'ler debug log'a dusuyor; Crashlytics test crash'i yakalaniyor.

## FAZ 1: Free/Pro citi + paywall standardi

### 1.1 Yeni cit (tek dosyada, lib/guardrails.ts yeniden yazilir)

| Ozellik | Free | Pro |
|---|---|---|
| Manuel log (glukoz/yemek/insulin) | SINIRSIZ (cap kalkar) | sinirsiz |
| Tokluk alarmi + tum hatirlaticilar + ozel saatler | var | var |
| SOS acil durum | var | var |
| Barkod + yemek DB | var | var |
| Ozel yemek | 10 (3'ten yukselir) | sinirsiz |
| Insights | 7 gunluk temel ozet (ortalama + TIR) | 30/90 gun, AGP, percentil, trendler, oruntuler |
| Health/CGM otomatik senkron | YOK (Pro'ya tasinir, bypass kapanir) | var |
| Profil | 1 | coklu (aile) |
| Kalem (pen) | 1 | sinirsiz + rotasyon onerisi |
| CSV/PDF disari aktarma + doktor raporu | yok | var |

- Health senkron gecisi: lib/services/health.ts import yoluna isPro kapisi; free kullaniciya
  senkron ayari "Pro" rozetiyle gorunur (kesif + organik paywall girisi). Mevcut free
  kullanicida senkron aciksa: ilk acilista nazik bir gecis ekrani (mevcut veri SILINMEZ,
  yalnizca yeni otomatik import durur).
- "Unlimited favorites" paywall bullet'i kaldirilir (favoriler kapisiz kalir, vaat duzelir).

### 1.2 Trial + downsell + winback (Statura kaskadi portu)
- Yearly pakette introPrice/trial algila ve CTA'yi trial-farkindalikli yaz ("Bugun odeme yok.
  Bitmeden hatirlatacagiz. Istedigin an iptal."). Trial bitmeden 2 gun once yerel hatirlatma
  bildirimi (Statura'daki desen).
- app/downsell.tsx: RC 'downsell' offering'inden indirimli ilk yil; indirim ayni para
  biriminde GERCEKTEN dusukse goster (hasRealDiscount deseni), degilse durust "su an ozel
  teklif yok" fallback'i. Durum modeli: { count, lastShownAt, lastTrigger } persist;
  onboarding-sonu paywall dismiss'i ilk tetik, uygulama ici dismiss'te 7 gun sonra bir kez
  re-arm, toplam 2 gosterim. Winback: entitlement kaybinda bir kez.
- Lifetime fallback fiyatlari 79.99 / uygun EUR / uygun TL olarak guncellenir.

### 1.3 Yerellestirilmis fiyat gosterimi (TR/USD bulgusu, tum app'lerde ortak)
- Kullanici raporu: TR vitrininde fiyatlar USD gorunuyor, odeme sayfasi TL dogru. Gosterilen
  HER fiyat RevenueCat package'inin `product.priceString`'inden gelsin; para birimi simgesi
  elle kurulmasin. Turetilmis degerler (yillik ayda X, tasarruf yuzdesi, ustu cizili fiyat)
  `product.price` + `product.currencyCode` + `Intl.NumberFormat` ile.
- Release'te offerings fetch basarisizsa statik fallback fiyatlar ASLA render edilmez:
  "yukleniyor / tekrar dene" durumu + offerings_fallback_shown(reason) event'i. Grep: '$',
  'USD', '₺', toFixed ile fiyat kuran her yer (statik fallback tablosu dahil).

## FAZ 2: Onboarding'in quiz'e donusturulmesi

- Mevcut: 4 slide + tek ekranda yogun form (karb oranlari, ISF, hedefler) + disclaimer.
  Yeni yapi (Statura formulu, ekran sirasi):
  1) 3 kisa deger slide'i (ozel-offline gunluk; olc-anla; aile/hesapsiz) - mevcuttan kirp.
  2) Adim adim sorular, her ekranda TEK soru: profil adi -> birim (mg/dL / mmol/L) ->
     diyabet tipi/tedavi sekli (opsiyonel, plani kisisellestirmez, yalnizca metin tonu) ->
     aclik hedefi -> tokluk hedefi -> ogun basina karb orani -> ISF -> basal saati.
  3) Karb orani ve ISF ekranlarina "Emin degilim" yolu: makul varsayilanla devam eder ve
     Ayarlar'da nereden degisecegini soyler (yeni tani olan kullanici bloklanmaz).
  4) Zorunlu tibbi disclaimer onayi (mevcut metin korunur).
  5) Demo verisiyle dolu bir Insights/AGP onizlemesi ("verilerin boyle gorunecek", mevcut
     demo-data altyapisi kullanilir) -> soft paywall (trial'li yillik secili, kapatilabilir)
     -> kapatana downsell -> dashboard.
- Bildirim izni mevcut davranista kalir (basal saati kurulumunda contextual).
- onboarding_step (step) event'leri her adimda; kopma noktasi ilk kez olculebilir olacak.
- Kabul: yeni kullanici akisi bastan sona calisir; eski kullanici onboarding'i bir daha gormez.

## FAZ 3: Medikal temas ozellikleri (kullanici istekleri)

### 3.0 Doz tahmini dil temizligi (regulasyon, oncelikli)
- Doz karti/ekranindaki her metin "oneri" dilinden "senin girdigin oranlarin aritmetigi"
  diline cekilir: "Onerilen doz: X" YASAK; "Girdigin orana gore hesap: X (karb / oranin)"
  gibi seffaf formul gosterimi + her gosterimde kisa disclaimer ("Bu bir tibbi tavsiye
  degildir; dozuna saglik ekibinle karar ver."). Store metadata'daki doz dilini de tara
  (HUMAN TODO'ya not dus). 5 dilde.

### 3.1 Tokluk olcum alarmi (ilk lokma butonu, free)
- Dashboard'a belirgin tek buton: "Yemege basladim". Basinca 2 saat sonrasina yerel bildirim
  ("Tokluk olcum zamani") kurulur; ayni pencerede yemek log'undan otomatik kurulan mevcut
  2 saat kontrolu ile CAKISMA dedupe edilir (ayni saate iki bildirim asla). Sure ayari
  Ayarlar'dan degistirilebilir (90/120/150 dk). Buton tekrar basilirsa sayac yenilenir.
- Event: tokluk_timer_started.

### 3.2 Tum hatirlaticilara kullanici saati
- Basal ve gunluk olcum hatirlaticisinda saat secimi var; eksik olan her hatirlatici tipine
  (haftalik ozet gunu/saati dahil) kullanici saati eklenir. lib/services/notifications.ts
  tek koordinasyon noktasi kalir.

### 3.3 Dusuk deger sonrasi takip hatirlaticisi (notr dil)
- Kullanicinin KENDI belirledigi esik (varsayilan birim-duyarli, orn. 70 mg/dL) altinda bir
  olcum LOG'landiginda: "Son olcumun X. 15 dakika sonra tekrar olcmeyi hatirlatalim mi?"
  onerisi (tek dokunusla kur) + olcum detayinda acil kisiye ulas kisayolu (3.4'e link).
- REGULASYON: tani/sonuc dili yok, otomatik "uyari" yok; kullanici eyleminden dogan,
  kullanici-esikli bir hatirlatici. Bildirim kopyasi da notr.

### 3.4 SOS acil durum (free)
- Ayarlar: acil kisi(ler) (isim + telefon; rehberden secim expo-contacts ile opsiyonel).
- SOS ekrani (dashboard'dan erisilebilir, sade ve buyuk): uc aksiyon:
  a) Acil kisiye mesaj: konumu al (expo-location, izin lazy), hazir metin + harita linkiyle
     SMS composer'i ac (kullanici tek dokunusla gonderir; otomatik gonderim iki platformda da
     mumkun degil, VAAT ETME). WhatsApp secenegi: wa.me deep link ayni metinle.
  b) Acil kisiyi ara: tel: / dialer (tek dokunus onayli).
  c) 112'yi ara: dialer'da hazir (uygulama otomatik arayamaz, buton "112'yi ac" der).
- Kopya durust: "yardima hizli ulasmani kolaylastirir"; "otomatik arar/gonderir" IDDIASI YOK.
- Event: sos_opened, sos_action (call|sms|contact).

## FAZ 4: Analiz katmani (Pro degeri) + retention

### 4.1 90 gunluk trendler + sayisal ortalamalar
- Insights'a pencere secici: 7 (free) / 30 / 90 (Pro). Her pencere icin: sayisal ortalama
  (orn. "126 mg/dL"), percentil bandi ortalamalari (AGP bandlarinin sayisal ozeti), TIR,
  olcum sayisi, onceki pencereyle kiyas trend oku. Istersen GMI gostergesi: yalnizca
  "tahmini gosterge, laboratuvar HbA1c degildir" disclaimer'iyla ve tarif edici dille.
- Free kullanici 30/90 sekmesini blurlu onizleme + kilit olarak gorur (bos kilit ekrani
  yerine merak bosluğu).

### 4.2 Doktor raporu PDF (Pro'nun amiral ozelligi)
- Tek dokunusla PDF: secilen pencere (30/90 gun) icin ortalamalar, TIR, AGP grafigi,
  olcum/insulin ozetleri, notlar; basinda profil + birim + tarih araligi. expo-print ile
  uret, sistem paylasim sheet'i ile paylas ("Doktorunla paylas" cercevesi).
- Rapor dili tamamen tarif edici; yorum/oneri yok. Event: report_generated.

### 4.3 Haftalik oruntu ozeti + tutarlilik + review
- Haftada bir Insights ustunde kart (Pro): 2-3 notr istatistik cumlesi ("Bu hafta TIR %68,
  gecen haftadan 5 puan yuksek", "Sabah olcumlerin aksamlardan ortalama 18 mg/dL dusuk").
  Kural tabanli uret (sablon + hesap), yapay yorum yok.
- Log tutarlilik gostergesi (streak degil "seri" baskisi olmadan: "ust uste X gun kayit"):
  dashboard'da kucuk rozet. Kacirilan gun suclanmaz.
- expo-store-review: ilk 10. log VEYA ilk haftalik ozet goruntulemesi sonrasi, omur boyu
  bir kez. Event: review_prompted.

### 4.4 Health genisletmesi (saat/pompa gercekci kapsam)
- HealthKit insulin delivery tipini oku (DIY Loop kullanicilari icin insulin verisi otomatik
  gelir); Health Connect'te insulin tipi yok, Android'de manuel kalir.
- HealthKit/Health Connect'ten antrenman/aktivite oku ve gunluk grafige aktivite bandi olarak
  bindir ("aktivite vs glukoz" gorunumu, Pro). Apple Watch entegrasyonunun faz 1'i budur;
  watchOS uygulamasi ve widget R2 (asagida).
- Store metinlerinde "Dexcom uyumlu (Apple Saglik / Health Connect uzerinden)" cumlesi
  kullanilabilir (HUMAN TODO'ya not); Libre icin uyumluluk IDDIASI YOK.

## HUMAN TODO (kullanici yapacak)

- [YAPILDI 2026-07-08] Firebase projesi + google-services dosyalari (repo kokunde, dogrulandi).
- RevenueCat: yearly'ye 7 gun trial intro offer, 'downsell' offering'i (indirimli ilk yil
  yearly), lifetime 79.99 fiyat degisikligi (App Store Connect + Play), TR vitrini fiyat
  noktalarinin TL tanimli oldugunun kontrolu.
- Play Console: SDK yukseltmesi sonrasi target API 35 build'inin yuklenmesi.
- Store metadata: aile/bakici acisi + tokluk alarmi + SOS + doktor raporu listing'e; doz ve
  hipo DILI regulasyon kurallarina gore taranip temizlenecek ("warns about hypos" tarzi
  cumle varsa kaldir); "Dexcom uyumlu (Health uzerinden)" eklenebilir.
- Cihaz QA en sonda toplu (asistan checklist'i bu dosyanin altinda biriktirsin).

## R2 adaylari (bu turda YAPMA, cerceve burada dursun)

- Supabase aile/bakici uzaktan paylasimi: ebeveynin cocugun degerlerini kendi cihazindan
  gormesi. Kategorinin en yuksek odeme istekliligi tasiyan ozelligi; ama saglik verisini
  sunucuya tasimak offline-first konumlanmayi, KVKK/GDPR yukunu ve store saglik-verisi
  incelemesini devreye sokar. On kosullar: uctan uca sifreleme tasarimi, acik riza akisi,
  veri silme/tasima, ayri gizlilik metni. Karar ayri turda verilecek.
- iOS widget (son olcum + IOB) + Live Activity: SDK 57'ye gecince expo-apple-targets ile
  mumkun; R2'de.
- watchOS uygulamasi/komplikasyon: native Swift isi + saatte glukoz gosteriminin regulasyon
  imasi; R2'de bile dikkatle.
- Libre gayriresmi API'si: HICBIR ZAMAN (ToS + App Review riski).

## Dogrulama

- Her faz: npx tsc --noEmit temiz + yeni string'ler 5 locale'de + event'ler debug'da akiyor.
- Faz 1 ozel: free kullanicida log eklemenin HICBIR yerde bloklanmadigi; Health senkronunun
  free'de kapali, Pro'da acik oldugu; downsell'in 2 gosterim cap'i ve gercek-indirim kosulu.
- Faz 3 ozel: ayni saate cift tokluk bildirimi kurulamadigi (dedupe testi); SOS'un izin
  reddi durumlarinda da (konum yok) mesaj composer'inin konumsuz metinle acilabildigi.
- Regulasyon taramasi: yasak dil listesi uzerinden locale dosyalarinda grep (hipoglisemi
  uyarisi, bayil, tehlike, onerilen doz vb. 5 dilde karsiliklari).
- Cihaz/his testleri en sonda toplu QA listesiyle.

## FAZ ILERLEME (asistan gunlugu)

- FAZ 0.1 (SDK 51 -> 57) TAMAM: expo 57, react 19.2, react-native 0.86, reanimated 4.5
  (+ worklets 0.10), screens 4.25, safe-area 5.7, purchases 10.4, healthkit 14 (nitro),
  @expo/vector-icons 15, TS 6, @types/react 19. Dort SDK-51 patch'i kaldirildi (API-35 +
  iOS switch + isSimulator + removeLast; hepsi SDK 57'de upstream). SDK 57 API kirilmalari
  gecirildi: expo-notifications tipli trigger'lar (DAILY/WEEKLY/TIME_INTERVAL) + banner/list
  davranisi, expo-file-system /legacy (documentDirectory/cacheDirectory), HealthKit v14 nitro
  (string identifier + toShare/toRead + filter.date). babel: manuel reanimated plugin kaldirildi
  (preset-expo 57 worklets plugin'i otomatik ekliyor). ios deploymentTarget 16.4. Dogrulama:
  tsc temiz, expo config plugin'leri cozuluyor, iOS+Android tam JS bundle export'u basarili.
- FAZ 0.2 (Firebase + analytics) TAMAM: lib/analytics/ facade (tipli logEvent/logCrash, sink
  deseni, dev'de her event console'a). Firebase GERCEKTEN kuruldu (google-services repo'da):
  @react-native-firebase/app+analytics+crashlytics 25.1, config plugin'ler + googleServicesFile
  yollari app.json'da, lib/analytics/firebaseSink.ts sink'i baglar, app/_layout.tsx bootstrap'te
  initAnalyticsSink() (prod'da baglanir, dev'de console). `promise@8.3.0` direct dep eklendi
  (crashlytics'in promise/setimmediate/rejection-tracking resolve'u icin, RN 0.86 hoisting).
  Dose edilen event'ler: log_added (glucose/meal/insulin, manual+health), paywall_view/
  dismiss/tier_selected, purchase_completed, insights_view. Kalan event'ler ilgili fazlarda
  dose edilecek (onboarding_*, tokluk_timer_started, sos_*, downsell_*, winback, trial_started,
  report_generated, review_prompted, offerings_fallback_shown).
- FAZ 1.1 (Free/Pro cit) TAMAM: 5-log cap tamamen kaldirildi (guardrails/logs +
  index/calculator call site'lari), manuel log iki tarafta sinirsiz. Ozel yiyecek 3->10.
  Health auto-sync Pro'ya tasindi: dashboard toggle free'de paywall(reason:health)
  acar, runSync + sessiz acilis-senkronu + tap-senkron isPro ile gated, satirda Pro
  rozeti; mevcut free kullanici verisini korur + tek seferlik bilgi (import yolu gated).
  Paywall: yanlis "sinirsiz favori" + sinirsiz-log bullet'lari kaldirildi, health sync /
  sinirsiz ozel yiyecek / 30-90g insights value prop eklendi. 5 locale.
- FAZ 1.2 (trial + downsell + winback) TAMAM: Statura kaskadi portu.
  lib/services/downsell.ts (count/lastShownAt/lastTrigger state, canShowDownsell,
  2 gosterim cap + 7 gun re-arm, winback-shown flag). purchases.ts: loadOfferings
  (gercek fiyat + trial algisi + fallback status), getDownsellOffer/purchaseDownsell/
  winbackHasRealDiscount (hasRealDiscount = ayni para birimi + gercekten dusuk).
  app/downsell.tsx + app/winback.tsx (gercek indirim yoksa durust fallback / redirect).
  Paywall dismiss -> downsell kaskadi; entitlement kaybinda _layout winback'i bir kez acar.
  Trial-farkindalikli CTA + trial bitmeden 2 gun once yerel hatirlatma
  (scheduleTrialEndingReminder). Lifetime fallback 79.99 / EUR79,99 / TL2.399,99.
  Event: downsell_view/accept/dismiss, winback_view, trial_started dose edildi. 5 locale.
- FAZ 1.3 (yerel fiyat) TAMAM: tum fiyatlar product.priceString'den; turetilmis degerler
  (yillik ayda X, tasarruf %, ustu cizili) product.price + currencyCode + Intl.NumberFormat.
  Release'te offerings cekilemezse statik fallback ASLA render edilmez: yukleniyor/tekrar-dene
  durumu + offerings_fallback_shown(reason). Dead static-price yollari (priceFor,
  getOfferingPrices) silindi; grep ($, USD, TL, toFixed) temiz (yalniza dev-mock priceUSD).

## CIHAZ QA CHECKLIST (toplu, en sonda calistirilacak)

Asistan cihazda test edemez; her faz kendi kalemlerini buraya ekler, kullanici en sonda topluca
kosar.

### Faz 0
- [ ] `npx expo prebuild --clean` iki platformda hatasiz (android/ + ios/ yeniden urer).
- [ ] iOS pod install Firebase pod'lariyla derleniyor. Hata "Firebase needs use_frameworks"
      derse: app.json expo-build-properties ios'a `"useFrameworks": "static"` ekle ve nitro
      (healthkit) + reanimated 4 pod'larinin hala derlendigini dogrula.
- [ ] Uygulama iki platformda aciliyor; log / olcum / bildirim / satin alma smoke akisi calisiyor.
- [ ] HealthKit v14 (nitro) iOS'ta: Health izni istegi geliyor, glukoz okuma import ediyor
      (v8 -> v14 API rewrite cihazda dogrulanmali).
- [ ] Bildirimler gercek zamanli tetikleniyor: basal/glucose (DAILY), haftalik (WEEKLY),
      tokluk (TIME_INTERVAL).
- [ ] Firebase Analytics DebugView'de event'ler akiyor; Crashlytics'e test crash dusuyor
      (release/dev-client build gerekir, __DEV__ sink'i baglamiyor).
- [ ] iOS deploymentTarget 16.4: App Store Connect minimum OS ve hedef cihaz kitlesi kontrol.

### Faz 1
- [ ] Free kullanici hicbir yerde log eklerken bloklanmiyor (dashboard hizli log,
      calculator meal, injection) - sinirsiz.
- [ ] Free'de Health satiri Pro rozetiyle gorunuyor, dokununca paywall(health) aciliyor;
      Pro'da toggle + tap-senkron calisiyor. Eski free (senkron aciksa): veri silinmiyor,
      tek seferlik "artik Pro" bilgisi cikiyor.
- [ ] Ozel yiyecek 11.'de paywall(foods) aciliyor (limit 10).
- [ ] RevenueCat: yearly'de trial CTA gorunuyor ("7 gunluk ucretsiz deneme"), satin alinca
      2 gun once trial-bitis hatirlatmasi kuruluyor; App Store/Play trial dogru.
- [ ] Paywall kapatinca downsell aciliyor (ilk sefer). RC'de 'downsell' offering'i +
      GERCEK indirim varsa indirimli kart, yoksa durust "su an teklif yok" fallback.
      Ayni kullanici omur boyu en fazla 2 downsell (7 gun re-arm) goruyor.
- [ ] Entitlement kaybinda winback bir kez aciliyor (yalniza gercek indirim varsa).
- [ ] TR vitrininde fiyatlar TL gorunuyor (USD degil); offerings cekilemezse fiyat yerine
      "tekrar dene" cikiyor, sahte fiyat YOK. (Kullanici raporundaki TR/USD bulgusu.)
