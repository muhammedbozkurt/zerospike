# Changelog

Kullanıcıya görünen değişiklikler. Mağaza "yenilikler" metinleri
`zerospike-store/aso/<dil>.md` dosyalarındaki **What's New** alanında, dokuz
dilde tutulur; burada teknik ayrıntı da yer alır.

Sürüm damgası: `app.json` (`version`, `ios.buildNumber`, `android.versionCode`)
ve `package.json`.

## 2.3.6 (yayinlanmadi)

### Health yazması
- Apple Health ve Health Connect'e yazma artık ücretsiz; okuma ve otomatik
  senkron Pro olarak kalıyor. Yazma izni üç yerde istenebiliyor: Ayarlar'daki
  anahtar, Health bağlanma akışı (okuma ve yazma tek diyalog) ve elle kayıt
  sonrası tek seferlik "Health'e de kaydedelim mi?" sorusu.
- Yalnız elle girilen kan şekeri ölçümleri yazılıyor. Uygulamada silinen
  kaydın Health'teki kopyası da siliniyor.
- Ayarlar > Veri'de isteğe bağlı geçmiş aktarımı (7/30/90 gün).
- iOS'ta Health'e yazma önceki sürümlerde hiç çalışmıyordu; düzeltildi. Daha
  önce yazılamayan kayıtlardan yalnız son 7 gün otomatik yazılır, daha eskiler
  için geçmiş aktarımı kullanılır.
- NSHealthUpdateUsageDescription metni (app.json ve 8 ios-locales dosyası)
  yazmanın yalnız kullanıcı açtığında/onayladığında ve yalnız elle girilen
  ölçümler için yapıldığını anlatacak şekilde güncellendi.
- Kayıttan hemen sonra yapılan düzenleme, silme ve geri alma Health'te tek
  ve güncel örnekle sonuçlanıyor (satır başına kilit, 30 sn native zaman
  aşımı).

### iOS 27
- UIScene yaşam döngüsüne geçildi (expo ~57.0.26, RN 0.86.3). Xcode 27 SDK
  ile derlenen uygulama artık iOS 27'de açılıyor. plugins/withSceneLifecycle.js.

### Post-meal hatırlatıcı
- Elle girilen "yemeğe kaç dk önce başladınız" değeri birebir kuruluyor;
  kurulacak saat önizlemede ve onay mesajında gösteriliyor.
- Android'de kesin zamanlama izni kapalıyken de sayaç kuruluyor; hatırlatıcı
  tercihi açıksa izin ayarına götüren uyarı gösteriliyor.

### Erişilebilirlik
- Sheet ve onay diyaloglarında VoiceOver/TalkBack düğmelere tek tek
  ulaşabiliyor; kapatma hareketi destekleniyor.

### Diğer
- Android glukoz giriş sheet'inde Kaydet klavyenin üstünde kalıyor.
- 0 ünitelik yeni enjeksiyon kaydı engellendi; dozsuz eski kayıtlar
  düzenlenebilir.

### Enjeksiyon haritası
- Bölge haritasında yeni insan silüeti.

### Sayı girişi
- Doz, karbonhidrat ve oran alanlarında boş veya yarım değerin sessizce
  kaydedilmesi engellendi; geçersiz alanda kaydet pasif.

## 2.3.5 (build 73 / versionCode 74, eas autoIncrement sonrasi)

### Enjeksiyon kaydı
- Enjeksiyon düzenleme sayfasındaki kalem/ürün seçici kaldırıldı; kayıt
  hangi ürünle girildiyse onu taşıyor. Ürün artık yalnız Ayarlar > Profil'den
  değişiyor.

### Health yazması
- Bir ölçüm Health'e yazılamadığında ekranda anında bilgilendirme (toast)
  çıkıyor, oturum başına bir kez.
- Ön plana gelindiğinde veya elle senkronda, daha önce yazılamamış son 7
  günün ölçümleri sırayla yeniden deneniyor.
- Ayarlar > Veri'de yazma anahtarının altında son yazmanın başarılı mı
  başarısız mı olduğu ve zamanı gösteriliyor.
- iOS'ta yazma izni her yazımdan önce kontrol ediliyor; izin belirsizse
  tekrar sorulup sonuca göre değerlendiriliyor.

