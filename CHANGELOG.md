# Changelog

Kullanıcıya görünen değişiklikler. Mağaza "yenilikler" metinleri
`zerospike-store/aso/<dil>.md` dosyalarındaki **What's New** alanında, dokuz
dilde tutulur; burada teknik ayrıntı da yer alır.

Sürüm damgası: `app.json` (`version`, `ios.buildNumber`, `android.versionCode`).

## 2.4.0 (build 78 / versionCode 79)

### Tema
- Açık, koyu ve sistem teması; Ayarlar'dan seçilir. Yeni kullanıcıda
  varsayılan açık, mevcut kullanıcıda koyu kalır.
- Token tabanlı tema altyapısı ve `theme:lint` kapısı.
- Widget ve Live Activity açık temaya uyumlu; Wear vurgu dozu.
- Dahili: ekran görüntüsü modunda tema açığa sabit.

### İndirim ekranı (downsell)
- Paywall'da yıllık plan seçiliyken satın alma vazgeçilirse ya da paywall
  kapatılırsa (X, geri, aşağı kaydırma), mağazada gerçek bir indirim varsa
  indirimli teklif aynı oturumda bir kez gösteriliyor. Sonrasında 7 gün bekleme
  ve toplam en fazla 2 gösterim kuralı değişmedi; aynı oturumda ikinci kez
  gösterilmiyor. Eski "iki kapatma + 24 saat" kuralı kaldırıldı.

### Onboarding ve genel
- Yeniden düzenlenen onboarding: sorumluluk reddi son ekrana taşındı;
  titreşim, hareket ve karşılama önizlemeleri eklendi; "Bugün" sekmesi.
- Ayarlar'da Dokunsal geri bildirim anahtarı.
- Varsayılan profil adı artık saklanmıyor (DB v25 migrasyonu).
- Yeni uygulama ikonu ve adaptive katmanlar.
- Yeni vücut haritası: sekme, 4 kademeli ısı, nefes vurgusu.
- Kilit kartlarında deneme bilgisi önbelleği ve sadeleştirilmiş paywall.
- Ayarlar'da değerlendirme satırı ve değerlendirme isteği tetikleyicileri.

### Analitik v2
- Huni olayları, ayrı rıza adımı, haftalık rapor ve SQL görünümleri.
- Sıra: `track` fonksiyonu önce deploy edilir.
- Firebase Analytics ve Crashlytics kaldırıldı; kullanım olayları yalnız
  rızayla kendi sunucumuza, çökme raporu gönderilmez (hata kaydı yalnız
  cihazda tutulur).

### PDF rapor
- Hedef aralık çubuğu ilk sayfada; karşılaştırma bölümü veri yokken gizli.
- Sayfa kırılımı düzeltmeleri: yetim başlık yok, kutular bölünmüyor, boş
  sayfa oluşmuyor.
- "Profil:" satırı yalnız Rapor adı girildiyse yazılır (yeni Ayarlar > Profil
  "Rapor adı" alanı, cihazda saklanır).
- "Tek sayfa özet" dışa aktarma modu.

### Spike ve diğer
- Spike: ana ekran giriş kartı; baloncuk altı not kaldırıldı (ekran üstünde
  tek sabit satır); cevap açılış dili kuralı (sunucu istemi, `ai-ask-spike`
  yeniden deploy gerekir).
- iOS ilk Sağlık içe aktarımı 0 kayıtsa tarafsız not gösterilir.
- Veri ekranı alt metinleri iki satır.
- Enjeksiyon formunda doz uyarısı dokunmadan görünmez.
- Android açık temada kart elevation yerine ince kenarlık.

## 2.3.7 (build 77 / versionCode 78)

### Deneme ve Pro karşılama
- Yeni deneme veya satın alma artık paywall'dan "Pro'ya hoş geldiniz"
  ekranına geçiyor: Health bağlantısı, Insights ve hatırlatıcı adımlarından
  oluşan bir kontrol listesi. Health adımı yalnız Health bağlanabilen
  cihazda görünür. Her adım tamamlandı ya da "şimdi değil" diye kaydedilir;
  tamamlanan adım geri alınmaz. Liste ana ekrandaki deneme kartından ve
  Ayarlar > Uygulama'dan yeniden açılabiliyor.
- Ana ekranda deneme kartı: kalan gün ve açık kalan adım sayısı. Deneme
  bitince ya da ücretli döneme geçilince kendiliğinden kalkıyor.
