# zerospike Onboarding R2 build prompt (2026-07-09)

Sen zerospike (diyabet gunlugu) uzerinde calisan gelistirme session'isin. Bu dosya
sozlesmendir: fazlari sirayla uygula, faz basina commit at, fazlar arasi onay BEKLEME
(onay pesinen verildi). Cihaz QA en sonda kullanici tarafindan toplu yapilacak.

## Kurallar

- main dalinda calis.
- Statik kapi HER fazda: `npm run typecheck` (tsc + i18n-check birlikte kosar).
- Em dash (U+2014) HICBIR yerde.
- REGULASYON DILI (ihlal edilemez): "uyarir", "alarm", "hipoglisemi uyarisi", "tani",
  "tedavi", "onerilen doz", "doz onerisi" tarzi ifadeler YASAK. Gunluk/takip/hatirlatici
  dili kullanilir. Sayilar daima kullanicinin kendi girdigi degerlerin aritmetigidir ve
  oyle sunulur. Diyabet tipi cevabi yalniz metin tonunu degistirir, HICBIR hesabi degistirmez
  (mevcut qDiabetesHint ilkesi korunur).
- Android'de Health Connect YOK ve GERI EKLENMEZ (Play politika karari). Health/CGM yalniz
  iOS. Onboarding hicbir platformda Health'ten bahsetmesin.
- i18n: lib/i18n/locales/tr.ts SEMA KAYNAGIDIR; yeni anahtar once tr.ts'e, sonra diger
  dortlu TS dosyalarina (typeof tr tipi pariteyi zorlar). i18n-check yalniz statik t("...")
  cagrilarini tarar, dinamik anahtar kullanirsan (orn. t(`onboarding.${step}Title`))
  anahtarlarin tamamini tr.ts'te bulundur. Ceviriler dogal, ana dil kalitesinde; TR
  diakritikleri dogru (ornek CTA: "Haydi başlayalım").
- Expo SDK 57: docs.expo.dev/versions/v57.0.0 dogrula.
- Sablon: ../statura (o da SDK 57). Sadece asagidaki dosyalari ac.

## Statura sablon dosyalari (sadece bunlari oku)

- ../statura/app/(onboarding)/index.tsx : hosgeldin (3 slayt + CTA)
- ../statura/components/ui/Carousel.tsx : oto-ilerleyen pager (3500ms) + animasyonlu noktalar
- ../statura/components/ui/LanguagePicker.tsx : bayrak cipi + bottom-sheet dil listesi
- ../statura/components/onboarding/OnboardingHeader.tsx : solda geri, sagda dil cipi
- ../statura/app/(onboarding)/quiz/[step].tsx : soru basina ekran + progress + oto-ilerleme
- ../statura/lib/motion/FadeSlideIn.tsx + presets.ts + useCountUp.ts : animasyon standardi
- ../statura/app/result.tsx : reveal cascade (kademeli giris, count-up, haptik)

## Mevcut durum haritasi (kesif dogrulandi, yeniden arastirma)