### Paywall
- Üçüncü kayıttan sonra açılan paywall artık kendi bağlamlı başlık ve
  metnini gösteriyor; önceden jenerik başlığa düşüyordu.
- Fayda ızgarası özellik adı yerine sonucu anlatıyor (örnek: "90 güne kadar
  trendler", "doktorunuz için PDF").
- Üst bardaki ayrı "Şimdi değil" düğmesi kaldırıldı, tek kapatma kontrolü
  (X) kaldı.
- Fiyat sabitleri güncellendi; bunlar yalnız offerings yüklenemediğinde
  gösterilen yedek değerler, gerçek mağaza fiyatları değişmedi.

## 2.3.4 (build 72 / versionCode 73, eas autoIncrement sonrasi)

### Paywall zamanlaması
- Paywall artık onboarding'in sonunda değil, kullanıcı ilk üç kaydını
  girdikten sonra ana ekrandan açılıyor.
- İndirim ekranı (downsell), paywall en az iki kez kapatılıp ilk kapatmadan bu
  yana en az 24 saat geçmeden gösterilmiyor.
- Bu kural satın alma vazgeçildiğinde de aynen geçerli.

## 2.3.3 (build 69 / versionCode 70)

### Ana ekran halkası
- Halka artık günün ortalama ölçümünü gösteriyor; son ölçüm değeri halkanın
  altında ayrı bir satırda kalıyor.

### Aktif insülin ve bazal
- Aktif insülin kartı yalnız hızlı etkili insülini sayıyor. Bazal için günlük
  durum satırı eklendi ("bazal bugün yapıldı" / "bekliyor") ve tek dokunuşla
  kayıt eklenebiliyor.
- Bazal hatırlatıcısına dokununca onay sorusu, bölge seçimi ve profildeki
  bazal ünite ile kayıt alınıyor; bildirimde "Yaptım" düğmesi var.

### Öğün kaydı ve karbonhidrat oranı
- Karbonhidrat oranı (1 Ü = X g) yemek sekmesinde ve öğün kaydında görünüyor,
  dokununca ayara gidiyor.
- Öğün kaydında doz alanı artık otomatik dolmuyor; referans satırlar kalıyor,
  dozu kullanıcı giriyor.

### Yemek kataloğu
- Yaklaşık 280 yeni kayıt eklendi (Türk, Alman, Fransız, İspanyol, İtalyan,
  Portekiz/Brezilya, Arap, Japon mutfakları) ve porsiyon ön ayarları (dilim,
  kase, tabak) geldi. Tüm katalog adları İtalyanca, Portekizce, Arapça ve
  Japonca'ya çevrildi.
- Open Food Facts'te isimle arama eklendi.

### Rapor
- Raporda hatırlatıcıdan gelen bazal kayıtlar işaretli görünüyor.

## 2.3.2 (build 67-68 / versionCode 68-69)

### Kurulum ve Pro ekranları
- Onboarding "midnight" tasarımına göre yeniden çizildi: her adımda tek çapa
  ikon, daha büyük seçenek kartları, tam genişlik tek birincil buton ve sade
  bir "atla" bağlantısı. Diyabet tipi sorusu daha doğrudan soruluyor, hâlâ
  atlanabiliyor; kurulumun önceden doldurduğu başlangıç hedef aralığı yeni
  değil, sadece ekran yeniden çizildi.
- Paywall, downsell ve winback sadeleştirildi: tek başlık, tam cümle yerine
  kısa fayda etiketleri, sabitlenmiş tek buton ve yeni bir teklif kartı
  (`components/OfferCard.tsx`).

### Bildirim ve alarm başlıkları
- Tipe bağlı hatırlatıcılar (ölçüm, ilaç, bazal) artık bildirimde ve alarmda
  her zaman kısa tip adını gösteriyor; kullanıcının verdiği veya hazır
  düzenin verdiği isim başlığa çıkmıyor. Özel hatırlatıcılar kendi adını
  göstermeye devam ediyor (`lib/reminderLabel.ts`). Amaç, uzun isimlerin
  AlarmKit'in dar görünümünde kırpılmasını (ör. "Glikoz ölçü...") önlemek;
  uygulama içindeki liste, kontrol paneli ve "sıradaki" kartı hâlâ tam adı
  gösteriyor.

### Enjeksiyon haritası ve tablet düzeni
- Enjeksiyon vücut haritasında kalça bölgeleri artık üst tarafta tek sırada,
  önceki 2x2 düzen yerine.
- Alt kenara yaslı sheet'ler 600pt'de, onay dialogları 520pt'de üst
  sınırlanıp ortalanıyor; onboarding soru kartı aynı sınırı kullanıyor;
  tablette yüzen ekle düğmesi artık günlük panelinin üstüne binmiyor.

### Küçük düzeltmeler
- Hero stepper boşlukları sıkılaştırıldı ve mmol/L birim son ekinin stepper
  alanında taşması giderildi.
- Android'de alarm sesi servisi `mediaPlayback` yerine `shortService`
  türüne alındı: ek izin gerektirmiyor, Play politika uyumu için.

### Mağaza ve dahili
- Ekran görüntüsü modu ve mağaza çekim tarifi güncellendi: demo Spike
  sohbeti 9 dilde 6 turluk oldu, çekim tarifi 7 kareye ve deterministik
  panel sıfırlamaya geçti; bunlar yalnız dahili çekim araçları, uygulama
  davranışını etkilemiyor.
- ASO metni: Apple Watch ve Wear OS companion uygulamaları artık mağaza
  açıklamasında anlatılıyor; App Store anahtar kelime sınırı 100 karaktere,
  Play kaynağı `aso-android/<dil>.md`'ye netleştirildi.

## 2.3.1 (build 65 / versionCode 65)

### Tokluk sayacı
- Kart iki satıra indi: başlık ve "özel süre seç" butonu, altında tam genişlik
  birincil buton. Kartta artık hiçbir yerde dakika sayısı yazmıyor; sağ üstteki
  metin bir değer değil bir eylem, böylece buton olduğu okunuyor.
- Sayaç süresi her zaman 120 dakika ve kullanıcıya hiçbir yerde sorulmuyor.
  2.3.0'daki sabit pencere korundu; ayarlanabilir olan, sayacın ne zaman
  başladığı.
- Buton tek bir şey soran bir modal açıyor: yemeğe kaç dakika önce başlandığı.
  Hazır seçenekler ve "başka bir süre" alanı var, kalan süre buna göre sayılır.
  Ayrı "geç başladım" sheet'i bu modale dönüştü, iki sheet aynı işi yapmıyor.
- Yerleşim saf bir ölçüm fonksiyonuyla test ediliyor
  (`lib/postMealCardLayout.ts`, `scripts/postMealCardLayout.test.ts`): beş cihaz
  genişliği, İngilizce ve Almanca etiketler, 1.0x ve 1.3x Dynamic Type için
  taşma yok.
- Seçilen süre `endsAt` üzerinden Live Activity'ye ve widget'lara yansır.
  Çalışan bir sayacı aynı öğüne yeniden çapalamak süresini korur, 120'ye
  düşürmez. Live Activity genişletilmedi, yalnız tokluk sayacı için kalır.
- Android'de sayaç artık kalıcı bir bildirim olarak da görünüyor: sessiz, titreşimsiz
  yeni bir kanaldan (`postmeal-v1`) geliyor ve kapatılamıyor ama dokunulmadıkça
  ekranı meşgul etmiyor. iOS'ta bu görevi zaten Live Activity görüyor; Android'in
  kilit ekranı eşdeğeri yok.

### Klavye
- Alt kenara yaslı sheet'ler için ortak kabuk: `components/SheetShell.tsx` ve
  saf ölçüm fonksiyonu `lib/sheetLayout.ts`. Klavye yüksekliği ölçülüp telafi
  ediliyor, onay alanı klavyenin üstünde kalıyor.
- `PostMealLateSheet` bu kabuğa taşındı. Önceki hâlinde alt kenara yaslı bir
  `Modal` içinde `KeyboardAvoidingView` yoktu ve içindeki `Stepper` gerçek bir
  `TextInput` taşıdığı için klavye alanı ve onay butonunu örtüyordu.
- Yeni `PostMealDurationSheet` sayısal klavye ve iOS'ta "Bitti" çubuğu
  kullanıyor; boş, 0, 5 dakikanın altı ve 1440 dakikanın üstü değerler nötr bir
  metinle reddediliyor.

### İnsülin ürünleri
- Onboarding'e insülin adımı eklendi: bazal ve bolus ürünü ayrı ayrı, günlük
  bazal miktarı ile birlikte. Onboarding'i insülinsiz geçen kullanıcı bu adımı
  görmez. Ekran uygulamanın geri kalanıyla aynı kelimeleri kullanır (bazal ve
  bolus), enjeksiyon ekranı ve içgörülerdeki adlandırmayla birebir.
- Ürün kataloğu genişletildi: birleşik marka etiketleri ayrıldı (Lantus,
  Basaglar, Abasaglar, Semglee, Actrapid, Humulin R ayrı kayıtlar) ve karışım
  kategorisi eklendi (NovoMix, Ryzodeg, Humalog Mix, Mixtard). Katalogda olmayan
  ürün için "Diğer" serbest metin alanı.
- Bazal ve bolus listeleri tamamen ayrı: her seçici tek kategorili homojen bir
  liste gösteriyor, grup başlıkları kalktı. Karışım kendi satırında; seçilince
  hem bazal hem bolus alanını doldurur ve diğer iki satır gizlenir.
- Kurulum ve profil ekranındaki seçicilerde "Seçilmedi" artık bir seçenek
  değil. Değer boşsa yalnız durum metni olarak görünür. Tek bir kayıt için
  ürün belirtmemek meşru olduğundan enjeksiyon ekranında seçenek olarak kalır.
- Enjeksiyon kaydı artık kendi ürününü taşıyor (`insulin_product_id`,
  `insulin_product_other`). Ön dolu değer profilden gelir; kayıt ekranında
  değiştirmek profili değiştirmez, geçmiş kayıtlar kendi ürününü korur.

### Apple Health
- İçe aktarılan okumalar artık yalnız `Health` kaynak etiketi taşıyor. Önceki
  `CGM` etiketi kaldırıldı: kaynak Apple Health'tir, verinin sürekli ölçümden mi
  parmak ucundan mı geldiği bilinmiyor.
- İçe aktarılan okumaya otomatik dönem etiketi atanmıyor. Saat tablosuna dayalı
  tahmin (`pickTagForHour`) silindi; kural tek yerde toplandı
  (`lib/periodTag.ts`). Etiket kullanıcı isterse elle atanır.
- Geçmiş satırlar için geri doldurma (şema v22): yalnız eski otomatik tahminle
  birebir aynı olan etiketler `unset` yapılır, kullanıcının elle değiştirdiği
  etiket korunur.
- Çift kayıt düzeltildi: içe aktarma tekilleştirmesi artık yalnız Health
  kaynaklı satırlara değil, tüm kayıtlara bakıyor. Ölçüt aynı mg/dL değer ve
  15 dakikalık pencere.
- İzin reddi ile veri yokluğu tek nötr metinde ayrıştırıldı; Health'e yazma
  başarısızlığı sessiz kalmıyor; yazma sonrası kimlik saklanamazsa iz bırakılıyor.

### Health Connect (Android)
- Android'de sağlık verisi köprüsü Health Connect ile geldi: son 30 gün, en
  fazla 300 örnek olacak şekilde şeker okumaları içeri aktarılıyor; kullanıcı
  elle girdiği ölçümleri Health Connect'e yazmayı açarsa oraya da yazılıyor.
  Apple Health tarafındaki davranış değişmedi.
- `lib/services/health.ts` sağlayıcı mimarisine ayrıldı: iOS ve Android artık
  kendi dosyasında (`healthAppleKit.ts`, `healthConnect.ts`), geliştirme modu
  kendi sahte sağlayıcısında (`healthMock.ts`); ortak arayüz sayesinde geri
  kalan uygulama hangi platformda olduğunu bilmeden aynı fonksiyonları çağırır.
- Sağlık yüzeyleri Android'de açıldı: ayarlar veri ekranı, ana ekran hızlı
  erişim kartı, kurulum akışındaki sağlık adımı ve paywall'daki özellik satırı
  artık Android'de de görünüyor. İçgörüler'deki sağlık özeti kartı iOS'ta
  kalıyor; Health Connect'te insülin veri türü yok.

### Günlük ve silme
- Sola kaydırarak silme ve düzenleme ekranında Sil butonu; ikisi de önce sorar.
  Uzun basma menüsü erişilebilirlik alternatifi olarak kalır.
- Dört kayıt türünün dördünde de düzenleme ekranında Sil var: şeker, ilaç,
  enjeksiyon ve yemek. Yemek kaydı tam ekran hesaplayıcıda düzenlendiği için
  en son o kazandı; silme günlüğün kullandığı yolu kullanır, yani hesaplayıcının
  yazdığı bolus da birlikte gider ve geri alma ikisini birden getirir. Öğüne
  bağlı, önceden var olan bir şeker ölçümüne dokunulmaz.
- Silme panelinin genişliği satırın yüzde 25'i; sabit bir piksel değeri değil,
  ölçülen satır genişliğine bağlı, böylece küçük ve büyük ekranlarda aynı oranda
  duruyor. Tablette bir üst sınır devreye giriyor: oransal genişlik orada
  paneli avuç içi kadar büyütüp açmak için gereken çekişi bir fiskenin
  ulaşamayacağı yere taşıyordu. Sınır hiçbir telefonda bağlanmıyor.
- Kaydırma jesti parmağı birebir takip ediyor ve kırmızı alan ilk hareket eden
  pikselden itibaren dolu görünüyor. Küçük bir kaydırma bırakıldığında panel
  geri kapanıyor: açık kalması için panelin yüzde 70'i çekilmiş olmalı. Silme
  butonuna yanlışlıkla ulaşmak bu yüzden mümkün değil.
- Kaydırma ölçüleri ve açılma kuralı saf bir modülde (`lib/swipeAction.ts`) ve
  testle sabit; testler kütüphanenin kendi bırakma kuralını ve her iki native
  jest işleyicisini de okuyarak uygulamanın gerçekten böyle bağlandığını
  doğruluyor.
- Geri alma süresi 5 saniye; toast süresi ve geri alma penceresi tek ortak
  sabitten geliyor, aralarındaki uyumsuzluk giderildi.
- Geri alma artık bağlı öğün ilişkisini de geri yazıyor; yazma açıksa Health
  kopyası yeniden oluşturuluyor.
- Bir kaydın otomatik sonucu olan tokluk sayacı, kayıt silinince biter. Sayacın
  kalıcı durumu tamamen zamandan ibaretti ve hiçbir yerinde öğün kimliği
  taşımıyordu, bu yüzden öğünü silmek sayaca ulaşamıyordu. Kendi elinizle
  kurduğunuz sayaç hiçbir silmeden etkilenmez. Geri alma sayacı aynı çapa ve
  aynı süreyle geri getirir, süresi bu arada dolduysa getirmez.
- Bir öğün şablonundan kaydedilen yemek silinince şablonun kullanım sayacı
  düşer ve son kullanım tarihi kalan kayıtlardan yeniden hesaplanır.
- Kontrol panelinde enjeksiyon ve ilaç satırına dokunmak düzenleme ekranını
  açıyor. Panonun kendi ölü kopyaları vardı ve gerçek olanlar hiç
  yerleştirilmemişti, yani dokunuş sessizce hiçbir şey yapmıyordu. Şeker
  düzenleme ekranındaki Sil de artık panoda görünüyor.

### Çift kayıt doğrulaması
- Tek katman (`lib/entryGuard.ts`): bazal 6 saat, bolus 90 dakika, glukoz
  10 dakika, aynı yemek 30 dakika, çalışan sayaç varken yeni sayaç, ileri
  tarihli kayıt +5 dakika.
- Onay nötr ve olgusaldır, tıbbi hüküm içermez; kapatılamaz ama tek dokunuşla
  geçilir. Enjeksiyon ekranındaki eski çift bolus onayı bu katmana taşındı; doz
  makullüğü ve nokta tekrarı kontrolleri yerinde kaldı.

### Widget'lar
- Yeni tek amaçlı widget'lar: son okuma, şeker gir, yemek gir, insülin gir,
  tokluk sayacını başlat. Kilit ekranı için accessoryCircular,
  accessoryRectangular ve accessoryInline.
- iOS 18 Kontrol Merkezi: şeker gir ve sayacı başlat. Dağıtım hedefi 16.4
  kaldı, tamamı sürüm kapısının arkasında.
- Mevcut widget'ların kind, aile ve görünümleri değişmedi.
- İnsülin widget'ı artık enjeksiyon ekranının vücut haritasını açıyor, kaydet
  formunu değil: widget dokunuşu geldiğinde henüz bölge seçilmemiştir.
- Dil değiştirildiğinde widget anlık görüntüsü yeniden yazılıyor. Daha önce
  yazılmadığı için kilit ekranı eski dilde kalıyordu.
- Android'e üç yeni ana ekran widget'ı eklendi: şeker gir, yemek gir, tokluk
  sayacı. Küçük son okuma widget'ı zaten vardı, üçü onun yanına katılıyor;
  Android'de kilit ekranı ailesi yok.
- "Tanı yok" modunda insülin widget'ı nötr bir hâle düşer, insülin sözcüğü
  hiçbir yüzeyde basılmaz.

### Diğer
- Alarm izni artık bildirim izniyle aynı yerde, kalıcı bir satır olarak duruyor.
  Kurulumda reddeden kullanıcının izni geri açacak keşfedilebilir bir yeri yoktu:
  eski ipuçları yalnız bir alarm tercihi zaten açıkken görünüyordu, hiç alarm
  kurmamış kullanıcı hiçbirini göremiyordu. iOS reddedilmiş bir izin için ikinci
  kez istem göstermediğinden satır o durumda doğrudan sistem ayarlarına götürür
  ve bunu açıkça söyler. Ekran öne geldiğinde durum yeniden okunur.
- Alarm turunda, sistem alarmının durdurulmazsa kendiliğinden susacağı açıkça
  yazıyor.
- "Tanı yok" moduna geçen kullanıcının geçmiş insülin özeti İçgörüler'de artık
  kaybolmuyor; mod değişimi bir görünürlük kararıdır, kayıt silinmez.
- Şema v22: profil ve enjeksiyon tablolarında yeni sütunlar, `sugar_logs`
  `period_tag` kısıtı `unset` değerini kabul edecek şekilde yeniden kuruldu.
- Gizlilik manifestosu `app.json` içine taşındı (`expo.ios.privacyManifests`).
  `/ios` prebuild çıktısı olduğundan oradaki dosyaya yazılan beyan bir sonraki
  prebuild'de kayboluyordu. Apple Search Ads attribution ve analitik toplama
  beyan edildi; hiçbir sağlık verisi beyan edilmiyor çünkü cihazdan çıkmıyor.
  App Store Connect formu için kontrol listesi `docs/apple-ads/privacy-2.3.1.md`.
- Widget derin bağlantıları için sıcak açılış kancası eklendi
  (`lib/widgetRoute.ts` + kök düzen). Savunmacıdır: uygulama arka plandayken
  gelen bağlantının hedefe ulaşmama gözlemi cihazda kanıtlanamadı, kanca
  yönlendirme zaten çalışıyorsa görünmez kalır.
- Android'de kullanılmayan izinler kaldırıldı: expo-contacts ve expo-camera'nın
  varsayılan eklediği WRITE_CONTACTS ve RECORD_AUDIO izinleri manifestten
  çıkarıldı, uygulama hiçbirini kullanmıyor. USE_EXACT_ALARM izni engellendi;
  mevcut SCHEDULE_EXACT_ALARM zaten yeterli.
- Android'de hatırlatıcılar artık gerçek alarm olarak çalabiliyor: tam ekran,
  sessizdeyken de duyulur, cihaz yeniden başlatılınca geri kurulur. Tam ekran
  bildirim izni çalışma zamanında isteniyor; verilmezse hatırlatıcı sessizce
  kaybolmaz, normal bildirime düşer (`lib/alarmSelect.ts` üçlü AND). Hiçbir alarm
  bir glukoz değerinden, eğilimden veya eşikten tetiklenmez.
- Wear OS için telefon tarafı köprü ve ayrı bir saat uygulaması projesi
  eklendi; saat uygulaması henüz mağazada yayında değil, ayrı bir paket olarak
  yüklenecek.

## Önceki sürümler

2.3.0 ve öncesinin kullanıcıya görünen değişiklikleri
`zerospike-store/aso/<dil>.md` dosyalarındaki **What's New** bloklarında
tutuluyor.
