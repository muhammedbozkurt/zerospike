# R7.1 BUILD PROMPT: R7'nin Kalan Yarisi (isi haritasi + rapor + ekran mimarisi)

R7 Faz 1/2/6/7/8 teslim edildi ve denetimden gecti. Bu tur R7'de "kapsam disi birakildi" denen buyuk isleri bitirir. Kullanicinin EN SERT iki sikayeti (isi haritasi gorselligi, doktor raporu) bu turda; oncelik sirasi asagidaki gibidir, sirayla ve tek oturumda bitir, tek teslim raporu yaz.

## 0. Degismez kurallar (R7 ile ayni)
- Notr regulasyon dili; her yeni string 5 dil (tr/en/de/es/fr); em-dash yok; app.json surumune dokunma.
- Gateler: `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts` temiz.
- R7'de kurulan yeni kaliplar KULLANILIR: toast/undo icin lib/db/undo.ts + yeni Feedback toast, sayisal girisler icin components/Stepper.tsx, buyuk harf icin lib/upper.ts, sayi/tarih formatlari icin lib/format.ts Intl katmani, dil icin lib/lang.ts.
- "Zaten boyle" gerekcesi yasak; her maddede davranis kanitla.

---

## FAZ A: ISI HARITASI PROFESYONELLESME (en yuksek oncelik)

Kullanici mevcut haritayi "amator, basit, bolgeler eksik, noktalar kotu" buldu. `components/InjectionBodyMap.tsx` bastan.

### A.1 Anatomik silUET
- Tek parca kaba path yerine anatomik oranli, yumusak Bezier hatli SVG govde: bas/boyun/omuz/gogus/bel/kalca/uyluk hatlari belirgin, hafif katmanli derinlik (govde dolgusu THEME uzeri cok hafif dikey gradyan, dis hat ince ink cizgisi, eklem kivrimlarinda yumusak gecis).
- ON / ARKA gorunum toggle'i (ust segmente iki kucuk ikon: on-govde / arka-govde). Gecis yumusak fade.
- Silueti elle koordinat yazarak degil, once viewBox 0 0 240 420 uzerinde oranlari tanimlayip path'leri o oranlardan uret; kollar govdeden ayrik okunur, bacaklar ayrik.

### A.2 Bolge seti (FITTER hizasi, schema v9)
- ON gorunum bolgeleri: karin sol ust, karin sag ust, karin sol alt, karin sag alt (gobek cevresi bosluklu), uyluk sol, uyluk sag, kol sol, kol sag.
- ARKA gorunum bolgeleri: kalca sol ust-dis, kalca sag ust-dis.
- Schema v9 migration: injection_logs.site CHECK listesine yeni degerler eklenir (abdomen_left_upper, abdomen_right_upper, abdomen_left_lower, abdomen_right_lower, buttock_left, buttock_right). ESKI kayitlar AYNEN kalir: abdomen_left/right eski degerleri gecerli kalmaya devam eder ve haritada "karin sol/sag (genel)" olarak toplam gosterilir; hicbir veri donusturulmez. migration.test.ts'e v9 vakasi eklenir (eski site degerleri korunur, yeni degerler kabul edilir).
- lib/db/types.ts InjectionSite genisler; i18n'e yeni bolge adlari 5 dilde.

### A.3 Nokta gorselligi
- Her bolgede 2x2 nokta kalir; nokta gorsel capi min 14px, dolgu yogunluk rengi + ince halka; secili nokta parlayan halka + hafif olcek animasyonu; en uzun suredir kullanilmayan nokta kesikli halka (dil notr, oneri degil).
- Isi skalasi token tabanli tek eksen (dusuk kullanim → soluk, yuksek → accent'ten high'a); legend'da mini gradyan cubugu + "az / sik" uclari.
- Bolgeye dokununca zoom odak karti: harita ustunde buyuyen kart (arka plan dim), bolge adi basligi + 4 buyuk nokta karti (her biri son kullanim bilgisiyle), 44pt+.
- Erisilebilirlik: her bolge/nokta accessibilityLabel ("Karin sol ust, nokta 3, son kullanim 2 gun once" kalibi, 5 dil).

### A.4 Entegrasyon
- injection sekmesi, InjectionEditSheet ve rotasyon karti yeni bolge setiyle calisir; getSiteUsageHistory/rotasyon hesaplari yeni enum'u tanir; on/arka toggle secili bolgeye gore otomatik dogru yuze acilir.

---

## FAZ B: DOKTOR RAPORU BASTAN (5.2)