- Gate: app/_layout.tsx:50-68 (splash preventAutoHide + settle olmadan hide yok; dashboard
  flash fix'i BU MEKANIZMA, bozma). Bayrak: AsyncStorage `zerospike.onboarded`
  (lib/store/AppContext.tsx), su an paywall/downsell cikisinda set ediliyor.
- Mevcut akis: app/onboarding.tsx (615 satir, 13 adim: value1-3, name, unit, diabetes,
  fasting, postmeal, carbRatio, isf, basal, disclaimer, preview). SIFIRDAN yeniden
  yazilacak. Korunacak parcalar: profil kaydi (lib/db/profiles.ts updateProfile),
  zerospike.diabetesContext anahtari, bildirim rationale banner'i + OS izni deseni
  (R1.2-3), AgpPreview/computeAgp onizlemesi, DisclaimerBanner/AcceptCheck.
- Paywall: app/paywall.tsx (3 plan, annual on-secili + rozet; X ve purchase-cancel
  triggerDownsell'e bagli; downsell offering "downsell", realDiscount ayni para birimi +
  kesin dusuk fiyat; downsell_skipped_no_discount var). Entitlement "pro",
  lib/services/purchases.ts; listener YOK, refreshPro() pull modeli.
- Bilinen kusurlar (bu turda cozulecek):
  1) 13 adim cok uzun ve dallanma yok: tip 2 / prediyabet / gestasyonel kullaniciya da
     karb orani + ISF + bazal soruluyor.
  2) value2 slaytinda kullanici verisi olmadan sahte "2.5 units" doz karti gosteriliyor
     (onboarding.tsx:351-371): hem yaniltici hem regulasyon acisindan kotu. KALDIRILACAK.
  3) purchases.ts purchasePro catch'i (155-159) cancel disindaki HER hatayi
     {ok:false, cancelled:false}'a indirgiyor; paywall buy() bu durumda SESSIZCE paywall'da
     kaliyor (paywall.tsx:252 "no message" dali). Already-owned kurtarmasi yok.
  4) Settings'te "Satin alimlari geri yukle" satiri YOK (yalniz paywall'da var).
  5) Bayat metin: en/tr/de/fr/es'te "Apple Health / Health Connect" ifadeleri duruyor
     (yalniz iOS'ta render edildigi icin zararsiz ama yanlis; "Apple Health" kalacak).
  6) Kill-on-paywall riski: quiz bitti ama paywall'dayken uygulama olurse onboarded hala
     false, kullanici TUM quiz'i yeniden yasiyor.

## Hedef model (Statura standardi + kullanici direktifleri)

1) Hosgeldin: LOGO (components/Logo.tsx) + 3 kaydirmali slayt + "Haydi başlayalım".
   Slayt onerileri (notr dil; EN/TR ornek, 5 dilini sen yazacaksin):
   s1 "Log in seconds" / "Saniyeler içinde kaydet", s2 "See your patterns" / "Desenlerini
   gör" (zaman-icinde-aralik, gunluk ortalama gibi tarafsiz metrikler), s3 "A report your
   doctor can read" / "Doktorunun okuyabileceği rapor". Doz karti YOK.
2) HER ekranin sag ustunde dil cipi (statura deseni; mevcut dil altyapisi zerospike.lang).
   Onboarding kaynakli paywall/downsell da cipi tasir.
3) Quiz dallanmali, soru basina ekran, progress, geri, tek-secimde oto-ilerleme, stagger:
   isim -> birim (mg/dL / mmol/L) -> diyabet tipi -> YENI soru: "Günlük takibinde insülin
   var mı?" (secenekler notr: "Evet, bazal", "Evet, bolus", "Evet, ikisi de", "Hayır") ->
   hedef araliklar (acllik/tokluk, mevcut varsayilanlar duzenlenebilir) ->
   YALNIZ insulin kullananlara: karb orani, ISF, bazal saati (mevcut "emin degilim"
   varsayilan yolu korunur) -> bildirim rationale + OS izni (R1.2-3 deseni) -> disclaimer.
   Insulin cevabi da zerospike.diabetesContext yaninda benzer bir AsyncStorage anahtarina
   yazilir (zerospike.insulinContext) ve YALNIZ metin tonu/gorunurluk icin kullanilir.
4) Reveal (paywall'dan hemen once, kullaniciyi memnun eden veri ani): kademeli cascade:
   - "Planın hazır" basligi,
   - kisisel hedef aralik karti (kendi girdigi acllik/tokluk hedefleri, sectigi birimde),
   - mini AGP onizleme (mevcut AgpPreview, "örnek veri" etiketi ZORUNLU),
   - kayit plani karti (sectigi hatirlaticilar: tokluk takibi, bazal saati vb).
   Count-up + hafif haptik. CTA "Devam" -> paywall (context=onboarding).
5) Bayrak zamanlamasi DEGISIYOR: profil kaydedilip reveal'a gecildiginde
   completeOnboarding() cagrilir (paywall oncesi). Boylece paywall'da olum re-quiz
   yaratmaz (relaunch tabs'a iner). Gate'in inOnboardingPaywall istisnalari korunur;
   onboarded=true iken /onboarding'e girisin engellenmesi ayni kalir.

## FAZ 1: Onboarding'i bastan yaz

- app/onboarding.tsx'i sifirdan yaz (parcalar components/onboarding/ altina: Welcome,
  QuizStep, Reveal, LanguageChip). Yukaridaki akis + dallanma.
