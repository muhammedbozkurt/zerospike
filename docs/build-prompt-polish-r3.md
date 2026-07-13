# zerospike R3 cila turu (2026-07-10, cihaz bulgulari)

Sen zerospike uzerinde calisan gelistirme session'isin. Bu dosya sozlesmendir: maddeleri
sirayla uygula, madde basina commit, onay bekleme.

## Kurallar

- main dalinda calis.
- Statik kapi HER commit'te: `npm run typecheck` (tsc + i18n-check birlikte).
- Em dash (U+2014) hicbir yerde.
- REGULASYON DILI (ihlal edilemez): "uyarir / alarm / tani / tedavi / onerilen doz" yasak.
  Gunluk, takip, hatirlatici dili. Sayilar kullanicinin kendi girdiklerinin aritmetigidir.
- i18n: lib/i18n/locales/tr.ts SEMA KAYNAGI; yeni anahtar once oraya, sonra 4 dile. Dogal
  ceviri, TR diakritikleri dogru.
- Android'de Health Connect YOK, geri eklenmez.
- Expo SDK 57: docs.expo.dev/versions/v57.0.0 dogrula.

---

## 11.1 KOK NEDEN: kok'e bagli RN Modal geri bildirimleri, modal ekranlarin uzerinde acilamiyor

Bu TEK hata dort ayri cihaz belirtisini aciklıyor. Once bunu duzelt, digerleri buna bagli.

Mekanizma (hub, koda karsi dogrulandi):
- components/Feedback.tsx: `confirm` (:148) ve `actionSheet` (:213) birer RN `<Modal>`;
  FeedbackProvider KOK'te mount (app/_layout.tsx:155).
- app/_layout.tsx'te scan `fullScreenModal` (:111), calculator (:123), add-food (:127),
  sos (:115), emergency-contacts (:119), paywall/downsell/winback hepsi `presentation: "modal"`.
- iOS'ta RN `<Modal>` kendi view controller'ini KOK VC'den sunar. Kok VC zaten bir modal
  ekran sunuyorsa ikinci sunum GERCEKLESMEZ; Modal'in `visible` state'i true kalir.
  Ust ekran kapaninca bekleyen Modal ANIDEN sunulur ve uzerinde kimse kalmadigi icin
  dokunuslari yutar: uygulama donmus gorunur, restart gerekir.

Bunun urettigi belirtiler (kullanici birebir boyle yasadi):
- Barkod bulunamadi diyalogu tarayici EKRANINDAN CIKINCA beliriyor (scan.tsx:38 confirm,
  scan fullScreenModal'in altinda bekliyor).
- calculator'daki "Fotoğraf ekle" butonuna basinca HICBIR SEY OLMUYOR (calculator.tsx:136
  actionSheet, calculator modalinin altinda acilamiyor) ve `sheet` state'i asili kaliyor.
- add-food'da kaydet sonrasi modal kapanmiyor, X calismiyor, restart gerekiyor.
- calculator'da "Öğünü kaydet" sonrasi uygulama kilitleniyor; restart sonrasi ogun
  kontrol panelinde GORUNUYOR (kayit basarili, kilitlenen yalniz UI: asili Modal).

Fix (mimari, kardes uygulama zerogram'da ayni sinif icin ayni cozum uygulanacak):
- FeedbackProvider yalniz DURUMU tutsun (toast/confirm/actionSheet state + api).
- Yeni `<FeedbackHost />` bileseni durumu okuyup gorseli render etsin ve RN `<Modal>`
  KULLANMASIN: `position: "absolute"`, inset 0, uygun zIndex ile mutlak overlay + scrim.
  Boylece ic ice/modal-ustu sunum sorunu tamamen ortadan kalkar.
- Host'lar bir yigin olarak kaydolsun; YALNIZ en son kaydolan host render etsin. Kok
  layout bir host render eder; `presentation: "modal"` / `fullScreenModal` olan HER ekran
  (scan, calculator, add-food, sos, emergency-contacts, paywall, downsell, winback,
  profile-setup) kendi agacinin sonunda bir `<FeedbackHost />` render eder. Ekran
  kapaninca host cikar, kok host'a geri donulur.
- Toast da ayni host'tan render edilsin (su an kokteki absolute View modal ekranlarin
  altinda kaliyor).
- Ekran degisirken (router.back/replace) asili confirm/actionSheet state'i TEMIZLENSIN
  (host unmount olurken pending promise'i iptal/resolve et; asili state hicbir kosulda
  bir sonraki ekrana sizmasin).
- typecheck + host-yigini secim mantigi icin saf fonksiyon (en son kaydolan kazanir).
- Commit: `fix(ui): feedback overlays render above modal screens (no root RN Modal)`
- QA: scan'de barkod bulunamadi diyalogu KAMERA EKRANININ USTUNDE cikiyor; calculator'da
  "Fotoğraf ekle" hemen action sheet aciyor; add-food kaydet -> toast + modal kapaniyor;
  calculator "Öğünü kaydet" -> kapaniyor, donma yok, restart gerekmiyor.

---

## 11.2 Barkod hicbir urunu tanimiyor