`lib/services/report.ts` bastan, cok sayfali print CSS. Tum sayilar Intl yerel formatta, tum basliklar i18n, uppercase yok. Acik zemin (print) korunur ama tasarim dili profesyonel tibbi rapor olur.

- SAYFA 1 KAPAK/OZET: hasta adi + aralik + uretim tarihi; KPI kartlari (ort. glukoz, GMI, TIR %, SD, CV, hipo sayisi) renk kodlu kutular; TIR yatay stack bar (veryLow/low/target/high/veryHigh, GLUCOSE renkleri); buyuk AGP grafigi (mevcut buildAgpSvg gelistirilerek: eksen etiketleri, hedef bandi vurgusu, yuzdelik lejanti).
- SAYFA 2+ GUNLUK ZAMAN CIZELGESI: her gun bir yatay bant; 00-24 ekseni; glukoz olcumleri renk kodlu nokta, yemekler karb gramiyla kucuk ikon, dozlar damla ikonu; bant sonunda gunun ort + TIR mini ozeti. Sayfa basina ~10 gun, aralik kadar sayfa.
- OLAYLAR SAYFASI: hipo olaylari (tarih, deger, 15 dk takip olcumu varsa), en yuksek 5 okuma, doz ozetleri (gunluk ort, basal/bolus dagilim mini bar).
- HAM TABLOLAR en sonda kompakt (mevcut tablolar sadelesir).
- Ust/alt bilgi: uygulama adi + sayfa no + "kayit defteri raporudur, tibbi degerlendirme degildir" notu (mevcut disclaimer dili).
- report.ts:224'teki th uppercase kaldirilir (Turkce guvenligi).

---

## FAZ C: OZEL TARIH ARALIGI (5.1)

- Insights pencere cipine "Ozel..." secenegi: takvimli baslangic-bitis secici; profil olusturmadan bugune sinirli; Pro'ya bagli (7 gun free kurali korunur).
- lib/insights.ts fonksiyonlari windowDays yerine {start,end} araligi alacak sekilde genellestirilir; 7/30/90 kisayollari ayni yoldan gecer (geriye uyum: mevcut cagrilar kirilmaz).
- PDF (Faz B) ve CSV disa aktarimda ayni secici; secilen aralik rapor kapaginda gorunur.

---

## FAZ D: EKRAN MIMARISI KALANLARI

### D.1 Enjeksiyon ekrani 3 segment (3.3)
Ust segment: KAYDET (form + secili site ozet cipi; mini harita onizleme, dokununca Faz A haritasi odak modunda) / HARITA (tam boy harita + rotasyon karti + legend) / GECMIS (FlatList sanal liste, gun basliklari, JournalItem kompakt kalibi). Segment gecisinde state korunur. Disclaimer yalniz KAYDET altinda tek satir.

### D.2 Settings hub (3.4)
Ana Settings HUB olur: Profil ve Hedefler / Bildirimler / Veri ve Disa Aktarim / Uygulama (dil, Spike, Pro, Widget rehberi) / Hakkinda ve Yasal. Her biri app/settings/ altinda ayri route; icon-plate satirlar. Bolum icerikleri TASINIR, davranis degismez (bildirim izin satiri, exact-alarm karti, Pro durumu dahil). Hub'da inline kalanlar: bildirim durumu ozeti + Pro durumu. Derin linkler (orn. notifications.ts route'lari, paywall'dan gelen yollar) yeni route'lara guncellenir.

### D.3 Gunluk akis (3.5 kalan)
Dashboard journal SectionList'e gecer: Bugun / Dun / tarih basliklari; 50'ser sayfalama (sona gelince yukle); filtre cipleri Tumu / Glukoz / Yemek / Enjeksiyon. Etiketler tek satir + sigmayan "+N" cipi (dokununca detay). JournalItem kompakt kalibi korunur.

### D.4 Form metin yogunlugu (3.6)
- Injection KAYDET formu: etiket+aciklama metinleri kaldirilir; site cipi + doz Stepper + tur iki buyuk ikon buton + tek satir not + etiket cipleri. Bir ekran boyuna sigar.
- Calculator: alt aciklama paragraflari (i) ikonlu tooltip'lere iner (tek ortak Tooltip bileseni); uyari kartlari tek satir ozet + acilir detay.
- add-food: ayni ilke (kisa placeholder'lar, aciklama cumleleri tooltip'e).

---