- Paywall'da zaman çizelgesi: bugün, hatırlatma günü ve ilk ödeme günü.
  Hatırlatma satırı yalnız gerçekten kurulabilecek ve ulaşabilecekse
  gösteriliyor (deneme en az 3 gün, bildirimler açık, izin kalıcı olarak
  reddedilmemiş).
- Paywall'da kişisel satır: kullanıcının elle girdiği son 14 günün ölçüm
  sayısı, ortalaması ve hedef aralıktaki payı. En az 3 ölçüm yoksa gizli;
  Health'ten gelen kayıtlar dahil değil, rakamlar Insights ile aynı hesaptan
  geliyor.
- Deneme bitiş bildirimi değer odaklı ("Günlüğünüz ve içgörüleriniz Pro ile
  devam eder") ve dokunulunca Insights'ı açıyor. Denemenin 1. gününde, Health
  henüz bağlı değilse, tek seferlik bir "Geçmişinizi getirin" hatırlatması
  gidiyor; dokunulunca Health bağlama akışı açılıyor.
- iOS'ta deneme uygunluğu mağazadan doğrulanıyor: hesabın deneme hakkı kesin
  görünmüyorsa (cevap "uygun değil" ya da "bilinmiyor", eksik, hatalı veya 8
  saniyede gelmemiş olsa da) paywall denemeyi vaat etmeden normal fiyatı
  gösteriyor.
- Deneme kararı paywall'da gösterilen tekliften değil, mağazanın cevabından
  okunuyor (`lib/trialSettle.ts`): yeni deneme başladıysa `trial_started`
  bildirilir ve bitiş hatırlatması mağazanın bildirdiği bitiş zamanına göre
  kurulur (mağaza bitiş vermezse gün sayısından hesaplanır); deneme yoksa
  (ücretli dönem, başarısız satın alma) önceki denemeden kalan hatırlatma
  indirilir; zaten sahip olunan yetkinin satın alma sırasında geri bulunması
  yeni deneme sayılmaz ve süren denemenin hatırlatmasına dokunmaz. Geri
  yüklemede de aynı kural: deneme sürüyorsa hatırlatma yerinde kalır,
  denemesiz bir yetki (ömür boyu, ücretli abonelik) geri gelirse eskisi
  indirilir.
- Mağazada otomatik yenilemesi kapatılan deneme ücretli döneme geçmeyecek;
  bu durumda bitiş hatırlatması ve 1. gün hatırlatması indirilir
  (`willRenew` false). Kontrol yetki her okunduğunda (uygulama öne gelince
  dahil) çalışır, yalnız süren bir denemede devreye girer ve uygulama
  kapalıyken yapılan iptali bir sonraki okumada yakalar.
- Mağazaya ulaşılamadığında son bilinen abonelik durumu korunuyor; paywall
  ve Ayarlar > Uygulama'da durumu anlatan, "Satın alımları geri yükle"
  düğmeli bir not çıkıyor. Uygulama öne gelince yetki yeniden okunuyor.

### Onboarding
- Insülin yolu 13 ekrandan 8'e indi (insülin ve hap birlikte 14'ten 9'a,
  yalnız hap 10'dan 8'e, ilaçsız 9'dan 7'ye). Karbonhidrat oranı ve ISF
  ekranları, widget önizlemesi ve ayrı bildirim izni ekranı kalktı; bazal
  saati hatırlatıcı adımının içinde soruluyor.
- Hesaplayıcının iki sayısı (karbonhidrat oranı ve ISF) onboarding yerine
  hesaplayıcı ilk açıldığında tek bir sayfada soruluyor. Yalnız öğün insülini
  kullanan ve henüz kendi onaylı sayısı olmayan profillerde, yeni kayıtta
  açılır; kapatılırsa kendiliğinden bir daha açılmaz. Varsayılan değerle
  devam edilirse sonuç ekranı varsayılanla çalıştığını söylemeye devam
  ediyor. Oranlarını daha önce onaylamış profillere yeni bir şey sorulmuyor.
- Bildirim izni yalnız hatırlatıcı adımında bir plan seçilince isteniyor;
  onboarding'i bitirmek izin diyaloğu açmıyor.
- Kullanım verisi paylaşımı için onboarding'de isteğe bağlı, varsayılan
  kapalı bir anahtar var (Kullanım analitiği bölümüne bak).

