# Apple Ads attribution: gizlilik beyani (2.3.1)

Bu dosya, uygulamanin iOS gizlilik beyanini kapatir: `lib/services/purchases.ts`
icindeki `enableAdServicesAttributionTokenCollection()` cagrisi ve
`lib/analytics/` uzerinden calisan Firebase Analytics ile Crashlytics.
Kampanya plani icin bkz. `docs/apple-ads/plan.md`.

## 1. Ne topluyoruz

Uygulama, RevenueCat SDK'si araciligiyla iki sey topluyor. Birincisi satin alma
gecmisi: hangi urunun alindigi ve aboneligin durumu, Pro yetkisini vermek icin.
Ikincisi Apple Ads attribution token'i: Apple'in AdServices cerceve arayuzunun
cihazda urettigi, kullaniciyi veya cihazi kimliklendirmeyen bir jeton. RevenueCat
bu jetonu 24 saat icinde Apple'a sunup karsiliginda kampanya, ad group ve anahtar
kelime bilgisini aliyor; boylece hangi reklamin odeme yapan kullanici getirdigini
gorebiliyoruz.

Ucuncu olarak Firebase Analytics ve Crashlytics calisiyor
(`lib/analytics/firebaseSink.ts`, yalnizca `__DEV__` disinda baglaniyor).
Analytics, hangi ekranin ve hangi ozelligin kullanildigini gosteren kategorik
olaylari ve her kuruluma atanan Firebase app instance kimligini topluyor.
Crashlytics, cokme yigin izlerini ve cihaz ile isletim sistemi bilgisini
topluyor. Ikisi de urunun nerede kirildigini gormek ve hangi ozelligin
kullanildigini olcmek icindir.

Toplanmayanlar da en az bunun kadar onemlidir. Saglik verisi, kan sekeri kaydi,
insulin kaydi, ogun kaydi ve fotograflar cihazda kalir, hicbiri RevenueCat'e veya
baska bir sunucuya gitmez. IDFA toplanmaz: RevenueCat'in reklam kimligi toplama
metodu olan `collectDeviceIdentifiers()` kod tabaninda hicbir yerde cagrilmaz.
Kullaniciya bagli bir kimlik de gonderilmez: `logIn()` cagrilmadigi icin
RevenueCat anonim bir kullanici kimligi uretir.

## 2. app.json icine yazilan blok

Kalici yer `app.json` icindeki `expo.ios.privacyManifests` alanidir.
`ios/` klasoru `.gitignore` icindedir, bu yuzden `ios/zerospike/PrivacyInfo.xcprivacy`
dosyasini elle duzenlemenin anlami yoktur: bir sonraki `expo prebuild --clean`
onu sifirlar.

```json
"privacyManifests": {
  "NSPrivacyTracking": false,
  "NSPrivacyCollectedDataTypes": [
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePurchaseHistory",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
        "NSPrivacyCollectedDataTypePurposeAnalytics" ] },
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeAdvertisingData",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeDeveloperAdvertising",
        "NSPrivacyCollectedDataTypePurposeAnalytics" ] },
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeProductInteraction",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeAnalytics" ] },
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeDeviceID",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeAnalytics" ] },
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeCrashData",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality" ] },
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherDiagnosticData",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality" ] }
  ]
}
```

Not: yukarida okunurluk icin sikistirilmis yazildi, `app.json` icindeki hali
tam girintilidir. Tam metin icin `git diff app.json` bakiniz.

Expo bu blogu **birlestirir**, sifirdan yazmaz
(`@expo/config-plugins/build/ios/PrivacyInfo.js`, `mergePrivacyInfo`). Sablonun
zaten getirdigi `NSPrivacyAccessedAPITypes` kayitlari (FileTimestamp `C617.1`,
UserDefaults `CA92.1` / `1C8F.1` / `C56D.1`, SystemBootTime `35F9.1`) yerinde
kalir. Birlestirme yalniz ekleme yapar, silme yapmaz: ileride bir beyani
kaldirmaniz gerekirse `expo prebuild --clean` calistirmaniz sart, yoksa eski
kayit uretilen dosyada kalmaya devam eder.

`NSPrivacyTrackingDomains` bilerek bostur. Bu alana bir alan adi yazilirsa iOS,
ATT izni verilmemis kullanicilarda o alan adina giden tum istekleri engeller.
Uygulamada ATT istemi hic gosterilmiyor, yani izin hicbir zaman verilmis
olmayacak; `api.revenuecat.com` oraya yazilsaydi tum kullanicilarda Pro yetkisi
dogrulamasi kirilirdi.