- Motion: reanimated FadeSlideIn esdegeri (380ms, 80ms stagger, ReduceMotion.System).
- Analytics: onboarding_step / onboarding_done isimleri korunur.
- Kullanilmayan eski anahtarlar silinir, yeniler 5 TS dosyasina eklenir (once tr.ts).
- app/profile-setup.tsx AYRI bir modal (aile profili), bu turda DOKUNMA; yalniz yeni
  gorsel dilden bariz kopmuyorsa birak.
- Kapi + commit: `feat(onboarding): statura-model rewrite (branching quiz + reveal)`

## FAZ 2: Paywall sadelestirme + gorunur ucretsiz cikis

- Fayda blogunu statura modeline indir: TEK liste, en fazla 4 fayda satiri (mevcut 3 grup
  x cok satir yerine). Limit banner'i (reason parametresi) korunur.
- X'in yanina gorunur bir "Şimdi değil" ghost butonu ekle (ikisi de ayni dismiss yolundan
  triggerDownsell'e gider; mevcut zincir korunur).
- Onboarding baglaminda sag ustte dil cipi.
- Settings Pro bolumune "Satin alimlari geri yukle" satiri ekle (mevcut restore servisi
  purchases.ts restore() + refreshPro ile; toast'lar paywall'dakiyle ayni anahtarlar).
- Kapi + commit: `feat(paywall): statura-model simplification + visible free exit + settings restore`

## FAZ 3: already-owned satin alma fix'i + sessiz hata dalinin kaldirilmasi

Senaryo (kullanici cihazda yasadi, statura'da): zaten sahip olunan paket tekrar satin
alinmaya calisilinca magaza already-owned hatasi doner, uygulama hicbir sey soylemeden
paywall'da kalir, premium restore + restart olmadan aktiflesmez.

- purchases.ts purchasePro: catch'te hata siniflandirmasi yap (react-native-purchases
  PURCHASES_ERROR_CODE; surumu dogrula). Donen tipe hata sinifi ekle
  (cancelled / alreadyOwned / storeError).
- Kurtarma akisi: cancel degilse once getCustomerInfo ile "pro" aktif mi bak; aktifse
  ok:true don. Degilse alreadyOwned ise restore() dene; aktiflesirse ok:true. Bu mantigi
  saf yardimci fonksiyona cikar.
- paywall.tsx buy(): SESSIZ dal kaldirilir. ok:true kurtarmasinda localize bilgi
  ("Bu paket zaten sende, Pro etkinleştirildi.", 5 dil) + normal basari cikisi.
  Gercek magaza hatasinda localize generic toast (sessiz kalma). downsell.tsx ve
  winback.tsx ayni yardimci fonksiyonu kullanir.
- Kapi + commit: `fix(purchases): recover already-owned purchases + remove silent error path`

## FAZ 4: metin hijyeni + i18n dogallik

- Bayat Health metinleri: 5 dilde "Apple Health / Health Connect" gecen anahtarlari
  "Apple Health" olarak sadelestir (ozellik zaten iOS-only render ediliyor).
- Notr dil rotuslari (anahtar adlari kalir, metin yumusar, 5 dil):
  settings.reminderPenLow "Low pen alert" -> "Kalem seviyesi hatırlatıcısı" tarzi;
  pens.lowWarning "Low: about {{n}} units left" -> "Yaklaşık {{n}} ünite kaldı" tarzi;
  calculator.warn* metinlerini oku, tanimlayici kalmalarini dogrula (uyari/alarm imasi
  varsa tarafsizlastir).