### Spike
- Spike artık Amazon Bedrock üzerinde Claude ile çalışıyor (varsayılan
  Sonnet 5.5, AB bölgesi eu-central-1; `SPIKE_MODEL` ve `AWS_REGION` ile
  değişir). OpenAI kaldırıldı.
- İsteğe bağlı 14 günlük günlük özeti: ayrı bir rıza ekranıyla açılır,
  varsayılan kapalı, sohbet sırasında kapatılabilir. Özet cihazda hesaplanır
  (sayılar, ortalamalar, hedef aralık, öğün etiketleri, enjeksiyon bölgeleri,
  kayıt düzeni, diyabet türü, insülin/hap/hiçbiri bilgisi, glukoz birimi);
  tek tek ölçüm, saat, insülin miktarı, serbest metin ve Health'ten gelen
  kayıt içermez. Sunucuda saklanmaz, model eğitiminde kullanılmaz. Rıza
  metinleri alıcıyı ve özetin içeriğini 9 dilde sayıyor.
- Akan yanıt, hızlı sorular, yanıtın altında eylem çipleri ve kaynaklar,
  olumlu/olumsuz geri bildirim.
- Çıktı filtresi her yanıtı 9 dilin kurallarıyla tarıyor; doz sayısı, emir
  ve izin kipi, ilaç miktarı gibi kalıplar yakalanırsa yanıt kullanıcının
  dilinde sabit bir güvenli metinle değişiyor. Filtre akış sırasında da
  uygulanıyor.
- Sınırlar: uygulama ücretsiz kullanıcıya günde 3, Pro'ya 50 mesaj
  gösteriyor; sunucu ayrıca adres başına saatlik ve tüm hizmet için günlük
  tavan uyguluyor (Sunucu bölümü). Ayrıntı: `docs/spike-ai.md` ve
  `supabase/functions/ai-ask-spike/README.md`.

### Kullanım analitiği (isteğe bağlı)
- Kullanım istatistikleri artık onay verilmeden toplanmıyor ve gönderilmiyor.
  Onay üç yerden verilir: onboarding'deki anahtar (varsayılan kapalı), eski
  kurulumlar için ana ekranda bir kez sorulan sayfa ve Ayarlar > Veri ve
  Dışa Aktarım > Gizlilik'teki anahtar. "Şimdi değil" cevapsız bırakır ve
  soru tekrarlanmaz. Eski "varsayılan açık" anahtarda kapatmış olanlar kapalı
  kalır, diğerleri cevapsız sayılıp bir kez sorulur.
- Olaylar cihazdaki bir çıkış kutusunda (`analytics_queue`, SQLite şema v24)
  birikir ve toplu olarak Supabase `track` fonksiyonuna gider; tekrar denenen
  toplu gönderim iki kez yazılmaz. Olay adları ve alanları şema v1 ile
  sınırlı (`lib/analytics/eventSchema.ts` ve sunucudaki ikizi
  `event-schema.json`): sağlık değeri ve serbest metin yok, kayıt türü yalnız
  glucose, meal veya other. `onboarding_done` hiçbir alan taşımıyor (`path`
  ve ardından aynı bilgiyi veren `screens` kaldırıldı). Yalnız insülin
  kullananların üretebildiği iki değer gönderilmeden önce katlanıyor:
  paywall kaynağı `rotation` `feature`, Spike eylemi `open_injection_map`
  `open_feature` oluyor (Firebase da katlanmış değeri görür).
- Kurulum kimliği (rastgele UUID) Ayarlar'da gösteriliyor ve paylaşılabiliyor.
  RevenueCat'e `device_id` attribute'u olarak yalnız analitik açıkken
  gidiyor, kapatınca kaldırılıyor; böylece abonelik olayları kullanım
  olaylarıyla eşleşebiliyor.
- Ayarlar > Veri ve Dışa Aktarım > Gizlilik'te "Sunucu kayıtlarımı sil"
  düğmesi: bu kurulum kimliğine ait olay, Spike sayaç ve günlüğü ile abonelik
  olayı kayıtlarını sunucudan siler. Abonelik olayları kurulum kimliğiyle ya
  da RevenueCat kullanıcı kimliğiyle (`x-rc-app-user-id`) eşleşince gider;
  böylece RevenueCat'e `device_id` konmadan önce veya analitik kapalıyken
  gelenler de silinir. Akış önce yüklemeleri duraklatır ve cihazdaki çıkış
  kutusunu boşaltır, başarıdan sonra kutuyu yeniden boşaltır, Firebase
  Analytics örneğini sıfırlatır (`resetAnalyticsData`) ve yüklemeleri
  sürdürür. Cihazdaki günlüğe ve kurulum kimliğine dokunmaz (yeni kimlik
  günlük Spike hakkını sıfırlardı).