## 3. App Store Connect gizlilik formu: satir satir

App Store Connect -> zerospike -> App Privacy -> Edit. Asagidaki sirayla
ilerleyin.

**Adim 1. "Do you or your third-party partners collect data from this app?"**
- Cevap: **Yes**.

**Adim 2. Veri turleri (Data Types ekrani).** Yalnizca su alti kutuyu isaretleyin.
- **Purchases -> Purchase History**
- **Usage Data -> Product Interaction**
- **Usage Data -> Advertising Data**
- **Identifiers -> Device ID**
- **Diagnostics -> Crash Data**
- **Diagnostics -> Other Diagnostic Data**

Isaretlenmeyecekler, sebepleriyle:
- **Health & Fitness** altindaki hicbir kutu. Saglik verisi cihazdan cikmiyor
  (kanit icin 6. bolum). Magaza metniniz "hesap yok, bulut yok" diyor, beyan
  bununla celismemeli.
- **Identifiers -> User ID**: `setUserId` ve RevenueCat `logIn()` hicbir yerde
  cagrilmiyor, kullaniciya bagli kimlik gonderilmiyor.
- **Diagnostics -> Performance Data**: Firebase Performance Monitoring kurulu
  degil (`ios/Podfile.lock` icinde `FirebasePerformance` yok).
- **Contact Info**, **Contacts**, **User Content**, **Location**. Konum yalnizca
  SOS ekraninda, kullanicinin kendi gonderdigi mesaja eklenir; bize veya bir
  sunucuya gitmez, dolayisiyla "toplanan veri" degildir.

**Adim 3. Purchase History detay ekrani.**
- "Is this data used for tracking purposes?" -> **No**.
- "Is this data linked to the user's identity?" -> **No**.
- Purposes: **App Functionality** ve **Analytics**.

**Adim 4. Advertising Data detay ekrani.**
- "Is this data used for tracking purposes?" -> **No**. Gerekcesi 4. bolumde.
- "Is this data linked to the user's identity?" -> **No**.
- Purposes: **Developer's Advertising or Marketing** ve **Analytics**.
  **Third-Party Advertising** secmeyin: reklam kendi reklamimizdir, ucuncu taraf
  reklam agina veri gitmiyor.

**Adim 5. Product Interaction detay ekrani.**
- Tracking -> **No**. Linked -> **No**.
- Purposes: **Analytics**.

**Adim 6. Device ID detay ekrani.**
- Tracking -> **No**. Linked -> **No**.
- Purposes: **Analytics**.
- Bu kutu IDFA yuzunden degil, Firebase'in her kuruluma atadigi **app instance
  kimligi** yuzunden isaretleniyor. Google bu kimligin otomatik atandigini kendi
  rehberinde soyluyor (6. bolumdeki kaynak).

**Adim 7. Crash Data ve Other Diagnostic Data detay ekranlari.**
- Ikisinde de Tracking -> **No**, Linked -> **No**.
- Purposes: **App Functionality**.
- Bu iki deger Crashlytics Pod'unun kendi `PrivacyInfo.xcprivacy` dosyasindaki
  beyaniyla birebir aynidir, bilerek oyle secildi.

**Adim 8. ATT bolumu.**
- Uygulama App Tracking Transparency istemi gostermiyor,
  `NSUserTrackingUsageDescription` anahtari `app.json` icinde yok. Formda hicbir
  veri turu icin "used for tracking" isaretlemeyin; aksi halde Apple ATT istemi
  bekler ve inceleme reddedilir.

## 4. NSPrivacyTracking neden false kaliyor

Apple'in tanimi nettir: takip, uygulamanizdan toplanan kullanici veya cihaz
verisini **baska sirketlerin** uygulama, site ve mecralarindan toplanan veriyle
hedefli reklam veya reklam olcumu icin eslestirmek, ya da veriyi bir veri
simsarina vermektir. Apple Ads attribution'da eslestirilen veri baska bir
sirketten degil, dogrudan Apple'dan gelir; RevenueCat da veri simsari degil,
bizim adimiza isleyen hizmet saglayicidir. Apple'in AdServices cercevesini ATT
izni olmadan calisacak sekilde tasarlamis olmasi da bunu dogrular: standart
attribution verisi icin kullanici onayi gerekmez, onay yalnizca tiklama ve
gosterim tarihini ekleyen "detailed" veri icin gerekir ve biz onu istemiyoruz.
Buna bir de pratik kanit eklenir: `NSPrivacyTracking` true yapilirsa
`NSPrivacyTrackingDomains` icine en az bir alan adi girmek gerekir, ve iOS o alan
adlarina giden istekleri ATT izni yokken engeller. Uygulamada ATT istemi
olmadigi icin bu, satin alma dogrulamasini tum kullanicilarda kiran bir degisiklik
olurdu. Karar: `false`.