## FAZ E: KUCUK KALANLAR (R7 raporundaki acik kalanlar + R7 denetiminin buldugu eksikler)

R7 denetiminden gelen duzeltmeler:
- E.1 QuickAdd enjeksiyon parametresi OLU: `index.tsx:985` `compose:"1"` gonderiyor ama `app/(tabs)/injection.tsx` parametreyi hic okumuyor. injection ekrani `useLocalSearchParams` ile compose'u tuketsin: gelince form bolumune scroll + doz alanina odak (D.1 segment yapisinda KAYDET segmenti acilir).
- E.2 Zincirleme silmede undo kaybi: 6 sn icinde ikinci silme ilk toast'i eziyor, ilk kaydin undo'su kayboluyor. Cozum: pespese silmeler TEK toast'ta birikir ("2 kayit silindi" + tek undo tumunu geri getirir); lib/db/undo.ts snapshot listesi zaten bagimsiz, Feedback toast'ina birikim sayaci eklenir.
- E.3 Widget sayisi yerellesmedi: snapshot ham mgdl tasiyor, Android `toFixed(1)` (androidWidget.ts:48) ve iOS `String(format:"%.1f")` (LiveData.swift:60) NOKTA basiyor; tr/de widget "6.4" gosteriyor. Cozum: liveData snapshot'ina onceden formatlanmis `lastGlucoseDisplay` string alani ekle (TS tarafinda Intl ile uretilir); Swift/Kotlin bu stringi basar, sayi formatlamaz. Swift Codable'da alan OPTIONAL olsun (eski snapshot decode kirilmasin); Android'de fallback mevcut format.
- E.4 PDF tarihleri sabit DD.MM.YYYY (report.ts:38-47): Faz B yeniden yazimda tarihler de getActiveLang() uzerinden yerellesir. CSV tarihleri ISO kalir (siralanabilirlik icin BILINCLI; teslim raporunda bir cumleyle belgele).
- E.5 Kalan 9px mikro etiketler (11px'e): insights.tsx 393/473, emergency-contacts.tsx 509, index.tsx 654, food.tsx 294, RangeInput.tsx 216, Reveal.tsx 182/215/261.
- E.6 Kalan 0.6 placeholder alfalari (0.7'ye): food.tsx 243, emergency-contacts.tsx 340/525/541.

R7 raporunda zaten acik birakilanlar:
- E.7 Kalan Stepper baglantilari: settings/profile-setup/onboarding oran alanlari (carbRatio, ISF) Stepper'a baglanir (adimlar: oran 0.5, ISF 1 mgdl / 0.1 mmol).
- E.8 return-ile-sonraki-alan zinciri: cok alanli formlarda (add-food, profile-setup, settings hedef bolumu) returnKeyType="next" + ref zinciri.
- E.9 Kalan 19 uppercase noktasi lib/upper.ts'e baglanir (denetim sayimi): insights.tsx 79/395/475/583, calculator.tsx 117/697/772, food.tsx 296/322/368, Reveal.tsx 142/184/217/263, sources.tsx 102, emergency-contacts.tsx 511, StatCard.tsx 78, form.tsx 37, RangeInput.tsx 218. Bitiste grep ile SIFIR oldugunu kanitla (textTransform/uppercase class ile t() degeri basan yer kalmayacak).
- E.10 Tam kirpma supurmesi: FoodRow 65/79, StatCard 79/110, ui SegmentedStat 307/313, calculator yemek adlari, insights, ProfileSwitcher, ScreenHeader, profile-setup, emergency-contacts, sos noktalarina politika uygulanir (kullanici verisi 2 satir sarar, UI etiketi adjustsFontSizeToFit).
- E.11 Kalan a11y supurmesi: ProfileSwitcher (15 Pressable, 0 etiket) ve InjectionEditSheet (11 Pressable, 2 etiket) ikon kontrollerine accessibilityLabel + role.
- E.12 Expo route tipi: /widget-guide icin gecici `as Href` cast'i, route tipleri uretildikten sonra kaldirilabiliyorsa kaldir.

---

## TESLIM RAPORU
Faz faz yapilan + dosya listesi + davranis kaniti. Ozel olarak: schema v9 migration ozeti + migration.test v9 ciktisi; harita icin on/arka ekran goruntusu alinabilir durum tarifi; raporun sayfa yapisi ozeti; uppercase/kirpma supurmelerinin grep kanitlari; gate ciktilari; HUMAN gerektirenler (cihazda harita/rapor gorsel dogrulamasi, yeni site enum'unun cihaz testi).