- Anahtarı kapatmak toplamayı durdurur ve cihazdaki çıkış kutusunu boşaltır;
  sunucuya hiçbir olay gitmez (kapatmak için son bir `analytics_opt_out`
  olayı yok, bu olay yalnız anahtar açılınca `enabled: true` ile gider).
- Firebase Analytics otomatik toplaması kapalı (`firebase.json`); yalnız onay
  varken açılıyor. Crashlytics bu anahtarın kapsamı dışında.
- Privacy manifest (`app.json`) güncel; App Privacy ve Data safety cevap
  listesi `docs/apple-ads/privacy-2.3.7.md` içinde.

### Sunucu
- Yeni Edge Function'lar: `track` (olay alımı: şema doğrulama, saatlik
  cihaz ve adres sınırı, günlük üst sınır), `rc-webhook` (RevenueCat
  olaylarını `subscription_events` tablosuna yazar; `Authorization` değeri
  `RC_WEBHOOK_SECRET` ile birebir eşleşmezse 401) ve `delete-device` (bir
  kurulum kimliğinin ve verilmişse RevenueCat kullanıcı kimliğinin sunucudaki
  tüm satırlarını siler, saatlik sınırlı).
  `ai-ask-spike` v2: Bedrock, akış, çıktı filtresi, rıza başlığı, maliyet
  tavanları. `supabase/config.toml`'da üçü için de `verify_jwt = false`.
- Maliyet tavanları model çağrısından önce Postgres'te tek atomik adımda
  uygulanıyor (`spike_reserve`): cihaz başına gün (3 ücretsiz, 50 Pro), adres
  başına saat (60) ve tüm hizmet için gün (3000). Model hatasında cihaz ve
  genel yuva iade edilir; veritabanına ulaşılamazsa istek geçirilmez (503).
- Migration'lar: `20261006094929_app_events` (app_events, track_* sayaçları,
  subscription_events, üç analiz görünümü), `20261006095331_spike_calls`
  (çağrı günlüğü, `purge_spike_logs`),
  `20261006110710_subscription_events_retention`
  (`purge_subscription_events`, `delete_device_data`, `delete_usage`),
  `20261006141500_spike_hardening` (`spike_reserve`, `spike_release`,
  `spike_global_usage`, `spike_ip_usage`),
  `20261006143000_delete_device_data_v2` (`delete_device_data_v2`: kurulum
  kimliği veya RevenueCat kimliği; `delete-device` dağıtımından önce itilir,
  yoksa fonksiyon 503 verir) ve `20261006143100_cron_enable` (pg_cron'u açar,
  üç temizleme işini kurar). Tüm tablolarda RLS açık, anon ve
  authenticated erişimi kapalı; public şemasında yeni tablolara varsayılan
  erişim verilmesi de kapatıldı.
- Saklama süreleri: `app_events` 180 gün (`track_batches` 30 gün, sayaçlar 2
  gün), `spike_usage`, `spike_calls` ve `spike_global_usage` 90 gün,
  `subscription_events` satırları 24 ay ve ham webhook gövdesi (`raw`) 90 gün.
  Üç günlük temizleme işi (`purge-app-events`, `purge-spike-logs`,
  `purge-subscription-events`) `20261006143100_cron_enable` migration'ıyla
  kuruluyor: migration pg_cron eklentisini açar, işleri yeniden zamanlar
  (eski `spike-logs-retention` adı kalkar) ve eklenti açılamazsa push'u
  durdurur; saklama süreleri sessizce işlemez durumda kalamaz. Önceki
  migration'lar eklentiyi açmaz, yalnız zaten açıksa iş kurardı.
- İstemci IP adresi hiçbir tabloya yazılmıyor; adres başına sınırlar anahtarlı
  özetlerle sayılıyor ve özetler en çok 2 gün tutuluyor.

