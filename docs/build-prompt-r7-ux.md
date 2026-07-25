# R7 BUILD PROMPT: UX VE ETKILESIM TURU (kullanici gercek cihazda kullandi, sonuc: yetersiz)

Sen Zerospike'in gelistiricisisin. R6/R6.1 gorsel iskeleti kurdu; kullanici uygulamayi GERCEK CIHAZDA kullandi ve etkilesim katmanini yetersiz buldu. R7'nin konusu goruntu degil KULLANIM: dokunma hissi, akis uzunlugu, bilgi yogunlugu, yerlilik, native yuzeyler. Asagidaki her madde cihazda tespit edilmis gercek sorundur ve dosya:satir kokleri verilmistir. Fazlari sirayla, tek oturumda bitir; sonda tek teslim raporu.

## 0. Degismez kurallar
- Notr regulasyon dili (uyarir/alarm/tani/tavsiye edilen doz yasak). Her yeni string 5 dil (tr/en/de/es/fr). Em-dash yok. app.json surumune dokunma.
- Gateler: `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts`, `npx tsx scripts/migration.test.ts` temiz.
- Mevcut Midnight Monitor token dili (THEME/GLUCOSE_RICH/rich bilesenler) korunur; bu tur reskin DEGIL, etkilesim turudur.
- "Zaten boyle" gerekcesi yasak. Her maddede davranis degisikligini kanitla.

---

## FAZ 1: KRITIK AKIS ONARIMLARI

### 1.1 Bildirim izni gercekten istensin ve sonucu gorunur olsun
Tespitler:
- `lib/services/notifications.ts:78` `if (!Device.isDevice) return false` ve tum govde try/catch ile sessiz false donuyor.
- `app/onboarding.tsx:213-216` `await requestNotificationPermission().catch(() => {}); next();` sonuc YOK SAYILIYOR; izin verilmese de verilmis gibi akiyor.
- Reddedilme durumunda tek telafi, settings'te master toggle ACIKKEN gorunen kart (`settings.tsx:632-648`); onboarding/profil tarafinda hicbir yol yok.
Yapilacaklar:
- Onboarding notify adimi sonucu UI'ya yansitsin: izin verildi ise kisa onay durumu; reddedildi ise ayni adimda notr bir "bildirimler kapali, istedigin zaman Ayarlar'dan acabilirsin" durumu + sistem ayarina giden buton. Akis ilerler ama YALAN soylemez.
- `requestNotificationPermission` donus tipini zenginlestir: "granted" | "denied" | "undetermined" | "unavailable". Sessiz catch kaldirilir, hata "unavailable" olarak raporlanir.
- Settings'te bildirim izni durumu master toggle'dan BAGIMSIZ her zaman gorunur bir satir olsun: durum + (reddedildiyse) sistem ayari butonu.

### 1.2 Bildirime dokununca dogru ekran acilsin (su an hicbir sey olmuyor)
Tespit: repo genelinde `addNotificationResponseReceivedListener` / `getLastNotificationResponseAsync` YOK; tokluk hatirlaticisina dokunan kullanici son kalinan ekrana dusuyor.
Yapilacaklar: her `scheduleNotificationAsync` content.data icine `route` bilgisi koy (postMeal → dashboard + GlucoseInputSheet post_meal_2h acik; basal → injection sekmesi; glucose → dashboard + sheet fasting; weekly → insights; lowFollowup → dashboard + sheet). `app/_layout.tsx`'te response listener + cold start icin `getLastNotificationResponseAsync` ile yonlendirme yap.

### 1.3 Toast sistemi bastan
Tespitler: `components/Feedback.tsx:331-347` toast `bottom:90` sabit, safe-area yok; tab bar (~83pt) ustune biniyor; govde `GlassCard` yani %5 opakli yuzey (`THEME.glass`), blur yok, okunmuyor.
Yapilacaklar:
- Toast USTTEN girsin: `top: insets.top + 8`, alttaki her seyden bagimsiz. Yuzey opak olsun: `THEME.bg.g2` tabanli solid koyu kart + ince accent kenar; metin THEME.ink; tur rengi (target/accent/low) sadece sol serit + ikon. Kontrast hedefi: arka plan ne olursa olsun okunur.
- Undo aksiyonlu toastlarda sure 6 sn, aksiyon butonu gercek buton gorunumunde (dolgulu hap).
- Ayni anda tek toast; yenisi geleni ustune yumusak degistirir.
- `bottom:90` sabiti ve tab bar cakismasi tamamen ortadan kalkar; dashboard alt CTA cubugu ile de cakisma kalmaz.