Firebase tarafi da bu karari bozmuyor. Kurulu tum Firebase Pod'lari kendi
manifestolarinda `NSPrivacyTracking` degerini `false` veriyor ve tracking domain
listeleri bos. Kullanici kimligi gonderilmiyor, gercek bir IDFA elde edilmiyor
(6. bolum). Varsayilan yapilandirmada Firebase Analytics takip degildir.
Bunun tek kosulu konsol tarafidir: Firebase projesinde **Google signals** acilir
veya bir **Google Ads hesabi baglanirsa** bu hukum degisir ve beyanin yeniden
degerlendirilmesi gerekir.

## 5. Firebase: kod tabanindan dogrulananlar

Google'in genel listesi oldugu gibi kopyalanmadi; her madde repoda dogrulandi.

| Soru | Sonuc | Kanit |
|---|---|---|
| Kullanici kimligi gonderiliyor mu | Hayir | `setUserId`, `setUserProperties`, `setCustomKey` kod tabaninda hic gecmiyor |
| Gercek IDFA elde ediliyor mu | Hayir | ATT istemi yok, `NSUserTrackingUsageDescription` yok, izin verilmedigi icin IDFA sifir doner |
| IDFA yetenegi binary'de var mi | **Evet** | `ios/Podfile.lock:181` `FirebaseAnalytics/IdentitySupport`, `:228` `GoogleAppMeasurement/IdentitySupport` |
| Performance Monitoring var mi | Hayir | `ios/Podfile.lock` icinde `FirebasePerformance` yok |
| Olay parametrelerinde saglik verisi var mi | Hayir | Asagida |

**Saglik verisi denetimi.** Kirk uc `logEvent` cagrisinin tamami elden gecirildi.
Gonderilen parametreler yalnizca sabit kategori etiketleridir: `kind`
(`glucose` / `meal` / `insulin` / `med`), `source` (`manual` / `template` /
`recent` / `health`), `tier`, `trigger`, `method`, `step`, `window` (7 / 14 / 30
gunluk pencere). Hicbir kan sekeri degeri, insulin dozu, karbonhidrat miktari,
ogun icerigi, kayit zamani veya serbest metin gonderilmiyor.

`logCrash` tarafinda durum daha da dardir: `lib/analytics/firebaseSink.ts:20`
icindeki sink yalnizca `error` argumanini aliyor, cagri yerlerindeki `context`
nesnesi (`{ screen, step, load }`) **hic kullanilmiyor** ve Firebase'e
ulasmiyor. Yani onceki guvenlik denetiminin "logCrash cagrilari yalniz ekran
etiketi tasiyor" tespiti dogrudur, gerceklik ondan da dardir.

**Kusur olarak bildirilen tek kalem.** `app/paywall.tsx:219`, `paywall_view`
olayinda `focus` parametresini gonderiyor; degeri `"insulin"` veya `"tracking"`
(`app/paywall.tsx:183`). Bu bir saglik **degeri** degildir, ama kullanicinin
insulin odakli akisi sectigini ima eder. Ayni sekilde `log_added` olayindaki
`kind: "insulin"` etiketi de kullanicinin insulin kaydi tuttugunu gosterir.
Bunlar Apple'in **Product Interaction** tanimina girer ve beyan da oyle
yapilmistir; **Health** olarak beyan edilmemistir, cunku saglik verisi degil
ozellik kullanim etiketidir. Yine de bu iki etiketin gercekten gerekli olup
olmadigi urun karari olarak gozden gecirilmelidir. Beyani genisleterek
ortulmemistir.

## 6. RevenueCat konsolunda yapilmasi gerekenler

- Project Settings -> Integrations -> **Apple Search Ads** entegrasyonunu ekleyin.
- Advanced hesapta "Sign in with Apple" ile Apple Ads hesabini yetkilendirin.
  Yetkilendiren kullanicinin Apple Ads tarafinda **Account Admin** veya
  **Campaign Group Manager** rolu olmalidir.