Teshis: `getFoodByBarcode` (lib/db/foods.ts:141) YALNIZ yerel SQLite `foods` tablosuna
bakiyor ve tohum verisinde (lib/db/seed.ts, 562 yemek) HIC BARKOD YOK (grep: 0). Yani
kullanicinin kendi eklemedigi hicbir barkod asla eslesmez; ozellik fiilen olu.

Fix: cevrimici arama + yerel onbellek.
- Open Food Facts (ucretsiz, anahtar gerekmez) urun uc noktasi ile barkod sorgusu.
  Surumu/uc noktayi dokumantasyondan dogrula; makul timeout (orn. 5 sn) + iptal.
  Istekte YALNIZ barkod gider; kullanici verisi gitmez. User-Agent basligi ver
  (OFF politikasi: uygulama adi + iletisim).
- Donen alanlardan yalnizca ihtiyacimiz olani al: urun adi, marka,
  carbohydrates_100g (yoksa urun kullanilamaz), varsa glisemik veri YOK (GI tahmini
  YAPMA; GI alanini bos/varsayilan birak, kullanici duzenler), porsiyon.
  Karbonhidrat degeri yoksa "bulunamadi" akisina dus.
- Basarili sonuc yerel `foods` tablosuna KAYDEDILIR (barcode ile), boylece bir dahaki
  taramada cevrimdisi calisir. Kaynak alani (orn. `source: "off"`) eklemek istersen
  migration'i guvenli yap.
- Ag yoksa / zaman asimi / bulunamadi: mevcut "yeni yemek olarak ekle" akisi (artik
  11.1 sayesinde kamera ekraninin ustunde) devreye girer, barkod on-doldurulur.
- Dil: notr, "tahmini besin degeri, tibbi referans degildir" cercevesi korunur.
  Yeni metinler 5 dilde.
- Sonuc ekranina veri kaynagini durustce yaz (orn. "Open Food Facts", 5 dil).
- Commit: `feat(scan): online barcode lookup with local cache (Open Food Facts)`
- QA: gercek bir urun barkodu tara: urun adi + karbonhidrat geliyor; ayni barkodu ucak
  modunda tekrar tara: onbellekten geliyor; bilinmeyen barkod: ekleme akisi aciliyor.

---

## 11.3 Diyalog butonlarindaki metin tasiyor (responsive degil)

Teshis: components/Feedback.tsx confirm butonlari `flex-row gap-3` icinde iki `flex-1`
Pressable; icteki `<Text>`'lerde `numberOfLines` / `adjustsFontSizeToFit` YOK. Uzun
etiketler ("Yeni Yemek Olarak Kaydet", DE/FR karsiliklari) alt satira kayiyor.

Fix:
- Buton metinlerine `numberOfLines={1}` + `adjustsFontSizeToFit` + makul
  `minimumFontScale` (orn. 0.85), yatay padding'i biraz kis.
- Etiketlerden biri belirgin sekilde uzunsa (karakter esigi) butonlari DIKEY yigina
  gecir (birincil ustte, iptal altta): dar cihazlarda garantili okunur.
- Ayni iyilestirmeyi actionSheet secenek satirlarina uygula.
- 5 dilde en uzun etiketlerle gozle dogrula (DE/FR).
- Commit: `fix(ui): dialog and sheet labels never wrap or clip`

---

## 11.4 Insights gorsel olarak cok zayif (grafik yok)

Teshis: app/insights.tsx (703 satir) yalniz sayi kartlari + tek bir zaman-icinde-aralik
seridi (:372) ve saatlik dilimlerin METIN listesi (:476) gosteriyor. Grafik yok.
Kaynak hazir: `react-native-svg` (15.15.4) bagimlilikta var; lib/services/report.ts
`buildAgpSvg` (:60) mantigi (medyan + IQR bantlari, 70-180 hedef bandi) referans alinabilir.

Fix (regulasyon-notr, yorum yok, yalniz kullanicinin kendi verisi):
- Bilesenleri components/charts/ altina yaz (saf, veri alan, tema tokenli):
  1. Gunluk profil (AGP-benzeri) alan grafigi: saat ekseninde medyan cizgisi + IQR
     bandi + 70-180 hedef bandi golgesi. report.ts'teki matematigi paylas (ortak saf
     modul; PDF ile ekran ayni sayilari kullansin).
  2. Zaman-icinde-aralik yigili seridi (mevcut) + kucuk bir donut/pasta alternatifi
     yerine yigili bar yeterli, ama ETIKETLI ve renk-korlugune uygun olsun.
  3. Trend cizgisi: secili pencerede gunluk ortalama (nokta + cizgi), onceki pencereye
     gore delta cipi (notr: "+8 mg/dL", yorum yok).
  4. Saatlik oruntu: metin listesi yerine bar grafigi (mevcut hourly verisi).
- Erisilebilirlik: her grafigin altinda kisa metinsel ozet (ekran okuyucu icin) ve
  minimum-veri esiginin altinda "daha fazla olcum eklendikce dolacak" notu (notr).
- Free/Pro citi degismez: 7 gunluk pencere free, 30/90 + AGP/percentile Pro (mevcut
  gating aynen korunur). Kilitli grafiklerde blur/teaser mevcut deseni kullan.