### 1.4 "Yemege basladim" gercek buton olsun
Tespit: `app/(tabs)/index.tsx:656-662` sadece cyan renkli DUZ METIN; countdown degeriyle ayni gorunuyor, buton oldugu anlasilmiyor.
Yapilacak: dolgulu/kenarli gercek bir hap buton (GradientCTA kucuk boy veya accent dolgulu Pressable, basili durumda scale/opacity geri bildirimi, hapticSelect). Sayac calisirken ayni yerde sayac + kucuk "iptal" ikincil aksiyonu.

### 1.5 Dashboard'da hesaplanip GOSTERILMEYEN veriler ekrana konsun
Tespit: `app/(tabs)/index.tsx` `logStreak` (:255), haftalik `weekAvg/weekTIR/weekSparkline/SegmentedStat` (:275-313) hesaplaniyor ama JSX'te hic yok; StatCard/Sparkline import edilip kullanilmiyor.
Yapilacak: hero halkasinin altina kompakt bir haftalik serit (SegmentedStat: ort. glukoz + TIR + streak, sparkline ile) ekle; ekrani kalabaliklastirmadan tek satir. Kullanilmayan hesap kalmasin.

### 1.6 Hizli ekleme
Tespit: `index.tsx:818-821` "+ addRecord" CTA'si SADECE glukoz sheet'i aciyor; yemek 4-5 dokunus, enjeksiyon sekme degistirmek zorunda.
Yapilacak: CTA bir secim sheet'i acsin: Glukoz / Yemek / Enjeksiyon (uc buyuk ikon karti). Glukoz mevcut sheet, Yemek food akisina, Enjeksiyon injection formuna (ilgili sekmeye parametreyle) goturur.

### 1.7 Spike: basarisiz istek hak yakmasin
Tespit: `app/spike.tsx:86-92` kota `askSpike`'tan ONCE dusuyor; hata olursa hak gitti, retry butonu yok.
Yapilacak: kota basarili yanitta dus (veya catch'te iade et); hatali baloncukta "Tekrar dene" aksiyonu.

### 1.8 Silmelere undo
Tespit: undo yalnizca calculator kaydinda var; dashboard glukoz/yemek/enjeksiyon silme (`index.tsx:503-515`), injection silme (`injection.tsx:166-176`), ozel yemek silme (`food.tsx:171-181`) undo'suz.
Yapilacak: silmelerde onay diyalogu yerine dogrudan sil + 6 sn undo'lu toast kalibi (1.3'teki yeni toast ile). Geri alinan kayit tum bagli satirlariyla doner (calculator yemegi ise enjeksiyon/sugar bagi dahil, mevcut deleteMealRecord mantiginin tersi).

---

## FAZ 2: GIRIS ETKILESIMLERI (klavye zorunlulugu bitsin)

### 2.1 RangeInput surukle destekli olsun
Tespit: `components/RangeInput.tsx` SVG bandi salt gorsel (:100-116), giris iki TextInput (:191-207); kullanici araligi elle suruklyemiyor.
Yapilacak: banda iki tutamac (thumb) ekle; Gesture Handler/PanResponder ile surukleme, adim: mgdl'de 5, mmol'de 0.1; surukleme TextInput degerlerini canli gunceller, TextInput yazimi tutamaclari oynatir. Tutamaclar 44pt dokunma alanli, surukleme sirasinda deger baloncugu + hafif haptic tik. Sinir disi zaten engelli (bounds korunur). Ayrica yalniz bir uc sinir disiysa yalniz o uc kirmizi olsun (ikisi birden degil).