### Mağaza ve site
- App Store ve Google Play metinleri 9 dilde 2.3.7 için yenilendi
  (promosyon metni, anahtar kelimeler, açıklama, Play kısa ve uzun
  açıklama), What's New 2.3.7 ve üç özel ürün sayfası (CPP: kan şekeri
  günlüğü, enjeksiyon rotasyonu, karbonhidrat takibi) hazır. Mağaza dosyaları
  git dışında (`zerospike-store/`).
- Site görselleri mağaza panellerinden `scripts/site-shots.sh` ile
  üretiliyor; site sayfaları ve legal metinler (9 dilde gizlilik politikası
  dahil) bu depoda değil, greeneyeapp-site deposunda.
- Gizlilik beyanı: App Store Connect App Privacy ve Google Play Data safety
  için kesin cevap listesi `docs/apple-ads/privacy-2.3.7.md` içinde; cevaplar
  konsola elle girilir.
- Apple Ads: ZS-US-Test kampanyası (14 gün, günlük 3,50 USD, 13 anahtar
  kelime, 70 negatif) kurulum betiğiyle PAUSED oluşturuluyor ve release
  gününde açılıyor. Salt okunur rapor betiği `scripts/apple-ads-report.mjs`
  eklendi. Komutlar `scripts/apple-ads-README.md` içinde.

### Testler ve kapılar
- Yeni test paketleri (`scripts/`; koşma komutu her dosyanın başlığında):
  `analyticsConsent` (üç durumlu rıza, eski anahtardan geçiş, panodaki sayfa
  kuralı, kayıt türlerinin glucose/meal/other'a ve insülin kullanıcısını ele
  veren değerlerin (`rotation`, `open_injection_map`) nötr adlara katlanması,
  "Sunucu kayıtlarımı sil" akışı ve sırası, gerçek sink'lerle kapatınca
  sunucuya hiçbir şey gitmediğinin ağ, çıkış kutusu ve Firebase
  çağrılarından okunması, ekran bağlantıları), `analyticsSchema`
  (olay şeması v1 ile sunucudaki ikizinin birebir eşleşmesi, temizleyici,
  oturum, toplu gönderim ve yeniden deneme, `analytics_queue` SQL'i),
  `eventCallsites` (koddaki her `logEvent` çağrısının şemaya karşı statik
  denetimi; her `log_added` çağrısı `noteFirstLog` çağırır), `spikeContext`
  (14 günlük özet paketi, ikinci rıza, istek ve akış protokolü),
  `purchasesBehavior` (`purchases.ts` uçtan uca: başarısız mağaza okumasının
  önbelleğe dokunmaması, tek "yetki kaybı" raporu, iOS deneme uygunluğu,
  satın alma sonrası deneme kararı ve eski hatırlatmanın indirilmesi,
  mağazada iptal edilen denemenin hatırlatmasının inmesi, RevenueCat
  `device_id`'nin analitik anahtarını izlemesi), `trialSettle` (mağazanın
  cevabını paywall eylemine çeviren tablo: `trial_started`, bitiş
  hatırlatması ve zamanı, eski hatırlatmanın indirilmesi; paywall'ın bu
  tabloya bağlı kalması), `trialTimeline`
  (paywall zaman çizelgesi, hatırlatma ucu ve teslim kapısı, 24 saatlik
  Health bildirimi, kişisel satır, hatırlatma başlığı 9 dilde),
  `proWelcome` (kontrol listesi durumu ve adımı bildiren servis),
  `onboardingSteps` (yol başına ekran sayıları ve sırası, alansız
  `onboarding_done`, hesaplayıcı ilk kullanım sayfası).
- `supabase/functions/ai-ask-spike/filter.test.ts` (Deno, ağ ve model
  gerekmez): çıktı filtresi ve yanıt ayrıştırma; kurallara her dokunuşta
  `BLOCKED` ve `ALLOWED` listelerine satır eklenir.
- `scripts/migration.test.ts` v24 (`analytics_queue`) kapsamıyla genişledi;
  `scripts/profileScopedKeys.test.ts` ve `lib/profileScopedKeys.ts`
  `zerospike.calcSetupDismissed` anahtarını profil silinince süpürüyor.
- `npm run reg:check` (ve onu içeren `npm run i18n:check`) artık yerel mağaza
  kopyasını da tarıyor (`zerospike-store/aso`, `aso-android`, en yeni
  `whats-new`); klasör git dışında olduğu için CI'da sessizce atlanır.

## 2.3.6 (build 75 / versionCode 76, eas autoIncrement sonrasi)

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