- Performans: buyuk veri setinde grafik hesaplarini useMemo ile; 90 gun icin de akici.
- Commit: `feat(insights): real charts (daily profile, trend, hourly) with neutral labels`
- QA: 7/30/90 gun pencerelerinde grafikler dogru ciziliyor; az veride bos-durum notu;
  mg/dL ve mmol/L birimlerinde eksen etiketleri dogru; Pro citi bozulmamis.

---

## 11.5 Rehberden COKLU kisi ekleme

Teshis: app/emergency-contacts.tsx uygulama ici secici tek dokunusta TEK numara ekliyor
(pickNumber -> saveContact -> secici kapanir). Kullanici birden fazla kisiyi tek tek
eklemek zorunda kaliyor.

Fix:
- Secici listesinde her numara satirinda secim kutusu (checkbox); birden fazla numara
  secilebilir (ayni kisiden birden fazla numara da secilebilir).
- Ust barda "N seçildi" sayaci + "Ekle" birincil butonu; secici acikken arama calismaya
  devam eder, secim korunur.
- "Ekle"ye basinca hepsi TEK seferde normalize edilip (normalizePhoneWithRegion) eklenir.
  Normalize edilemeyen numaralar eklenmez; sonunda kisa bir ozet toast'i
  ("3 kişi eklendi, 1 numara geçersiz", 5 dil).
- Zaten kayitli numaralar (E.164 esitligi) tekrar eklenmez, listede "ekli" isaretiyle
  gorunur.
- Tek dokunusla ekleme aliskanligini bozma: secim yapilmadan bir satira uzun basmak
  yerine, secim kutusu her zaman gorunur olsun; en az bir secim varsa "Ekle" aktif.
- Commit: `feat(emergency): multi-select contacts from the in-app picker`
- QA: 3 kisi sec, tek seferde eklendiler; mukerrer numara eklenmiyor; gecersiz numara
  ozet mesajinda bildiriliyor.

---

## 11.6 SOS ekraninda "acil durum kişisi ekle" kisayolu kayboluyor

Teshis: app/sos.tsx:163 `contacts.length === 0` iken buyuk ekleme karti gosteriliyor;
kisi eklendikten sonra ekleme yolu EKRANDAN TAMAMEN KALKIYOR. Kullanici ikinci kisiyi
buradan ekleyemiyor.

Fix (kullanicinin istedigi gibi):
- Kisi YOKKEN: mevcut buyuk kart (aciklama + belirgin buton) aynen kalir.
- Kisi VARKEN: kisi listesinin altinda kompakt tek satir bir buton
  ("+ Kişi ekle / düzenle", ikonlu, ghost stil) HER ZAMAN gorunur, /emergency-contacts'a
  gider. Odakta tazeleme (useFocusEffect) zaten var, donuste liste guncel gelir.
- Metin 5 dilde, notr.
- Commit: `fix(sos): always offer a way to add or edit emergency contacts`

---

## 11.7 Klavye denetimi (tum giris yuzeyleri)

Durum: KeyboardAvoidingView su dosyalarda VAR: add-food, profile-setup, pens, calculator,
onboarding, emergency-contacts, GlucoseInputSheet. Yine de kullanici klavyenin girisin
uzerine tastigini bildiriyor: muhtemelen `keyboardVerticalOffset` modal ekranlarda yanlis
ve/veya ic ScrollView yok / `keyboardShouldPersistTaps` eksik.

Fix (denetle ve tutarli hale getir, HER giris yuzeyi):
- `behavior`: iOS "padding", Android "height"; modal olarak sunulan ekranlarda
  `keyboardVerticalOffset` degerini gercek header/inset yuksekligiyle hesapla (0 birakma).
- Her formda kaydirilabilir bir kap + `keyboardShouldPersistTaps="handled"` +
  yeterli alt bosluk (klavye yuksekligi kadar degil, aksiyon satiri gorunur kalacak sekilde).
- Odaklanan input'un gorunur kalmasi icin iOS'ta `automaticallyAdjustKeyboardInsets`
  (SDK 57 RN surumunde varligini dogrula) veya odakta scrollTo.
- Kaydet/iptal aksiyon satiri klavye acikken erisilebilir olsun.
- Cihazda kucuk bir telefonda dogrula: add-food (isim/karb/GI/porsiyon/not), calculator
  (doz, not), emergency-contacts (isim/telefon), pens, profile-setup, GlucoseInputSheet.
  Hangi ekranlarda ne degistigini raporla.
- Commit: `fix(forms): keyboard never covers the focused input on any screen`

---

## Bitis raporu + cihaz QA checklist (dosyanin sonuna yaz)

- 11.1'in dogrulanmasi kritik: hicbir akista "restart gerekti" kalmamali. Raporda hangi
  ekranlarin kendi FeedbackHost'unu mount ettigini listele.
- QA checklist en az: barkod (bulunan/bulunmayan/cevrimdisi), fotograf ekle, ogun kaydet,
  yeni yemek kaydet, coklu kisi ekleme, SOS kisayolu (kisi varken/yokken), insights
  grafikleri (7/30/90, iki birim), klavye (tum formlar), diyalog butonlarinda tasma yok.

---

# BITIS RAPORU (2026-07-10)