### 2.2 Sayisal alanlara stepper
Yapilacak: ortak bir `Stepper` bileseni (- deger +, basili tutunca hizlanan tekrar, 44pt butonlar, klavyeyle de yazilabilir orta alan). Kullanim yerleri:
- Doz: `injection.tsx:346`, `InjectionEditSheet.tsx:242` (adim 0.5u; uzun basينca 1u).
- Karbonhidrat/porsiyon: `add-food.tsx:166-180`.
- Hedef/oran alanlari: `settings.tsx:565-607`, `profile-setup.tsx:287-319`, onboarding carbRatio/isf.
### 2.3 Calculator porsiyonu: slider + sayi birlikte
Tespit: `calculator.tsx:658-667` yalniz slider (max 500, adim 5); 237 g girilemiyor, 500 ustu yok.
Yapilacak: slider yaninda dokunulup yazilabilen sayi alani (stepper'li); slider yazileni izler, yazim slideri gecersiz kilmaz; ust sinir 1500 g, slider gorunur araligi 0-500 kalabilir (ustu yazimla).

### 2.4 Klavye ve format cilasi
- Ondalik girislerde yerel ondalik isareti kabul zaten var; EKRANA BASARKEN de yerel format kullan (bkz. Faz 6.3).
- Her sayisal alanda dogru keyboardType, return ile sonraki alana gecis, kaydirmada klavye kapanmasi (keyboardDismissMode).

---

## FAZ 3: EKRAN MIMARISI (tek ekranda her sey bitsin)

### 3.1 Onboarding layout dengesi
Tespit: `QuizStep.tsx:42` icerik konteyneri `flexGrow:1` + varsayilan flex-start; az secenekli adimlarda icerik ustte yigiliyor, orta bos kaliyor; buyuk baslik + buyuk alt buton araya bosluk birakiyor.
Yapilacaklar:
- QuizStep icerigini dikeyde dengele: baslik bloku ustte sabit, secenek grubu kalan alanda DIKEY ORTALI (`justifyContent:"center"` veya spacer'li), footer altta. Cok secenekli adimlar (diyabet tipi) scroll etmeye devam eder; az secenekliler ekrani doldurur.
- Secenek kartlarina gorsel agirlik: mevcut ikonlarin yaninda kisa aciklama satiri (orn. birim adiminda "Turkiye'de yaygin" gibi NOTR ipuclari degil, sadece teknik aciklama: "mg/dL: 70-180 gibi" / "mmol/L: 3.9-10.0 gibi").
- Hedef adiminda RangeInput'un yeni surukle hali kullanilir; klavye acilmadan tamamlanabilmeli.

### 3.2 Onboarding'de basal/bolus sorusu kaldirilsin
Tespit: `onboarding.tsx:469-483` 4 secenekli insulin sorusu; kullanici bu ayrimin sorulmasini istemiyor. Ayrimin tek kritik tuketicisi basal hatirlatici + bolus bolumleri (`lib/insulinMode.ts` haritasi denetimde cikarildi).
Yapilacaklar:
- Onboarding sorusu ikili olsun: "Insulin kullaniyor musun?" Evet → insulin_mode='both', Hayir → 'none'. carbRatio/isf/basal adimlari Evet'te akmaya devam eder.
- 4'lu ayrim SETTINGS'te kalir (`settings.tsx:436-447` mevcut secici korunur, hint metniyle). Boylece none/basal/bolus davranislari (sekme gizleme, IOB, calculator modu) aynen calisir; sadece onboarding sadelesir.
- Eski onboarding insulin_* secenek stringlerinden kullanilmayanlar temizlenir.

### 3.3 Enjeksiyon ekrani bolunsun
Tespit: `injection.tsx:225-480` tek scroll: harita + rotasyon + form + 100 kayitlik gecmis + disclaimer; 4-5 ekran boyu.
Yapilacak: ust segment (uc bolum): KAYDET (kucultulmus site secici ozetiyle form; harita ozet mini gorunum, dokununca tam harita), HARITA (tam boy isi haritasi + rotasyon karti + legend), GECMIS (FlatList sanal liste, gun basliklariyla). Segment gecisi state korur. Disclaimer yalniz KAYDET altinda kisa satir.

### 3.4 Settings hub'a donussun
Tespit: `settings.tsx` 1052 satir, 14 bolum tek scroll.
Yapilacak: ana Settings bir HUB olur: Profil ve Hedefler / Bildirimler / Veri ve Disa Aktarim / Uygulama (dil, Spike, Pro) / Hakkinda ve Yasal. Her biri ayri route (app/settings/*.tsx), icon-plate satirlarla acilir. Mevcut bolum icerikleri tasinir, davranis degismez. Sik kullanilan iki sey hub'da inline kalir: bildirim master toggle durumu ve Pro durumu.

### 3.5 Gunluk akis (journal) yeniden
Tespitler: 300 kayit tek duz FlatList (`index.tsx:107,703`), gun basligi yok; `JournalItem.tsx:58-84` etiketler flex-wrap ile ikinci satira takliyor; `:177,181` slate hex'leri token disi.
Yapilacaklar:
- Gun grubu basliklari (Bugun / Dun / tarih) ile SectionList'e gec; sayfalama: 50'ser yukle, sona gelince devam.
- Satirlar kompaktlassin: etiketler tek satirda, sigmayan "+2" cipine katlanir (dokununca detay). Ikinci satira sarkma biter.
- Meal/injection satirlarinda numberOfLines yerine iki satira kadar sarma (bkz. 6.4 politikasi).
- Slate hexleri THEME tokenlarina cevrilir.
- Filtre cipleri: Tumu / Glukoz / Yemek / Enjeksiyon.

### 3.6 Veri giris formlarindaki metin yogunlugu
Tespit: yemek ve enjeksiyon girisinde asiri metin; kullanici "inanilmaz fazla text" diyor.
Yapilacaklar (iki formda da ayni ilke):
- Etiket+input cifti yerine ikonlu kompakt alanlar; aciklama cumleleri kaldirilir, gerekirse (i) ikonuyla acilan tek tooltip'e tasinir.
- Injection formu: site ozeti tek cip ("Karin sol, N3"), doz stepper, tur iki buyuk ikon buton (gunduz/gece metaforu yok, bolus=catal-bicak, basal=ay ikonlari mevcut dil), not alani tek satir placeholder, etiketler cip dizisi. Form bir ekran boyuna sigar.
- Calculator: read-out kartlari korunur ama alt aciklama paragraflari (i) tooltip'lere iner; uyari kartlari tek satir ozet + acilir detay.

---

## FAZ 4: ISI HARITASI PROFESYONELLESME

Tespit: kullanici mevcut gorselligi "amator, basit, bolgeler eksik, noktalar kotu" buldu (`components/InjectionBodyMap.tsx`).
Yapilacaklar:
- Silueti profesyonel cizgiye tasi: tek parca kaba path yerine anatomik oranli, yumusak Bezier hatli, hafif 3D hissi veren katmanli SVG govde (govde dolgusu THEME uzeri cok hafif gradyan, dis hat ince ink cizgisi, omuz/bel/kalca kivrimlari belirgin). ON/ARKA gorunum toggle'i ekle.
- Bolge seti FITTER'a tam otursun: ON: karin sol-ust, karin sag-ust, karin sol-alt, karin sag-alt (gobek cevresi 2 cm bosluklu), uyluk sol, uyluk sag, kol sol, kol sag. ARKA: kalca sol-ust dis, kalca sag-ust dis, (istege bagli bel yanlari). Mevcut 8'lik enum genisler; schema'da site enum'una yeni degerler migration ile eklenir (eski kayitlar aynen kalir, karin L/R eski kayitlari karin ust ceyreklerine map'lenmez, oldugu gibi genel karin L/R olarak gosterilir).
- Nokta gorselligi: her bolgede 2x2 nokta izgarasi kalir ama noktalar buyur (min 14px gorsel cap), dolgu yogunluk rengi + ince halka; secili nokta parlayan halka + hafif olcek; en eski nokta kesikli halka + "onerilmez dili olmadan" legend. Bolge zoom'u tam ekran yerine haritanin ustune buyuyen odak karti olarak acilir (mevcut Modal yaklasimi cilalanir: arka plan blur/dim, 4 nokta buyuk kartlar, bolge adi basligi).
- Isi rengi olcegi: yogunluk düsuk→yuksek icin token tabanli tek renk skalasi (accent→high), legend'da mini gradyan cubugu.
- Erisilebilirlik: her bolge/nokta accessibilityLabel ("Karin sol ust, nokta 3, son kullanim 2 gun once").

---

## FAZ 5: RAPOR VE ARALIKLAR

### 5.1 Ozel tarih araligi
Tespit: pencereler sabit [7,30,90] (`lib/insights.ts:88`), rapor da ayni sabitten seciyor (`settings.tsx:300-309`); ozel aralik yok.
Yapilacaklar: Insights basligindaki pencere cipine "Ozel..." secenegi: baslangic-bitis tarih secici (takvim), profil olusturma tarihinden bugune sinirli. Secim insights hesaplarina `windowDays` yerine tarih araligi olarak iner (lib/insights.ts fonksiyonlari aralik parametresine gecirilir; 7/30/90 kisayollari ayni yoldan gecer). PDF ve CSV disa aktarimda ayni secici kullanilir. Ozel aralik Pro'ya baglanir (7 gun free kurali korunur).

### 5.2 Doktor raporu gorsel bastan tasarim
Tespit: raporda AGP SVG'si var (`report.ts:84-119`) ama geri kalani duz tablolar; kullanici "facia" diyor.
Yapilacaklar (`lib/services/report.ts` bastan, print CSS ile cok sayfali):
- Kapak/ozet sayfasi: hasta adi + aralik + uretim tarihi; KPI kartlari (ort. glukoz, GMI, TIR %, SD/CV, hipo sayisi) renk kodlu kutular; TIR yatay stack bar (veryLow/low/target/high/veryHigh dilimleri, GLUCOSE renkleriyle); AGP grafigi buyuk boy.
- GUNLUK ZAMAN CIZELGESI sayfalari: her gun bir satir bandi; 00-24 ekseninde glukoz noktalari (renk kodlu), yemek ikonu (karb gram etiketli) ve doz damlasi ikonlari ayni bantta; gunun ort/TIR mini ozeti satir sonunda. (mySugr paritesi, R5'te ertelenen "wow".)
- Olay sayfasi: hipo olaylari listesi (tarih, deger, takip olcumu), en yuksek 5 okuma, doz gunluk ortalama/bazal-bolus dagilimi mini bar.
- Ham tablolar en sonda kompakt; tum sayilar yerel formatta (6.3), tum basliklar i18n, uppercase yok (report.ts:224 th uppercase kaldir, Turkce sorunsuz).
- Sayfa basligi/altligi: uygulama adi + sayfa no + "kayit defteri raporudur, tibbi degerlendirme degildir" notu.

### 5.3 CSV yerellesme
Tespit: `export.ts` virgul ayracli + nokta ondalik; tr/de Excel tek kolona yapistiriyor.
Yapilacak: ondalik virgullu dillerde `;` ayrac + virgul ondalik; dosya basina `sep=;` satiri. Ingilizce mevcut format kalir.

---

## FAZ 6: YERLILESTIRME VE TIPOGRAFI

### 6.1 Turkce yazim taramasi
Tespit: `tr.ts:115` `lastReading: "Son olcum"` DIAKRITIKSIZ yazilmis; dogru form ayni dosyada 734'te var. Font sucu degil, veri hatasi.
Yapilacak: tr.ts'i BASTAN SONA diakritik taramasindan gecir (olcum/olc, sekar/seker, gunluk, buyuk-I sorunlari); bulunan her hatayi duzelt ve raporda say. Diger 4 dilde de bariz yazim hatasi taramasi (de umlaut, es/fr aksan).

### 6.2 Uppercase guvenligi
Tespit: tum buyuk harf kullanimlari `textTransform:"uppercase"`; TR'de 'i'→'I' (noktasiz olmasi gereken) riski platforma bagli.
Yapilacak: uppercase gereken etiketler icin kucuk bir yardimci: gorunen metni `value.toLocaleUpperCase(i18n.language)` ile uret ve textTransform kaldir (liste denetimde: index 605/678, injection 309/413, food 290/316/362, insights 79/395/475/583, calculator 116/678/753, StatCard 78, form 37, ui 106/304, RangeInput 91, Reveal 142/184/217/263, sources 102, emergency-contacts 511). Tek yardimca baglanir ki gelecekte tutarli kalsin.

### 6.3 Sayi/tarih yerellestirme
Tespit: `lib/format.ts:33` ve `lib/glucose.ts:18` hep nokta ondalik; `format.ts:29` sabit DD.MM.YYYY; `formatTime` sabit 24s. Yalniz paywall Intl kullaniyor.
Yapilacak: format katmanini `Intl.NumberFormat` / `toLocaleDateString` / `toLocaleTimeString` (i18n.language) uzerine tasi; glukoz, karb, doz, tarih, saat TUM yuzeylerde (ekran, widget snapshot etiket degerleri, PDF, CSV 5.3 kurali) yerel formatta.

### 6.4 Kirpma politikasi
Tespit: 20+ yerde numberOfLines={1} "..." uretiyor (liste denetim raporunda; JournalItem 159-195, FoodRow 65/79, StatCard 79/110, ui 299/305, injection 445, calculator 604/623, insights 910...).
Yapilacak politika: kullanici verisi tasiyan metin (yemek adi, not, site ozeti) 2 satira kadar SARAR; sabit UI etiketi tek satirda `adjustsFontSizeToFit` (minimumFontScale 0.85) ile SIGAR; "..." yalniz 2 satiri da asan kullanici metninde kalir. Tum listelenen noktalara uygula.

### 6.5 Marka adlari ek almasin
Tespit: tr'de "Apple Saglik'ten / 'tan / Health'ten" karisik ekli kullanim (tr.ts 132/136/139/400/433/554/559).
Yapilacak: cumleleri ek gerektirmeyecek sekilde yeniden kur ("Apple Saglik uzerinden otomatik senkron", "Kaynak: Apple Saglik"); insights.healthTitle uppercase basliktan cikar veya ek olmadan kullan. 5 dilde marka adi sabit "Apple Health" / iOS Turkce'de "Apple Saglik" tutarli secilir (tek karar, her yerde ayni).

---

## FAZ 7: NATIVE YUZEYLER (widget gorunmuyor sorunu)

### 7.1 Kilit ekrani widget aileleri
Tespit: `targets/widget/index.swift:133` yalniz `.systemSmall,.systemMedium`; accessory aileleri YOK, kilit ekraninda widget cikmamasi normal.
Yapilacak: `.accessoryRectangular` (son glukoz + kalan sure) ve `.accessoryInline` (kisa metin) aileleri eklensin; iOS 16 kontrolu mevcut kaliba uyar.

### 7.2 Widget rengi profil araligina uysun
Tespit: `lib/services/androidWidget.ts:28-35` sabit 70/180 siniflamasi; uygulama ile widget farkli renk soyluyor. iOS Swift tarafi da ayni sabitleri kullaniyorsa esitle.
Yapilacak: LiveData snapshot'ina profil bandi (hypo, min, max, veryHigh sabiti) eklenir; Android ve iOS widget renklendirmesi bu banda gore yapilir.

### 7.3 Uygulama ici widget rehberi
Tespit: kullaniciya widget/Live Activity'nin varligini soyleyen TEK satir yok; kesif sifir.
Yapilacak: Settings > Uygulama altina "Widget'lar ve Kilit Ekrani" sayfasi: ana ekran widget'i nasil eklenir (platforma gore adimlar), kilit ekrani widget'i, Live Activity'nin ne zaman gorunecegi ("yemege basladim ile sayac kilit ekranina gelir"). Ilk tokluk sayaci kurulumunda bir kez, kapatilabilir bir ipucu karti dashboard'da gosterilir.

### 7.4 Live Activity dogrulama
Tespit: aktivite yalniz tokluk sayaci kurulunca basliyor (`notifications.ts:362`); izin/bildirim reddi durumunda sessiz kaybolabiliyor.
Yapilacak: `areActivitiesEnabled` false ise (kullanici Live Activity'yi kapatmis) widget rehberi sayfasinda durum satiri goster; sayac kurulduğunda aktivite baslamadiysa sessiz kal (hata gosterme) ama rehber sayfasindaki durum dogru olsun.

---

## FAZ 8: ERISILEBILIRLIK, PERFORMANS, TUTARLILIK

- 44pt dokunma: Spike gonder butonu (`spike.tsx:300-315`), Segmented pilleri (`ui.tsx:173`), periyot pilleri (`GlucoseInputSheet.tsx:337-347`) min 44pt yukseklige/hitSlop'a cekilir (HIT_TARGET tokeni kullan).
- Ikon butonlara accessibilityLabel + role: calculator kapat/cop (`calculator.tsx:601,922`), sheet kapat (`GlucoseInputSheet.tsx:251`), ProfileSwitcher ve InjectionEditSheet'teki tum ikonlu Pressable'lar.
- Placeholder alfa >=0.7, 9px mikro etiketler >=11px (`calculator.tsx:113-120,697`, `injection.tsx:353`, `GlucoseInputSheet.tsx:274`).
- Enjeksiyon gecmisi FlatList'e (3.3 ile birlikte geliyor); baska map-in-ScrollView kaldiysa cevir.
- Periyot pillerine hapticSelect (`GlucoseInputSheet.tsx:332`).
- Haftalik gun secici yerel hafta baslangicina gore siralansin (`settings.tsx:798`, tr/de/es/fr Pazartesi).
- JournalItem slate hexleri THEME'e (3.5'te geliyor).

---

## TESLIM RAPORU
Faz faz: yapilan, dosya listesi, davranis kaniti (orn. "bildirime dokununca glukoz sheet aciliyor"). Ayrica: tr diakritik taramasinda duzeltilen anahtar sayisi ve listesi; numberOfLines politikasi uygulanan nokta sayisi; yeni i18n anahtar sayisi; gate ciktilari; HUMAN gerektirenler (yeni site enum migration'i cihaz testi, widget ailelerinin cihazda gorunmesi, Live Activity cihaz dogrulamasi).