- Dogallik taramasi: onboarding.*, paywall.*, downsell.* bloklarini 5 dilde oku, makine
  tonunu ana dil kalitesine getir. Em dash taramasi (locales'te U+2014 sifir).
- Kapi + commit: `chore(i18n): neutral-language + native-quality pass`

## Bitis raporu + cihaz QA checklist (dosyanin sonuna yaz)

Rapora: degisen dosyalar, silinen/eklenen anahtar sayilari, adim sayisi (once/sonra).
QA checklist en az:
- Ilk acilis: splash'tan dogrudan onboarding (dashboard flash yok), logo + 3 slayt +
  "Haydi başlayalım"; dil cipi her ekranda, degisim aninda.
- Dallanma: "Hayır" (insulin yok) secince karb orani/ISF/bazal SORULMUYOR; "Evet" yolunda
  soruluyor ve "emin değilim" varsayilanlari calisiyor.
- Reveal: hedef aralik kendi girdigi degerlerle ve sectigi birimde; AGP "örnek veri"
  etiketli; kayit plani sectigi hatirlaticilarla uyumlu.
- Paywall: 4 fayda, "Şimdi değil" gorunur, X/simdi-degil/purchase-cancel -> downsell;
  red -> tabs. Paywall'dayken uygulamayi oldur + tekrar ac: quiz TEKRAR GELMIYOR.
- Sandbox'ta sahip olunan paketi tekrar satin al: restart GEREKMEDEN Pro aktif ve ekran
  bunu soyluyor. Settings'ten restore calisiyor.
- 5 dilde onboarding bastan sona; TR diakritikleri; regulasyon dili taramasi (uyari/alarm/
  doz onerisi ifadesi yok); Android'de Health'ten iz yok.

---

## Bitis raporu (uygulandi 2026-07-09)

Dort faz da main dalinda, faz basina bir commit ile uygulandi. Her fazda
`npm run typecheck` (tsc + i18n-check) yesil. i18n sema anahtari: 520 -> 527 (net +7).
Em dash (U+2014) locales'te sifir; yeni kodda da yok. Regulasyon dili taramasi temiz.

Commitler:
- `feat(onboarding): statura-model rewrite (branching quiz + reveal)`
- `feat(paywall): statura-model simplification + visible free exit + settings restore`
- `fix(purchases): recover already-owned purchases + remove silent error path`
- `chore(i18n): neutral-language + native-quality pass`

### Degisen dosyalar

Yeni:
- components/onboarding/motion.tsx (FadeSlideIn 380ms / 80ms stagger / useCountUp,
  ReduceMotion.System)
- components/onboarding/LanguageChip.tsx (her ekranda sag ust, zerospike.lang altyapisi)
- components/onboarding/Welcome.tsx (logo + 3 oto-ilerleyen slayt + "Haydi başlayalım")
- components/onboarding/QuizStep.tsx (progress + stagger + footer cerceve)
- components/onboarding/Reveal.tsx (cascade: hedef kart + AGP onizleme + kayit plani)
- lib/services/purchaseFlow.ts (paywall/downsell/winback icin ortak sonuc -> toast eslemesi)

Degisen:
- app/onboarding.tsx (sifirdan yazildi; dallanmali durum makinesi)
- app/_layout.tsx (gate: reveal'da onboarded=true olurken bounce olmayacak, tekrar-giris
  engeli korunur)
- app/paywall.tsx (tek fayda listesi <=4, "Şimdi değil", onboarding'de dil cipi,
  sessiz hata dali kaldirildi)
- app/downsell.tsx, app/winback.tsx (ortak purchaseToastFor; downsell onboarding'de dil cipi)
- app/(tabs)/settings.tsx (Pro bolumune "Satın alımları geri yükle" satiri)
- lib/services/purchases.ts (hata siniflandirma + already-owned kurtarma; purchaseDownsell
  da PurchaseOutcome dondurur)
- lib/i18n/locales/{tr,en,de,es,fr}.ts

### Anahtar sayilari (her locale)

- Silinen onboarding anahtari: 23 (welcome, subtitle, value1-3 Title/Body, qFasting,
  qPostmeal, previewTitle, previewSubtitle, seePlans, start, skip, s1-4 Title/Body)
- Eklenen onboarding anahtari: 26 (getStarted, slide1-3 Title/Body, qInsulin(+Hint),
  insulin_basal/bolus/both/none, qTargets(+Hint), qNotify(+Hint), notifyCta, revealTitle,
  revealSubtitle, revealTargetsTitle, revealPlanTitle, planPostMeal, planLowFollow,
  planBasal, sampleBadge)
- Diger eklenen: paywall.notNow, settings.restorePurchases, paywall.alreadyOwned,
  paywall.purchaseError (net +4)
- Toplam sema: 520 -> 527

### Adim sayisi (once / sonra)

- Once: 13 ekran, dallanma yok (value1-3, name, unit, diabetes, fasting, postmeal,
  carbRatio, isf, basal, disclaimer, preview).
- Sonra: hosgeldin (1 ekran, 3 slayt) + dallanmali quiz + reveal.
  - Insulin YOK ("Hayır"): name, unit, diabetes, insulin, targets, notify, disclaimer =
    7 quiz ekrani (+ hosgeldin + reveal).
  - Insulin VAR: + carbRatio, isf, basal = 10 quiz ekrani (+ hosgeldin + reveal).
- Insulin kullanmayan yeni kullanici 13'ten 7 soruya iner; sahte "2.5 units" doz karti
  tamamen kaldirildi.

### Cihaz QA checklist (kullanici tarafindan)

- [ ] Ilk acilis: splash'tan dogrudan onboarding'e (dashboard flash yok); logo + 3 slayt
      (3500ms oto-ilerleme) + "Haydi başlayalım".
- [ ] Dil cipi her ekranda sag ustte; anlik degisiyor (welcome, quiz, reveal ve
      onboarding kaynakli paywall/downsell dahil).
- [ ] Progress bar her adimda ilerliyor.
- [ ] Dallanma: "Hayır" secince karb orani / ISF / bazal SORULMUYOR. "Evet, bazal/bolus/
      ikisi de" yolunda soruluyor; "Emin değilim" varsayilanlariyla (karb 10, ISF 40 mg/dL)
      ilerliyor.
- [ ] Tek secimli adimlar (diyabet, insulin) secimde oto-ilerliyor; geri butonu calisiyor.
- [ ] Reveal: hedef aralik count-up ile kendi girdigi degerlerde ve sectigi birimde
      (mg/dL veya mmol/L); AGP karti "Örnek veri" etiketli; kayit plani sectigi
      hatirlaticilarla uyumlu (insulinsizde bazal satiri yok).
- [ ] Sistem "Hareketi Azalt" (Reduce Motion) acikken animasyonlar aninda; icerik kayboluyor
      degil.
- [ ] Paywall: tek listede en fazla 4 fayda; "Şimdi değil" gorunur. "Şimdi değil" / X /
      satin-alma iptali -> downsell zinciri (lifetime cap ayni); downsell reddi -> tabs.
- [ ] Paywall veya downsell'deyken uygulamayi oldur + tekrar ac: quiz TEKRAR GELMIYOR
      (dogrudan tabs). Reveal'a gelmis her kullanici icin gecerli.
- [ ] Sandbox'ta sahip olunan paketi tekrar satin al: RESTART GEREKMEDEN Pro aktif ve
      ekran "Bu paket zaten sende, Pro etkinleştirildi." diyor. Gercek magaza hatasinda
      generic hata toast'i cikiyor (sessiz kalmiyor).
- [ ] Settings > zerospike Pro > "Satın alımları geri yükle": restored / nothingToRestore /
      restoreFailed toast'lari paywall ile ayni.
- [ ] 5 dilde onboarding bastan sona dogal okunuyor; TR diakritikleri dogru
      ("Haydi başlayalım", "Şimdi değil").
- [ ] Regulasyon dili yok (uyari/alarm/doz onerisi/tani); diyabet ve insulin cevabi yalniz
      metin tonunu/gorunurlugu degistiriyor, hicbir sayiyi degistirmiyor.
- [ ] Android'de onboarding + paywall'da Health/Health Connect izi yok; iOS'ta Apple Sağlık
      metni "/ Health Connect" olmadan gorunuyor.
- [ ] Kalem seviyesi hatirlaticisi ve az-kalan metni tarafsiz ("Kalem seviyesi hatırlatıcısı",
      "Yaklaşık {{n}} ünite kaldı").

## FAZ 5 (R2.1, 2026-07-09): "Yemeğe başladım" butonu sayaçli ve tek atimlik olsun

Kullanici istegi + hub teshisi: buton (app/(tabs)/index.tsx:654, startedEating :217)
her zaman aktif; startPostMealTimer POSTMEAL_ID'yi paylastigi icin tekrar basmak
bildirimi COGALTMIYOR ama zamanlayiciyi bastan kuruyor (90. dakikada tekrar basan
kullanici hatirlaticiyi 2 saat daha erteliyor) ve toast her basista tekrarlaniyor.
Hicbir gorsel durum geri bildirimi yok.

Spec:

- ONEMLI CAKISMA (dogrulandi): ayni POSTMEAL_ID'yi otomatik yollar da kuruyor: acllik/
  yemek oncesi olcum kaydi (index.tsx:242 schedulePostMealReminder) ve yemek kaydi
  (calculator.tsx:171). Sayacin gercek bildirimle uyusmasi icin kalicilik SERVIS
  katmaninda merkezilestirilir: schedulePostMealAt (notifications.ts:251) basarili her
  kurulumda AsyncStorage `zerospike.postMealTimerEnd` = Date.now() + minutes*60000
  yazar; notifications.ts'ten getPostMealTimerEnd() ve cancelPostMealTimer() export
  edilir. Boylece otomatik kurulumlar da butonu sayac moduna gecirir. Izin yoksa/kurulum
  olmadiysa yazilmaz (mevcut toast davranisi kalir).
- Buton durumu: now < timerEnd iken buton DEVRE DISI (dimmed gorunum, onPress pasif,
  accessibilityState disabled) ve uzerinde canli geri sayim gosterir. Format: kalan
  > 1 dk ise "{{m}} dk" hassasiyeti, son dakikada saniye ("{{s}} sn"). Metin notr:
  ornek TR "Tokluk hatırlatıcısı: 118 dk" (alarm/uyari kelimesi YOK). Tik araligi
  ekran aciktayken 30 sn yeterli (son dakikada 1 sn); AppState/focus donusunde yeniden
  hesapla. Sure dolunca anahtari temizle, buton normale doner.
- Erken tamamlanma: zamanlayici aktifken kullanici post_meal_2h etiketli bir olcum
  kaydederse amaci gerceklesmistir: zamanlanmis bildirimi iptal et
  (Notifications.cancelScheduledNotificationAsync ile POSTMEAL_ID; notifications.ts'e
  bir cancelPostMealTimer() export'u ekle) + timerEnd'i temizle. Kayit akisinin
  gectigi ortak noktayi bul (logger kaydi period_tag post_meal_2h ise tetikle).
- Relaunch: dashboard mount'unda timerEnd'i oku, gelecekteyse geri sayimla basla.
- Ayarlardan postMealDelay degisirse aktif sayaca DOKUNMA (eski sureyle biter).
- Kalan-sure formatlayicisini saf fonksiyon olarak yaz (lib/ altinda), i18n disinda
  mantik icermesin.
- i18n: yeni anahtarlar once tr.ts semasina, sonra 4 dile; notr dil; TR diakritikleri.
- Kapi: `npm run typecheck`.
- Commit: `feat(dashboard): post-meal timer button disables + live countdown while armed`
- QA checklist'e ekle: butona basinca devre disi kaliyor + geri sayim akiyor; uygulamayi
  kapat/ac geri sayim suruyor; sure dolunca buton normale donuyor; aktifken post_meal_2h
  olcumu kaydedince sayac kapaniyor ve bildirim gelmiyor; tekrar tekrar basilamiyor;
  acllik olcumu veya yemek kaydi sonrasi da buton sayac moduna geciyor.

## FAZ 6 (R2.1, 2026-07-09): profile-setup birim donusum bugi + g/ü lokalizasyonu

- BUG (hub koda karsi dogruladi, mmol kullanicilarinda VERI BOZAR): app/profile-setup.tsx
  save() (:60-76) girilen degerleri DONUSTURMEDEN updateProfile'a yaziyor ve :126/:135/
  :185 suffix'i common.mgdl'ye sabitliyor. mmol/L kullanan bir hanede yeni aile profili
  kurulurken alanlar mg/dL etiketiyle gorunur ve mmol olcekli sayilar mg/dL kolonlarina
  yazilir; hedefler + ISF bozulur, o profilin tum siniflandirma/insight/rapor ciktilari
  etkilenir. Fix: settings.tsx:337-390 desenini birebir uygula: aktif profilin birimini
  al, degerleri glucoseToDisplay ile goster, glucoseFromDisplay ile kaydet, suffix'i
  birim etiketiyle bas. Varsayilanlar da birime cevrilir (orn. 100 mg/dL -> 5.6 mmol).
- "g/ü" hardcoded TR kisaltmasi 7 yerde her dile sizio: profile-setup.tsx:156/164/172,
  onboarding.tsx:454 (yeni akis da tasimis), settings.tsx:403/412/421. Yeni i18n
  anahtari ekle (orn. common.carbRatioUnit) ve dil basina dogal kisaltmayi kullan
  (EN "g/U", TR "g/Ü", DE orn. "g/E", FR/ES uygun karsilik; sen belirle) ve 7 kullanim
  yerine uygula.
- Kapi: `npm run typecheck`.
- Commit: `fix(profiles): convert glucose fields by active unit + localize carb-ratio suffix`
- QA checklist'e ekle: mmol profilinde profile-setup alanlari mmol etiketiyle acilir,
  kaydedilen degerler settings'te ve dashboard hedeflerinde dogru okunur; 5 dilde karb
  orani alan son eki dogal gorunur.

---

## Bitis raporu (R2.1, uygulandi 2026-07-09)

FAZ 5 ve FAZ 6 main dalinda, faz basina bir commit ile uygulandi. Her fazda
`npm run typecheck` (tsc + i18n-check) yesil. i18n sema anahtari: 527 -> 530
(FAZ 5 +2: postMealCountdownMin/Sec; FAZ 6 +1: common.carbRatioUnit). Em dash
locales'te sifir; regulasyon dili taramasi temiz (sayac metni "Tokluk
hatırlatıcısı", alarm/uyari yok).

Commitler:
- `feat(dashboard): post-meal timer button disables + live countdown while armed`
- `fix(profiles): convert glucose fields by active unit + localize carb-ratio suffix`

### Degisen dosyalar (R2.1)

Yeni:
- lib/postMealTimer.ts (saf formatlayici: kalan ms -> {seconds, value})

Degisen:
- lib/services/notifications.ts (schedulePostMealAt zerospike.postMealTimerEnd
  yazar; getPostMealTimerEnd + cancelPostMealTimer export)
- app/(tabs)/index.tsx (buton sayac modu: disabled + canli geri sayim, tick 30s/1s,
  AppState + dataVersion tazeleme, post_meal_2h kaydinda erken tamamlanma)
- app/profile-setup.tsx (birim donusumu: glucoseToDisplay/glucoseFromDisplay,
  glucoseUnitLabel suffix, decimal-pad + maxLength 5)
- app/(tabs)/settings.tsx, app/onboarding.tsx (g/ü -> t("common.carbRatioUnit"))
- lib/i18n/locales/{tr,en,de,es,fr}.ts

### Cihaz QA checklist (R2.1, kullanici tarafindan)

- [ ] "Yemeğe başladım" butonuna basinca buton devre disi kaliyor ve uzerinde
      canli geri sayim akiyor ("Tokluk hatırlatıcısı: {{m}} dk", son dakikada "sn").
- [ ] Aktifken butona TEKRAR basilamiyor (disabled); toast tekrarlanmiyor.
- [ ] Uygulamayi kapat/ac: geri sayim kaldigi yerden suruyor; arka plandan donunce
      guncelleniyor.
- [ ] Sure dolunca buton normale donuyor ("Yemeğe başladım").
- [ ] Sayac aktifken bir post_meal_2h (tokluk) olcumu kaydedince sayac hemen
      kapaniyor ve o bildirim GELMIYOR (erken tamamlanma).
- [ ] Acllik/yemek oncesi olcum kaydi VEYA calculator'da yemek kaydi sonrasi da
      buton sayac moduna geciyor (otomatik yollar da sayaci kuruyor).
- [ ] Bildirim izni kapaliyken butona basinca sayac kurulmuyor; mevcut "bildirimleri
      ac" bilgisi cikiyor.
- [ ] Ayarlardan tokluk gecikmesini degistirmek aktif sayaci ETKILEMIYOR (eski
      sureyle bitiyor).
- [ ] mmol/L kullanan bir profille yeni aile profili kur (profile-setup): açlık/
      tokluk/ISF alanlari mmol etiketiyle ve mmol degerleriyle aciliyor; kaydedince
      settings ve dashboard hedefleri dogru okunuyor (mg/dL kolonuna mmol yazilmiyor).
- [ ] 5 dilde karb orani alan son eki dogal (TR "g/Ü", EN/ES/FR "g/U", DE "g/E").