Yedi madde de uygulandi, madde basina bir commit. Her commit'te `npm run typecheck`
(tsc + i18n-check) yesil. Tum calisma `main` dalinda.

| Commit | Madde |
| --- | --- |
| `d357a67` | 11.1 feedback overlay'leri modal ekranlarin ustunde |
| `256ce4c` | 11.2 cevrimici barkod + yerel onbellek |
| `1f7a439` | 11.3 diyalog ve sheet etiketleri tasmiyor |
| `936b63e` | 11.4 gercek grafikler |
| `1c99d4d` | 11.5 rehberden coklu kisi ekleme |
| `533c38e` | 11.6 SOS kisi ekle/duzenle kisayolu |
| `1726c89` | (ek) 11.5'te birakilmis NUL bayti temizligi |
| `f1ed80c` | 11.7 klavye denetimi |
| `87e90ae` | (ek) calculator loading dalinda da host, review sonrasi |

---

## 11.1 Kok neden: dogrulama

Teshis koda karsi dogrulandi ve aynen cikti: `FeedbackProvider` kokte iki RN `<Modal>`
mount ediyordu. iOS'ta `<Modal>` kok view controller'dan sunulur; kok VC zaten bir modal
ekran sunuyorsa ikinci sunum sessizce reddedilir, `visible` true kalir, ust ekran
kapaninca beklemis Modal aniden sunulur ve dokunuslari yutar.

**Yeni mimari.** Provider yalnizca durum tutar. Yeni `<FeedbackHost />` toast, confirm ve
actionSheet'i `position: absolute` + scrim ile, icinde bulundugu view controller'in
agacinda cizer. Host'lar bir yigina kaydolur, **yalnizca en son kaydolan cizer**.
Host unmount olurken sahibi oldugu bekleyen confirm `false` ile resolve edilir ve
action sheet kapatilir, boylece asili durum bir sonraki ekrana sizmaz.

**FeedbackHost mount eden yerler (13).** Kok layout, ve `presentation: "modal"` /
`fullScreenModal` olan **her** ekran:

| Yer | Neden |
| --- | --- |
| `app/_layout.tsx` | tabs + modal olmayan tum rotalar (onboarding dahil) |
| `app/scan.tsx` | `fullScreenModal`, confirm kullaniyor. Host her dalda (izin, hata, kamera) |
| `app/calculator.tsx` | actionSheet. Host hem loading hem yuklenmis dalda |
| `app/add-food.tsx` | toast |
| `app/emergency-contacts.tsx` | toast |
| `app/pens.tsx` | confirm |
| `app/paywall.tsx` | toast |
| `app/downsell.tsx` | toast |
| `app/winback.tsx` | toast |
| `app/sos.tsx` | feedback cagirmiyor, ama modal; ustune acilan bir sey olursa hazir |
| `app/profile-setup.tsx` | ayni |
| `app/sources.tsx` | ayni |
| `app/injection-guide.tsx` | ayni |

Sonuc: kokteki RN `<Modal>`'lardan ikisi de kaldirildi. `<Modal>`'in bedava verdigi iki
sey elle geri kondu: Android donanim geri tusu overlay'i kapatir (rotayi pop etmez), ve
action sheet alt guvenli alani boyar.

**Neden LanguageChip / GlucoseInputSheet / ProfileSwitcher hala `<Modal>`:** bunlar kokte
degil, ait olduklari ekranin agacinda mount oluyorlar. `<Modal>` en yakin ata view
controller'dan sunar; sunulan bir VC kendisi sunum yapabilir. Ayni hata sinifi degil.

**Saf fonksiyon + test.** Host secim mantigi `lib/feedback.ts` (`activeHostId`, `pushHost`,
`popHost`), `scripts/feedback.test.ts` icinde 10 iddia ile kilitlendi. Kritik senaryo:
`router.replace` yeni ekrani eskisi unmount olmadan mount eder, yani ayrilan host tepede
degildir; onu cikarmak cizen host'u bozmamali.

---

## 11.2 Barkod

Endpoint canli API'ye karsi dogrulandi (docs + gercek istek):
`GET https://world.openfoodfacts.org/api/v3/product/{barkod}.json?fields=...`

Uctan uca calistirildi: `3017624010701` (Nutella) urun adi + marka + `carbohydrates_100g`
57.5 dondu; `5449000000996` (Coca-Cola) `serving_quantity` 330 ile geldi; `0000000000000`
404 verdi; DNS hatasi ve 1 ms timeout ikisi de `unreachable`'a cozuldu, exception atmadi.

- **Gizlilik:** istekte yalnizca barkod gider. QR ve Code39 icerikleri urun barkodu
  degildir ve cihazdan **hic cikmaz** (`isProductBarcode`, yalnizca 6-14 haneli sayi).
- **User-Agent:** `zerospike/<versiyon> (https://greeneyeapp.com/zerospike/support)`.
- **GI tahmini YOK.** OFF'ta glisemik indeks yok; uydurmuyoruz. GI/GL sifir kalir ve
  kart "GI 0" yazmak yerine satiri gizler (olculmus sifir gibi okunurdu). Doz
  matematigini etkilemez (`lib/insulin.ts` GI kullanmiyor, kontrol edildi).