- Basic hesapta projeye "Add Apple Search Ads integration" yeterlidir, ayrica
  oturum acmaya gerek yoktur.
- Entegrasyon acildiktan sonra Charts ekraninda kampanya kirilimini gormek icin
  attribution jetonunun gelmesini bekleyin; jeton yalnizca App Store'dan gercek
  indirmelerde uretilir, TestFlight ve simulator kurulumlarinda uretilmez.
- Kod tarafinda ek bir sey gerekmez: `enableAdServicesAttributionTokenCollection()`
  cagrisi `lib/services/purchases.ts` icinde zaten `configure()` sonrasina bagli.

## 7. Kalan risk

- **IDFA yetenegi gereksiz yere binary'de.** `@react-native-firebase/analytics`
  varsayilan olarak `FirebaseAnalytics/IdentitySupport` kuruyor, bu da
  `AdSupport` baglayan surumdur. Uygulama ATT istemi gostermedigi icin bundan
  hicbir fayda saglanmiyor, yalnizca risk tasiniyor. Podfile degiskeni
  `$RNFirebaseAnalyticsWithoutAdIdSupport = true` ile bu yetenek tamamen
  kaldirilabilir. Bu degisiklik `expo.plugins` alanina dokunacagi icin bu iste
  yapilmadi, ayrica karar verilmelidir.
- **IP kaynakli kaba konum: DOGRULANAMADI.** Google, Analytics'in maskelenmis IP
  adresinden genel konum turettigini soyluyor. Bu uygulamanin topladigi bir veri
  degil, Google'in sunucu tarafinda cikardigi bir bilgidir, bu yuzden
  **Coarse Location** beyan edilmedi. Apple'in bunu beyan zorunlulugu sayip
  saymadigina dair kesin bir kaynak bulunamadi. Muhafazakar davranmak isterseniz
  ASC formunda **Location -> Coarse Location** kutusunu ekleyebilirsiniz;
  manifest tarafinda karsiligi `NSPrivacyCollectedDataTypeCoarseLocation` olur.
- **Konsol tarafi dogrulanamaz.** Firebase projesinde Google signals acik mi,
  Google Ads hesabi bagli mi, veri paylasim ayarlari nasil; bunlar depodan
  gorulemez. Herhangi biri acikse `NSPrivacyTracking` karari yeniden
  degerlendirilmelidir.
- **Statik framework uyarisi.** `useFrameworks: "static"` acik ve Expo, Apple'in
  statik Pod manifestolarini her zaman dogru ayristirmadigini yaziyor. Firebase
  ve RevenueCat beyanlarinin uygulama manifestosuna da yazilmis olmasi bu riski
  kapatiyor.
- Beyan silinmesi gerekirse `expo prebuild --clean` sart; `mergePrivacyInfo`
  yalnizca ekler, silmez.

## 8. Kaynaklar

- Apple, User Privacy and Data Use (takip tanimi ve istisnalari):
  https://developer.apple.com/app-store/user-privacy-and-data-use/
- Apple, NSPrivacyCollectedDataType (veri turu sabitleri ve tanimlari):
  https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype
- Apple, NSPrivacyCollectedDataTypePurposes (amac sabitleri):
  https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatypepurposes
- Apple, NSPrivacyTrackingDomains:
  https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacytrackingdomains
- Apple Ads Help, App ad attribution overview:
  https://ads.apple.com/app-store/help/attribution/0094-ad-attribution-overview
- RevenueCat, Apple Search Ads entegrasyonu:
  https://www.revenuecat.com/docs/integrations/attribution/apple-search-ads
- RevenueCat, Apple App Privacy rehberi:
  https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy
- Expo, Privacy manifests rehberi:
  https://docs.expo.dev/guides/apple-privacy/
- Expo, app config `ios.privacyManifests`:
  https://docs.expo.dev/versions/latest/config/app/
- Google, Apple App Store veri aciklama gereklilikleri:
  https://firebase.google.com/docs/ios/app-store-data-collection
- Google Analytics veri toplama (app instance kimligi, IP kaynakli konum):
  https://support.google.com/analytics/answer/10285841
- react-native-firebase, `$RNFirebaseAnalyticsWithoutAdIdSupport`:
  https://github.com/invertase/react-native-firebase/discussions/6180