- **Onbellek:** sonuc `foods` tablosuna barkodla yazilir, `is_custom = 0` ve
  `source = 'off'`. Taranan urun kullanicinin 10 ozel yemek hakkindan **yemez**.
  Yeni `foods.source` kolonu icin sema v6 migration'i eklendi ve **eski adimlarin
  onune** alindi, cunku `seedFoods()` artik bu kolonu okuyor ve v1 -> v2 adimi yeniden
  tohumluyor.
- **Kaynak durustce yazili:** calculator yemek kartinda "Veri kaynagi: Open Food Facts" +
  "Besin degerleri tahminidir, tibbi referans degildir" (5 dil).
- **Parse sinir katmani** ayri saf modul (`lib/services/offParse.ts`): ucuncu tarafin
  JSON'u burada insulin tahminine giren bir karbonhidrat sayisina donusuyor. Isimsiz
  urunu, eksik/sayisal olmayan karbonhidrati ve fiziksel olarak imkansiz degeri
  (100 g'da >100 g) reddediyor. `scripts/offParse.test.ts`, 28 iddia.

---

## 11.4 Grafikler

- **Gunluk profil (AGP):** medyan cizgisi + %25-75 bandi + 70-180 hedef bandi.
  Geometri `lib/agpChart.ts`'e tasindi ve **PDF raporu da artik ayni modulu kullaniyor**,
  yani ekrandaki grafik ile doktora goturulen grafik ayni sayilardan cizilir. Refactor'un
  ciktiyi degistirmedigi 6 girdi sinifinda (yogun, seyrek, tek saat, kirpilmis, esik alti,
  bant yok) byte duzeyinde karsilastirilarak dogrulandi.
- **Trend:** pencere icinde olcum girilen her gunun ortalamasi. Olcumsuz gunler sifir
  degil, **bosluk**. Yeni saf `dailyAverages()` takvim gunune gore kovalar, sabit 24 saatlik
  bloklara gore degil. 6 saat diliminde (UTC+14, UTC-11, +12:45 Chatham, +10:30 Lord Howe
  dahil) 400 ardisik gun taranarak DST gecislerinde gun kaymadigi dogrulandi.
- **Time in range:** her segment kendi yuzdesini hem cubugun uzerinde hem lejantta
  tasiyor, yani grafik ucrengi ayirt etmeye bagli degil. Dusuk artik gul degil, uygulamanin
  hipo icin ayirdigi **soguk mavi** (`lib/glucose.ts`): kirmizi-yesil en cok karisan cifttir
  ve bir hiponun yuksek gibi okunmasi bu uygulamanin yapabilecegi en tehlikeli karisiklik.
  Etiketler her uc dolguda da siyaha yakin: kontrast 5.4:1 / 7.8:1 / 9.3:1 (beyaz mavide
  3.7:1 ile AA'yi geciremiyordu).
- **Saatlik:** metin listesi yerine hedef bandina karsi cubuklar. Olcumu olmayan dilim
  "neredeyse sifir" gibi okunan bir gudukle degil, **kesikli bos kanal + tire** ile
  gosteriliyor.
- **Erisilebilirlik:** her grafigin altinda ne gosterdigini kelimelerle soyleyen bir alt
  yazi var; SVG erisilebilirlikten gizlendi, ekran okuyucu alt yaziyi okuyor.
- **Az veri:** minimum ornegin altinda ("daha fazla olcum eklendikce dolacak") notu, uc
  noktadan cizilmis bir sekil degil.
- **Dil notr:** delta cipi isaretli farktan ibaret, iyi/kotu yargisi tasiyan yesil/kirmizi
  yerine notr zinc.
- **Free/Pro citi degismedi:** 7 gun + TIR cubugu free; gunluk profil, trend, saatlik ve
  percentil ozeti ayni `premium` bayraginin arkasinda, kilitli 30/90 onizlemesi mevcut
  blur + unlock kartiyla.
- Tum grafik matematigi `useMemo` ile; 90 gun birkac bin olcum ve pencere secici tum
  ekrani yeniden render ediyor.

Grafikler gercek geometri kodundan sentetik 30 gunluk veriyle SVG'ye cizilip **goz ile
denetlendi**; ilk turda iki gercek kusur bu sekilde yakalandi (bos dilimin guduk cubugu,
mavi uzerinde beyaz etiketin AA'yi gecirememesi) ve duzeltildi.

---

## 11.5 Coklu kisi ekleme: bir yan bulgu

Mukerrer kontrolu **nitelenmis** numaralari karsilastiriyor, saklanan metni degil. Bolge
farkindali normalizasyon eklenmeden onceki surumlerde kaydedilmis kisiler kullanicinin
yazdigi hali tutuyor ("0532 111 22 33"). Artik saklanan taraf da secilen numarayla ayni
yoldan gecirildigi icin, ayni numaranin bes tarihsel saklama bicimi
(`0532 111 22 33`, `0532-111-22-33`, `05321112233`, `00905321112233`, `+905321112233`)
E.164 bir secime karsi dogru sekilde mukerrer sayiliyor. Onceki halde ilk dordu ikinci kez
teklif edilip kaydedilirdi.

---

## 11.7 Klavye: hangi ekranda ne degisti

**Teshis, tahminden farkli cikti.** `keyboardVerticalOffset` yanlis degildi: bu
KeyboardAvoidingView'larin hepsi pencereyi kapliyor, yani 0 zaten dogruydu. Gercek kusur
suydu: `behavior="padding"` kabi kucultuyor, ama odaklanan input'u kuculen gorunume
**kaydiran hicbir sey yok**. Uzun bir formun altindaki alan klavyenin altinda kaliyordu.

Iki mekanizma, yuzey basina bir tane, asla ikisi birden:

| Ekran | Once | Sonra |
| --- | --- | --- |
| `calculator` | KAV padding | KAV kaldirildi, ScrollView `automaticallyAdjustKeyboardInsets` |
| `add-food` | KAV padding | ayni |
| `profile-setup` | KAV padding | ayni |
| `pens` | KAV padding | ayni |
| `emergency-contacts` | KAV padding | ayni (hem secici FlatList'i hem manuel form ScrollView'i) |
| `(tabs)/injection` | hicbir sey | ScrollView'e `keyboardAwareScrollProps` |
| `(tabs)/food` | hicbir sey | FlatList'e ayni (arama alani liste basliginin icinde) |
| `onboarding` | KAV padding | **degismedi**; footer scroll kabinin disinda sabit, kaldirmaktan baska yol yok |
| `GlucoseInputSheet` | KAV padding | KAV kaldi + govde daralip kaydirilabilir oldu |
| `ProfileSwitcher` | **hicbir sey** | KAV eklendi; "yeni profil" alani autoFocus, Olustur/Iptal hemen altinda |
| `QuizStep` | persistTaps var | degismedi, neden degismedigi yorumla yazildi |

- Uc scroll prop'u `lib/keyboard.ts`'te tek yerde, boylece yedi scroll yuzeyi birbirinden
  ayrisamaz. `keyboardShouldPersistTaps="handled"` sayesinde klavye acikken bir butona ilk
  dokunus butona basar, klavyeyi kapatmaya harcanmaz.
- **Android'de bilerek `behavior="height"` YOK.** Uretilen manifest'te
  `android:windowSoftInputMode="adjustResize"` dogrulandi; pencere zaten kuculuyor ve RN'in
  ScrollView'i odaklanan cocugu kendisi gorunure kaydiriyor. KAV eklemek ikinci kez
  kucultur. `automaticallyAdjustKeyboardInsets` iOS prop'u, Android'de yok sayiliyor.
- `automaticallyAdjustKeyboardInsets` RN 0.86 tiplerinde dogrulandi (ScrollView, iOS).
- `GlucoseInputSheet` govdesi ~420pt; iPhone SE'de klavye acikken ~407pt kaliyor, yani
  Kaydet yukaridan tasip ulasilmaz oluyordu. Sheet artik `maxHeight: "100%"` ile sinirli ve
  govde `flexShrink` ile daralip kaydiriliyor.

---

## Yol boyu yakalanan, madde disi iki sey

1. **NUL bayti (`1726c89`).** 11.5'te yazdigim `rowKey()` sablon dizgisine bir NUL kacmis;
   dosya grep ve satir bazli araclar icin ikili (binary) hale gelmisti. Calisma zamaninda
   bir sey bozulmuyordu (anahtarlar yine benzersizdi) ama kaynakta kontrol karakteri
   olmaz. Repo genelinde tarandi, baska NUL yok.
2. **Calculator loading dali (`87e90ae`).** Bagimsiz bir kod incelemesinden cikti: erken
   donusteki loading dali `<FeedbackHost />` mount etmiyordu. Bugun oradan hicbir sey
   konusmadigi icin bir hata degildi, ama ileride oraya bir hata toast'i eklense tam da bu
   turda temizlenen sinifta bir hata olurdu. Iki dal artik ayni eleman seklini donduruyor,
   yani React host'u konumuna gore eslestirip loading -> yuklendi gecisinde ayni ornegi
   koruyor.

---

## Statik kapi ve dil kurallari

- `npm run typecheck` her commit'te yesil (559 sema anahtari, eksik statik `t()` yok).
- Uc bagimsiz saf-mantik kosumu: `scripts/feedback.test.ts` (30 iddia, host yigini +
  buton yerlesimi), `scripts/offParse.test.ts` (28 iddia), mevcut `scripts/calc.test.ts`.
- **i18n:** yeni anahtarlar once `tr.ts`'e, sonra 4 dile. Toplam 24 yeni anahtar x 5 dil.
  Kullanilmayan bir anahtar (`chartTirCaption`) yazildiktan sonra gereksiz oldugu anlasilip
  silindi (TIR lejanti zaten sayilari tasiyor).
- **Regulasyon dili:** yeni metinlerin hicbirinde uyarir / alarm / tani / tedavi /
  onerilen doz yok. Grafik alt yazilari betimseldir, delta cipi yorumsuzdur, barkod
  sonucuna "tahmini besin degeri, tibbi referans degildir" cercevesi eslik eder.
- **Em dash:** benim dokundugum hicbir satirda yok ve **bes dil dosyasinin hicbirinde yok**
  (kontrol edildi). Once var olan yorumlarda hala ~55 tane duruyor (26 dosya, cogu bu turda
  hic acilmadi). Istenirse ayri bir temizlik commit'i ile suprulebilir.
- **Android'de Health Connect'e dokunulmadi.**
- **Expo SDK 57 / RN 0.86:** kullanilan her API yerel `node_modules` tiplerine karsi
  dogrulandi (`automaticallyAdjustKeyboardInsets`, `StyleSheet.absoluteFill`,
  `BackHandler.addEventListener(...).remove()`, `AbortController`).

---

# CIHAZ QA CHECKLIST

Kucuk bir telefon (iPhone SE veya benzeri) ve bir Android cihaz ile, hem mg/dL hem mmol/L
profiliyle. **Hicbir akista "restart gerekti" kalmamali.**

## A. 11.1 kok neden (en kritik)

- [ ] Tarayicida bilinmeyen bir barkod tara: "urun bulunamadi" diyalogu **kamera ekraninin
      ustunde** cikiyor, ekrandan cikinca degil.
- [ ] Diyalogda "Tekrar Tara": kamera geri geliyor, dokunuslar calisiyor.
- [ ] Diyalog acikken tarayiciyi X ile kapat: uygulama donmuyor, asili diyalog bir sonraki
      ekrana sizmiyor.
- [ ] Calculator'da "Fotograf ekle": action sheet **hemen** aciliyor.
- [ ] Calculator "Ogunu kaydet": modal kapaniyor, donma yok, ogun kontrol panelinde.
- [ ] add-food kaydet: toast gorunuyor **ve** modal kapaniyor. Toast, geri donulen ekranda
      devam ediyor.
- [ ] pens'te bir kalem sil: onay diyalogu kalem ekraninin ustunde.
- [ ] paywall/downsell/winback icinde bir toast tetikle (orn. satin alma geri yukle):
      modalin ustunde gorunuyor.
- [ ] Android: diyalog acikken donanim geri tusu **diyalogu** kapatiyor, ekrani degil.
- [ ] Action sheet alt guvenli alani (home indicator) ezmiyor.

## B. 11.2 barkod

- [ ] Gercek bir urun barkodu (orn. Nutella) tara: urun adi + karbonhidrat geliyor,
      calculator aciliyor.
- [ ] Yemek kartinda "Veri kaynagi: Open Food Facts" ve tahmin cercevesi yazili, "GI 0"
      **yazmiyor**.
- [ ] Ayni barkodu **ucak modunda** tekrar tara: onbellekten aninda geliyor.
- [ ] Ucak modunda **yeni** bir barkod tara: "urun bilgisi alinamadi" akisi, barkod
      on-dolu add-food.
- [ ] Bilinmeyen (ama gecerli) barkod, ag varken: "bulunamadi" akisi.
- [ ] Bir QR kod tara: aga **istek gitmiyor**, dogrudan bulunamadi akisi.
- [ ] Tarama sirasinda "Urun araniyor" gostergesi goruluyor, 5 sn'de zaman asimina dusuyor.
- [ ] Onbellege alinan urun, ayarlardaki ozel yemek sayacini artirmiyor (free limiti).
- [ ] Eski bir kurulumdan guncelleyerek ac: ozel yemekler ve kayitlar duruyor (sema v6).

## C. 11.3 tasma

- [ ] TR/DE/FR/ES/EN her dilde barkod "bulunamadi" diyalogu: butonlar **dikey yigin**,
      etiketler tek satir, kirpilmiyor.
- [ ] Sil / Iptal diyaloglari: butonlar yan yana, ferah.
- [ ] Dusuk seker takip action sheet'i (DE dili, en uzun etiket): secenek tek satir,
      ikonun altina sarkmiyor.

## D. 11.4 grafikler

- [ ] 7 / 30 / 90 gun pencerelerinde grafikler dogru ciziliyor.
- [ ] mg/dL ve mmol/L profillerinde eksen etiketleri dogru.
- [ ] Az veride ("daha fazla olcum eklendikce dolacak") notu, cizim yok.
- [ ] Gunluk profil: medyan cizgisi bandin **icinde**, hedef bandi arkada.
- [ ] Trend: olcumsuz gunler bosluk, sifir degil. Delta cipi isaretli ve notr.
- [ ] Saatlik: olcumsuz dilim kesikli bos kanal + tire.
- [ ] Time in range: yuzdeler cubugun uzerinde okunuyor, dusuk **mavi**.
- [ ] Free hesap 30/90 sectiginde grafikler blur + kilit kartiyla; 7 gun tam gorunuyor.
- [ ] VoiceOver/TalkBack: her grafikte SVG degil **alt yazi** okunuyor.
- [ ] PDF raporundaki AGP eskisiyle ayni gorunuyor.

## E. 11.5 coklu kisi

- [ ] Secici acilinca her numarada kutu gorunuyor (uzun basmak gerekmiyor).
- [ ] Uc kisi sec, "3 secildi" sayaci dogru, "Ekle" tek seferde hepsini ekliyor.
- [ ] Arama yaz, listeyi filtrele: secim korunuyor.
- [ ] Ayni kisiden iki numara secilebiliyor, ikisi de ekleniyor.
- [ ] Zaten kayitli numara secilemiyor, "Ekli" isaretiyle gorunuyor.
- [ ] Gecersiz numara secip ekle: ozet toast'ta bildiriliyor.
- [ ] Yalnizca **tek** gecersiz numara secilirse: form on-dolu aciliyor, satir ici hata var.
- [ ] Eski surumden guncellenen bir kurulumda, yerel formatta kayitli bir kisi rehberden
      **tekrar teklif edilmiyor**.

## F. 11.6 SOS

- [ ] Kisi yokken: buyuk aciklama karti + belirgin buton (degismedi).
- [ ] Kisi varken: listenin altinda "Kisi ekle / duzenle" satiri **her zaman** gorunuyor.
- [ ] Oradan ikinci bir kisi ekleyip geri don: liste guncel.

## G. 11.7 klavye (kucuk telefonda, her form)

- [ ] add-food: isim / karb / GI / porsiyon / not, hepsi odakta gorunur; Kaydet erisilebilir.
- [ ] calculator: doz ve not alanlari klavyenin altinda kalmiyor.
- [ ] emergency-contacts: isim / telefon alanlari gorunur; secici aramasi calisiyor.
- [ ] pens: toplam unite alani odakta gorunur, Kaydet erisilebilir.
- [ ] profile-setup: en alttaki ISF alani odakta gorunur.
- [ ] GlucoseInputSheet: klavye acikken **Kaydet gorunuyor**, sheet tasmiyor, govde
      gerekirse kayiyor.
- [ ] ProfileSwitcher: "yeni profil" alani autoFocus, Olustur/Iptal klavyenin ustunde.
- [ ] onboarding isim adimi: input gorunur, alttaki Devam butonu klavyenin ustunde.
- [ ] Yemek sekmesi aramasi: sonuclar klavyenin altinda kalmiyor.
- [ ] Enjeksiyon sekmesi: doz ve not alanlari gorunur.
- [ ] Klavye acikken bir butona **tek** dokunus butona basiyor.
- [ ] iOS: klavye asagi surukleyerek kapatilabiliyor. Android: adjustResize ile ikili
      kucultme **yok** (icerik iki kez ziplamiyor).

---

## 11.8 (EKLENDI 2026-07-10): NativeWind ScrollView ref'ini yutuyor, karusel oto-ilerlemesi bozuk

Kardes uygulama zerogram'da cihazda KANITLANDI (olcumlerle): NativeWind'in JSX runtime'i
`<ScrollView>`i cssInterop sarmalayicisiyla degistirir; `react-native-css-interop` bileseni
yalniz CLASS ya da zaten forwardRef ise forwardRef'le sarar. RN 0.86 `ScrollView`i duz
FONKSIYON bileseni olarak export ettigi icin diger dala girer ve cocugu `ref: undefined`
ile render eder. Sonuc: `scrollRef.current` HER ZAMAN null, `scrollTo` hicbir seye cagriliyor.
Parmakla kaydirma calisir (ref gerekmez), oto-ilerleme calismaz.

Bu repoda ayni desen var: components/onboarding/Welcome.tsx:108 `ref={scrollRef}` +
:76 `scrollRef.current?.scrollTo(...)`. RN 0.86 + nativewind 4.2.6: RISKLI.

Yapilacak:
- Once DOGRULA: Welcome'daki timer icine gecici `console.log(scrollRef.current)` koy,
  simulatorde ac (`npx expo run:ios`). Null ise bug bu repoda da var.
- Fix: o `<ScrollView>` elemanina `cssInterop={false}` prop'u ver (kutuphanenin kendi
  opt-out'u, `react-native-css-interop/dist/runtime/wrap-jsx.js` icinde kontrol edilir).
  O eleman gercek ScrollView olarak render edilir, ref baglanir. `className` yerine
  `style` kullan (zaten oyle).
- Repo genelinde tara: `grep -rn "ref={scrollRef}\|ref={listRef}" app components` ve bu
  ref'lerle `scrollTo/scrollToEnd/scrollToIndex/scrollToOffset` cagiran her yeri ayni
  sekilde duzelt (ornegin uzun listelerde konum geri yukleme sessizce calismiyor olabilir).
- Kabul: hicbir sey yapmadan bekle, slaytlar metinleriyle kendiliginden ilerliyor.
- Kapi: `npm run typecheck`.
- Commit: `fix(onboarding): opt out of cssInterop so the carousel ref attaches`

### 11.8 IPTAL (hub, 2026-07-10): bu repo ETKILENMIYOR

Hub yanlis genelleme yapti. Bug SURUME BAGLI: css-interop 0.1.x'te
`native-interop.js:171` spread'i `{ ...props, ...handlers, ref }` oldugu icin sondaki
`ref: undefined` gercek `props.ref`i eziyor. 0.2.5+'ta spread `{ ref, ...props, ...handlers }`
olarak duzeltilmis. Bu repo css-interop 0.2.6 kullaniyor (nativewind 4.2.6), yani ref
BAGLANIR. Yalniz gram (0.1.22) etkilenmisti.

11.8'i UYGULAMA. `cssInterop={false}` burada gereksiz olurdu ve o elemanda `className`i
sessizce devre disi birakirdi. Bir sey yapman gerekmiyor.
