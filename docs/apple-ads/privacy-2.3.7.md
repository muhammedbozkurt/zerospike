# 2.3.7 gizlilik beyanı: App Store Connect App Privacy ve Google Play Data safety

> **2.4.x ve sonrası için bayat.** Bu belge 2.3.7 içindir. Güncel mağaza beyanı için `scratchpad/hub-beyan-*.md` dosyalarına bakın; buradaki cevapları 2.4.x veya 2.5.0 formlarına kopyalamayın.

Bu dosya, 2.3.7 için iki mağaza formunda değişmesi gereken cevapların kesin listesidir.
Konsola kullanıcı elle girer. §3'teki privacy manifest bloğu `app.json`'a uygulandı (birebir
eşleştiği 2026-10-06'da karşılaştırıldı); §6'daki metinler hâlâ yalnız öneridir (uygulanmadı).

Taban çizgisi: Apple için `docs/apple-ads/privacy-2.3.1.md`, Play için
`zerospike-store/PLAY-HEALTH-DECLARATION-EN.md` §6. Her cevabın gerekçesi Apple veya Google'ın
kendi tanımından alıntıdır (resmi sayfalar 2026-10-06'da okundu, kaynaklar §10).
Hub maddeleri: ASC §2, manifest §3, Play §4, politika URL'si §5, konsol adımları §8.

Sayım (2.3.1'e göre): Apple tarafında 9 satırdan 8'i değişti (3 yeni, 5 güncellendi, 1 aynı).
Play tarafında 2 satır kesin değişti (Health info güncellendi, Messages yeni), 4 satır konsolda
doğrulanacak (taban çizgisinde tür beyanlı, ayrıntısı repoda yok).

Kod durumu (okuma anı, 2026-10-06): `track`, `rc-webhook` ve `delete-device` fonksiyonları,
`app_events`, `spike_calls`, `subscription_events_retention`, `spike_hardening`,
`delete_device_data_v2` ve `cron_enable` göçleri, opt-in
analitik (rıza durumu, onboarding anahtarı, panodaki tek seferlik sayfa, Ayarlar anahtarı ve
"Sunucu kayıtlarımı sil" düğmesi), `lib/ai/spikeContext.ts` (özet paketi) ve testi, Spike istemci
v2, `purchases.ts` içindeki `device_id` attribute'u (yalnız analitik açıkken) ve Spike
sunucusunun Bedrock geçişi (`ai-ask-spike/bedrock.ts`) çalışma ağacında. Dosyalar başka
ajanlarca hâlâ değişebilir; bu belge okuma anındaki hâle göredir.

## 0. Karar ve durum özeti (beş madde)

**0.1 Bedrock modeli ve saklama.** Spike sunucusu Bedrock'ta: varsayılan model
`anthropic.claude-sonnet-5-5` (`SPIKE_MODEL` ile değişir), varsayılan bölge `eu-central-1`
(`AWS_REGION` ile değişir). "Sunucuda saklanmaz" cümlesi modele bağlıdır. AWS: "by default,
Amazon Bedrock does not store model inputs or outputs." İstisna: "For Anthropic Claude Fable 5
and Claude Fable 5.1, all traffic will be retained for up to 30 days for automated offline abuse
detection. Classifier-flagged traffic will be subject to potential human review performed by
AWS." Sonnet 5.5 bu listede yok, cümle geçerli. İki kural:
- `SPIKE_MODEL` Fable 5 veya 5.1'e çevrilirse cümle yanlış olur: `ctxPromise` ("Not stored on
  our server") yalnız "bizim sunucu" için doğru kalır, rıza metni ve politika 30 günü
  söylemeli, Play'de Ephemeral zaten No, Apple'da Health ve Other User Content zaten beyanlı.
- Kesin kanıtı AWS verir: `curl https://bedrock-mantle.eu-central-1.api.aws/v1/models/anthropic.claude-sonnet-5-5 -H "x-api-key: $BEDROCK_API_KEY"`
  (Bedrock API anahtarı konsoldan üretilir) yanıtında `data_retention.allowed_modes` içinde
  `none` olmalı. AWS: "If a model's
  `allowed_modes` includes `none`, we won't persist anything."
Kodun tarafı temiz: istem önbelleği yalnız sabit sistem istemini kapsar (`cache_control` yalnız
ilk sistem bloğunda; özet ve mesajlar sonrasında), `logUpstream` yalnız durum kodu ve hata
sınıfını yazar. Anthropic'e erişim yok: "Because the model providers don't have access to those
accounts, they don't have access to Amazon Bedrock logs or to customer prompts and
completions." Kalan hesap ayarı: model invocation logging kapalı olmalı (§7).

**0.2 Silme ve saklama.** Sunucuda kalıcı veri var; kullanıcıya özel silme yolu mevcut (aşağıda)
ve her tabloya bir saklama süresi konmuş durumda.

| Tablo | İçerik | Saklama |
|---|---|---|
| `app_events` | olay adı, props, zarf alanları, device_id (yalnız analitik açıkken) | 180 gün (`purge_app_events`) |
| `track_batches` | device_id, batch_id | 30 gün (aynı iş) |
| `track_usage` | device_id, saat, sayaçlar | 2 gün (aynı iş) |
| `spike_usage` | device_id, gün, sayaç | 90 gün (`purge_spike_logs`) |
| `spike_calls` | device_id, gün, model, token, gecikme, filtre | 90 gün (aynı iş) |
| `spike_reject_usage` | saat, ret nedeni (ip, device, global), tavan, ret sayısı; kimlik, IP özeti ve metin yok | 90 gün (`purge_spike_logs`) |
| `subscription_events` | RC olayı, device_id (yalnız analitik açıkken), app_user_id, ülke, fiyat, kampanya alanları | satırlar 24 ay, ham gövde (`raw`) 90 gün (`purge_subscription_events`) |

Kimlik taşımayan sayaçlar da silinir: `track_ip_usage`, `spike_ip_usage` ve `delete_usage`
(anahtarlı IP ve cihaz özetleri) 2 gün, `track_global_usage` 30 gün, `spike_global_usage` 90 gün.
İstemci IP adresi hiçbir tabloya yazılmaz.

Üç temizleme işi (`purge-app-events` ve `purge-spike-logs` her gün 03:17 UTC,
`purge-subscription-events` 03:27 UTC) `20261006143100_cron_enable` göçüyle kurulur: göç pg_cron
eklentisini açar, aynı adlı işleri ve eski `spike-logs-retention` adını kaldırıp üçünü yeniden
zamanlar; eklenti açılamazsa hata verir ve push durur, saklama süreleri sessizce işlemez
kalamaz (kontrol §7, komut 6). Önceki göçler eklentiyi açmazdı, yalnız zaten açıksa iş kurardı.
Analitik anahtarını kapatmak yeni toplamayı durdurur ve cihazdaki çıkış kutusunu boşaltır;
sunucuya hiçbir olay gitmez (kapatmak için son bir `analytics_opt_out` olayı yok, o olay yalnız
anahtar açılınca `enabled: true` ile gider). Sunucudaki geçmiş satırlara dokunmaz, onlar için
silme yolu var:
- **Mevcut silme yolu.** Ayarlar > Veri ve Dışa Aktarım > Gizlilik > "Sunucu kayıtlarımı sil":
  önce yüklemeleri duraklatır (yoldaki toplu gönderim bitene kadar beklenir) ve cihazdaki çıkış
  kutusunu boşaltır, sonra `delete-device` fonksiyonunu kurulum kimliğiyle (`x-device-id`) ve
  varsa RevenueCat uygulama kullanıcı kimliğiyle (`x-rc-app-user-id`) çağırır; başarıdan sonra
  çıkış kutusunu yeniden boşaltır, Firebase'e uygulama örneğini ve onun altında topladığını
  unutturur (`resetAnalyticsData`; sonraki olay, anahtar açıksa, yeni örnekle başlar) ve sonuç ne
  olursa olsun yüklemeleri sürdürür. Fonksiyon `delete_device_data_v2` RPC'siyle tek işlemde
  `app_events`, `track_batches`, `track_usage`, `spike_usage` ve `spike_calls` satırlarını bu
  kurulum kimliğine göre, `subscription_events` satırlarını ise kurulum kimliği (`device_id`)
  VEYA RevenueCat kimliği (`app_user_id` ya da `original_app_user_id`) eşleşince siler. İkinci
  yol, politikadaki e-posta: support@greeneyeapp.com adresine Ayarlar'da gösterilen kurulum
  kimliğiyle yazmak.
- Sınırlar: (1) cihazdaki günlüğe ve analitik anahtarına dokunmaz; (2) kurulum kimliği silme
  sonrası yenilenmez (bilerek: yeni kimlik günlük Spike hakkını sıfırlardı; `delete-device`
  başlığı ve `lib/analytics/serverRecords.ts` aynı şeyi söyler), anahtar açıksa yeni olaylar aynı
  kimlikle birikir; (3) RevenueCat'in, mağazaların ve Firebase'in kendi kayıtları bu yolun dışında
  (Firebase'e yalnız `resetAnalyticsData` çağrılır);
  (4) RevenueCat kimliği gönderilemezse (SDK yok, henüz yapılandırılmamış, 3 saniyede yanıt
  vermedi veya kimlik biçimi uymadı) fonksiyon yalnız kurulum kimliğiyle siler; o durumda
  `device_id` taşımayan abonelik olayları (attribute'tan önce veya analitik kapalıyken gelenler)
  silinmez, 24 ayda kendiliğinden gider; (5) yeniden kurulum yeni kimlik üretir, eski kimliğin
  satırlarına düğme ulaşamaz, onlar saklama süresiyle silinir.
- Apple 5.1.1(i): politika "Explain its data retention/deletion policies and describe how a user
  can revoke consent and/or request deletion of the user's data" demelidir. Politika bölüm 7 ve
  13 rıza geri çekmeyi, saklama sürelerini (180 gün, 90 gün, 24 ay) ve e-posta ile silme
  talebini anlatıyor; uygulama içi düğme metinde henüz geçmiyor (§5).
- Google (silme rozeti): "provide users with a mechanism to request data deletion; or
  automatically initiate deletion or anonymization of collected data within 90 days of
  collection". Mekanizma var (düğme ve e-posta), bu yüzden Play deletion cevabı Yes (§4.1);
  180 gün ve 24 ay saklama ikinci yolu (90 günde otomatik silme) tutmaz, birinci yol yeter.

**0.3 Rıza metni (kapandı).** Özet paketi `profile.diabetes` (type1, type2, gestational,
prediabetes, none, unknown) ve `profile.treatment` (insulin, pills, none) alanlarını da
gönderiyor (`lib/ai/spikeContext.ts`, ContextPacket.profile). Rıza ekranının `spike.ctxShared5`
satırı ("Profile details: diabetes type, insulin or pills (or neither), glucose unit and target
range") bunları artık sayıyor; 9 dilin hepsinde var (Apple 5.1.2(i): "You must clearly disclose
where personal data will be shared with third parties, including with third-party AI, and obtain
explicit permission before doing so."). Alıcı satırları (`spike.consentRecipient`,
`spike.ctxRecipient`) 9 dilde "Amazon Web Services (Amazon Bedrock) üzerindeki Anthropic Claude
modelleri, AB bölgesi" diyor; OpenAI ifadesi locale dosyalarından kalktı. Kontrol:
`grep -c "ctxShared5" lib/i18n/locales/*.ts` her dosyada 1, `grep -ci openai lib/i18n/locales/*.ts`
her dosyada 0 vermeli.

**0.4 Çelişen mevcut metinler (2.3.7 ile yanlış olurdu).** Durum: ilk üç madde kapandı, kalanlar açık.
- Uygulama içi (9 dil): `settings.healthOnDeviceBody`, `paywall.legalNote` ve
  `downsell.fallbackSubtitle` 2.3.7 gerçeğine göre düzeltildi ("Your journal stays on your
  device" çerçevesi; sağlık verisi, isteğe bağlı Spike özeti ve kullanım analitiği ayrı söylenir).
  Kontrol (9 dilde okundu, komut en için): `grep -n -i "no server to send\|data stays on your device"
  lib/i18n/locales/en.ts` boş.
- Mağaza metinleri: "No account, no cloud; every record stays on your phone" ifadesi 9 dilde de
  kalktı; kontrol komutu yalnız yükleme kaynağı olmayan dosyalarda eşleşir
  (`aso/aso-2.3.0-research.md`, `aso/CHANGES-2.3.7.md`, `aso/release-2.3.3.md`). Kontrol:
  `grep -il -E 'cloud|bulut|nuvol|nuvem|سحاب|クラウド' zerospike-store/aso/*.md zerospike-store/aso-android/*.md`.
- "Anonymous" sözcüğü: analitik kalıcı kurulum UUID'sine bağlı ve (analitik açıkken) abonelik
  olaylarıyla birleşiyor (§2.2); bu anonim değil, takma adlıdır. Uygulama metinleri artık
  "random installation ID, not linked to your name or account" diyor (`settings.analytics.hint`,
  `spike.consentDeviceId`); 9 locale dosyasında ve 18 mağaza dosyasında (`aso/` ve `aso-android/`,
  9 dil) anonim, anonymous, anonyme, 匿名 ailesinden sözcük kalmadı; politika da "random install
  identifier" diyor. Seçenek B (§2.6) uygulanırsa "anonymous" doğru olur.
- İnceleme notları: "nothing is uploaded", "Nothing leaves the device otherwise"
  (`aso/review-notes-en-2.3.5.md:5,40`); 2.3.7 notu yeni yazılmalı (§6.2).
- Play beyanı: `PLAY-HEALTH-DECLARATION-EN.md:42-50, 62-70, 72-74, 165-168` (§4.6, §6.1).
- Gizlilik politikası: 9 dilde 6 Ekim 2026 tarihli ve 2.3.7 içeriğiyle güncel (§5); uygulama içi
  silme düğmesi metinde henüz yok.

**0.5 Linked kararı.** Aşağıdaki tablo (A seçeneği) kurulum kimliği satırlara bağlı kaldığı için
(analitik ve abonelik satırlarında analitik açıkken, Spike satırlarında Spike kullanılınca)
Linked = Yes der. Linked'i düşürmenin tek yolu veri tasarımıdır (§2.6). Bu dosya A'ya göre
yazıldı.

## 1. Apple'ın dört tanımı (App Privacy details)

- **Collect:** "'Collect' refers to transmitting data off the device in a way that allows you
  and/or your third-party partners to access it for a period longer than what is necessary to
  service the transmitted request in real time." Ek rehber: "if data is sent to your servers
  then immediately discarded after servicing the request, you do not need to disclose this in
  your answers in App Store Connect."
- **Linked:** "You'll need to identify whether each data type is linked to the user's identity
  (via their account, device, or other details) by you and/or your third-party partners."
  Bağsız kalmanın koşulu: kimlik alanlarını toplamadan önce sıyırmak ve "You must not tie the
  data to other datasets that enable it to be linked to a particular user's identity."
- **Tracking:** "linking data collected from your app about a particular end-user or device,
  such as a user ID, device ID, or profile, with Third-Party Data for targeted advertising or
  advertising measurement purposes, or sharing data collected from your app about a particular
  end-user or device with a data broker."
- **Optional disclosure** (dört koşulun hepsi): kullanım takip değil; reklam veya "Other
  Purposes" değil; "Collection of the data occurs only in infrequent cases that are not part of
  your app's primary functionality, and which are optional for the user"; ve "the user's name
  or account name is prominently displayed in the submission form alongside the other data
  elements being submitted, and the user affirmatively chooses to provide the data for
  collection each time."

## 2. App Store Connect > App Privacy

### 2.1 Cevap tablosu (Edit > Data Types, 9 kutu)

| # | Veri türü (ASC yolu) | Collected | Linked | Tracking | Purposes | 2.3.1'e göre |
|---|---|---|---|---|---|---|
| 1 | Health & Fitness > Health | Yes | Yes | No | Analytics, App Functionality, Product Personalization | YENİ |
| 2 | User Content > Other User Content | Yes | No | No | App Functionality | YENİ |
| 3 | Purchases > Purchase History | Yes | Yes | No | App Functionality, Analytics | DEĞİŞTİ: Linked No -> Yes |
| 4 | Usage Data > Product Interaction | Yes | Yes | No | Analytics, App Functionality | DEĞİŞTİ: Linked No -> Yes, + App Functionality |
| 5 | Usage Data > Advertising Data | Yes | Yes | No | Developer's Advertising or Marketing, Analytics | DEĞİŞTİ: Linked No -> Yes |
| 6 | Identifiers > Device ID | Yes | Yes | No | Analytics, App Functionality | DEĞİŞTİ: Linked No -> Yes, + App Functionality |
| 7 | Diagnostics > Performance Data | Yes | Yes | No | Analytics, App Functionality | YENİ |
| 8 | Diagnostics > Other Diagnostic Data | Yes | Yes | No | App Functionality, Analytics | DEĞİŞTİ: Linked No -> Yes, + Analytics |
| 9 | Diagnostics > Crash Data | Yes | No | No | App Functionality | AYNI |

"Third-Party Advertising" hiçbir satırda seçilmez. "Data Used to Track You" boş kalır.
İşaretlenmeyecekler (2.3.1 ile aynı, ek gerekçe §2.5): Identifiers > User ID, Contact Info
(tümü), Contacts, Location (tümü), Sensitive Info, Financial Info, Fitness, Photos or Videos,
Search History, Browsing History, Usage Data > Other Usage Data, Other Data Types.

Etiket kartı önizlemesi: "Data Linked to You": Health & Fitness, Purchases, Usage Data,
Identifiers, Diagnostics. "Data Not Linked to You": User Content, Diagnostics (Crash Data).

### 2.2 Gerekçeler (satır numaraları tabloya karşılık gelir)

**Linked için tek kural.** Birinci taraf depo (`app_events`, `subscription_events`, `spike_usage`,
`spike_calls`) her satırı kurulum UUID'sine bağlar. Analitik satırları ve iki depoyu birleştiren
RC `device_id` attribute'u yalnız analitik açıkken oluşur; Spike satırları Spike kullanımıyla.
Apple'ın Linked tanımı "via their account, device, or other details" dediği için, bu depoda
bulunan her tür Linked Yes'tir. Yalnız Crashlytics'in tuttuğu Crash Data bağsız kalır (UUID
eklenmiyor, `setUserId` yok).

1. **Health.** Apple: "Health and medical data, including but not limited to data from the
   Clinical Health Records API, HealthKit API, ... or any other user provided health or medical
   data." 2.3.7'de Health yalnız Spike özeti için "collected" sayılır: kullanıcının kendi
   girdiği ölçümlerden cihazda hesaplanan 14 günlük özet (sayılar, ortalamalar, hedef aralık,
   öğün etiketleri, enjeksiyon bölgeleri, kayıt düzeni; `profile.diabetes` ve
   `profile.treatment` ile diyabet türü ve insülin, hap veya hiçbiri bilgisi), ayrı rızayla ve
   varsayılan kapalı gider (§2.3). Analitik artık sağlık bilgisi taşımaz: `onboarding_done` hiçbir
   alan taşımaz (önce `path`, sonra aynı bilgiyi veren `screens` kaldırıldı), `first_log` /
   `log_added` / `log_edited` `.kind` alanı yalnız glucose, meal veya other olur ve yalnız insülin
   kullananların üretebildiği iki değer gönderilmeden önce nötr adlara katlanır: paywall
   olaylarının (`paywall_view`, `paywall_dismiss`, `purchase_completed`) `source` ve
   `paywall_view.context` değeri `rotation` (enjeksiyon sekmesinin girişi) `feature`,
   `spike_action_tap.action` değeri `open_injection_map` `open_feature` olur
   (`lib/analytics/eventSchema.ts` `FOLDED_VALUES`; `logEvent` bunu her sinkten önce uygular,
   Firebase da katlanmış değeri görür; alan listesinin sunucudaki ikizi
   `supabase/functions/_shared/event-schema.json`). Bunlar hangi tür girdi yapıldığını söyler;
   ölçüm değeri, insülin veya hap kullanımı söylemez, bu yüzden Product Interaction'a girer.
   Linked Yes: özet, kurulum kimliğini taşıyan aynı istekte gider (`x-device-id`), aynı kimlik
   `spike_usage` ile `spike_calls` satırlarını anahtarlar ve `spike_message_sent.has_context`
   olayı (analitik açıksa) özetin paylaşıldığını kimlikle birlikte `app_events`'e yazar. Özetin
   kendisi saklanmaz, ama bu §0.1 ve §7 kontrollerine bağlıdır; biri düşerse özet kimlikli
   saklanmış olur. Satır 2'deki sohbet metni için aynı risk "No"da bırakıldı (serbest metin,
   sağlık yapısı yok); Health'te yanlış "No" daha pahalı olduğundan Yes seçildi. Amaçlar: App
   Functionality (özet Spike'ı çalıştırır), Product Personalization (Apple: "Customizing what the
   user sees, such as a list of recommended products, posts, or suggestions": yanıtlar özete
   göre şekillenir). Analytics amacı: şema artık sağlık değeri veya ilaç kullanımı taşımıyor;
   geriye yalnız özetin paylaşılıp paylaşılmadığını sayan olaylar kaldı
   (`spike_context_consent.granted`, `spike_message_sent.has_context`), bunlar sağlık verisinin
   kendisi değil kullanım olgusu. Kutu `app.json` manifestiyle tutarlı kalsın diye işaretli
   bırakıldı (fazla beyanın cezası yok, §2.3); daraltmak isterseniz ASC'de bu satırdan
   Analytics'i kaldırın ve bir sonraki build'de manifestten de çıkarın (`app.json`, bir satır).
2. **Other User Content.** Apple: "Any other user-generated content." Spike sohbet metni.
   Tasarım gereği saklanmıyor (`ai-ask-spike/index.ts` başlığı: özet "never logged and never
   written to a table"; mesajlar yalnız istek içinde), yani Apple'ın "collect" tanımının dışında
   kalabilir; yine de beyan edilir (§2.3). Linked No: Spike isteğinden geriye kalan satırlar
   (`spike_usage`, `spike_calls`) içerik taşımaz. Herhangi bir günlük gövdeyi device_id ile
   birlikte tutarsa Yes olur.
3. **Purchase History.** Apple: "An account's or individual's purchases or purchase
   tendencies." `subscription_events` ürün, dönem tipi, mağaza, ülke, fiyat, para birimi,
   zamanlar, iptal nedeni ve RC `app_user_id` tutar. Kurulum kimliği RevenueCat'e `device_id`
   attribute'u olarak yalnız analitik açıkken gider (`lib/services/purchases.ts`
   `attachDeviceId`; anahtar kapanınca attribute `null` ile silinir, açılınca yeniden yazılır);
   o kullanıcıların satırları `app_events.device_id` ile birleşir (`v_trial_cohort` ve
   `v_pre_cancel_events` görünümleri, göç dosyası). Analitik kapalıyken satırda yalnız RC'nin
   kendi `app_user_id`'si kalır. Linked yine Yes: form türün tamamını sorar ve analitiği açan
   kullanıcılar için birleşme vardır. RC'nin kendi rehberi anonim kimlikte "No" der ("If you are
   using RevenueCat's anonymous app user ID's, and do not have a way to identify individual
   users, you can select 'No'"); birleştirilebilir device_id eklenebildiği için o koşul geçerli
   değil.
4. **Product Interaction.** Apple: "such as app launches, taps, clicks, scrolling information
   ... or other information about how the user interacts with the app." Olay adları,
   `app_open`, oturum kimliği (yalnız analitik açıkken), Spike mesaj sayaçları (`spike_usage`,
   `spike_calls`; Spike kullanılınca). App Functionality: günlük mesaj sınırı ve `track_usage`
   giriş sınırı.
5. **Advertising Data.** Apple: "Such as information about the advertisements the user has
   seen." `_shared/rc-event.ts` `KEPT_RESERVED_ATTRIBUTES` ile `$mediaSource`, `$campaign`,
   `$adGroup`, `$ad`, `$keyword`, `$creative` değerlerini `subscription_events.raw` içinde
   saklar; analitik açıksa satır device_id'yi de taşır. `raw` 90 gün sonra boşaltılır
   (`purge_subscription_events`). Amaçlar 2.3.1 ile aynı (kendi kampanyamızı ölçmek).
6. **Device ID.** Apple: "Such as the device's advertising identifier, or other device-level
   ID." Kurulum UUID'si: bkz. §2.4.
7. **Performance Data.** Apple: "Such as launch time, hang rate, or energy use." `spike_reply`
   olayındaki `latency_ms` (yalnız analitik açıkken) ve sunucudaki `spike_calls.latency_ms`
   (yanıt süresi, hizmet izleme; Spike kullanılınca) device_id ile saklanır. Her iki kaynak
   şemadan çıkarılırsa bu kutu kalkar.
8. **Other Diagnostic Data.** Apple: "Any other data collected for the purposes of measuring
   technical diagnostics related to the app." Zarf alanları (`app_version`, `build`, `platform`,
   `os_version`, `locale`, `tz_offset`; yalnız analitik açıkken) ve `spike_calls` (model, token
   sayıları, `filtered`, `filter_rule`) device_id ile saklanır; Crashlytics'in cihaz ve işletim
   sistemi bilgisi bu türü 2.3.1'den beri forma koymuştu. Tür tek cevap alır: ilk taraf depo
   Linked ve Analytics ekler.
9. **Crash Data.** Apple: "Such as crash logs." Yalnız Crashlytics; kurulum UUID'si crash
   kaydına eklenmiyor (`logCrash` bağlamı Firebase'e ulaşmıyor, 2.3.1 §5). Değişmez.

**Tracking = No (tüm satırlar).** Kaynak: yukarıdaki Tracking tanımı: üçüncü taraf verisiyle
reklam amaçlı eşleştirme ve veri simsarına verme yok. Supabase, AWS, RevenueCat ve Firebase
bizim adımıza işleyen sağlayıcılar. Apple Ads atıf verisi 2.3.1 §4'teki gerekçeyle takip
sayılmıyor (ATT yok). Yeni olgu: kampanya alanları artık kendi veritabanımızda duruyor
(`subscription_events.raw`, 90 gün) ve analitik açıkken device_id'nin yanında; bu "No"yu bozmaz
ama formdaki en hassas "No"dur. Koşullar: Firebase'de Google signals kapalı ve Google Ads bağlı
değil; RC > Integrations yalnız Apple Search Ads ve bizim webhook; kampanya alanları hiçbir
üçüncü tarafa iletilmiyor.

### 2.3 Spike özetinin isteğe bağlı olması beyanı değiştirir mi

İsteğe bağlı olması Apple'da beyanı kaldırmaz: istisna dört koşulun hepsini ister (§1) ve özet
üçüncü ile dördüncü koşulu geçemez. Özet, bir kez verilen rızadan sonra her Spike mesajıyla
otomatik gider (nadir değil, birincil işlevin parçası); kullanıcı adının görüldüğü bir gönderim
formu ve her seferinde onay yok. İsteğe bağlılık yalnız iki şeyi belirler: Play'deki
Optional/Required alanı ve rıza akışının tasarımı (5.1.2(i) açık izin).

Asıl ölçüt saklamadır (§1 "Collect"). Gerçek zamanlı işleyip atan akış teknik olarak "collected"
dışında kalabilir. Yine de beyan edin: (1) saklamama iddiası repodan tam kanıtlanamaz (AWS
hesap ayarı ve model davranışı §0.1; Supabase platform günlükleri istek meta verisini planın
süresi kadar tutar; model invocation logging açıksa gövde yazılır); (2) eksik beyanın riski
var, fazla beyanın cezası yok; (3) aynı uca serbest metin gidiyor ve kullanıcı oraya sağlık
bilgisi yazabilir; (4) Health satırı artık yalnız bu özet yüzünden var (analitik sağlık alanı
taşımıyor), yani beyanın maliyeti etikette bir Health & Fitness satırı, beyan etmemenin riski
yanlış beyan. ASC etiketi anında düzenlenir, yeni build gerekmez: §7 yeşil ve `none`
kanıtlandıysa 1. ve 2. satır sonradan kaldırılabilir.

### 2.4 Device ID mi User ID mi

Apple: Device ID "Such as the device's advertising identifier, or other device-level ID." User
ID "Such as screen name, handle, account ID, assigned user ID, customer number, or other user-
or account-level ID that can be used to identify a particular user or account." Kurulum
UUID'si ilk açılışta uygulamanın ürettiği, AsyncStorage'da duran (`lib/identity/deviceId.ts`),
yeniden kurulumda değişen, hesap ve oturum açma olmayan (`logIn()` çağrılmıyor) kurulum düzeyi
bir kimliktir: "device-level ID". Spike isteğiyle (`x-device-id`) gider; analitik açıksa
olaylarla ve RevenueCat'e `device_id` attribute'u olarak da gider. Aynı sınıftaki Firebase app
instance ID 2.3.1'de Device ID olarak beyan edildi; Google da aynı sınıfı "Device or other IDs"
sayar ("Identifiers that relate to an individual device, browser or app ... Firebase
installation ID"). RC anonim app_user_id aynı sınıfta; RC rehberi User ID'yi yalnız özel app
user ID için ister. **Karar: yalnız Device ID.** İsteğe bağlı muhafazakar seçenek: Apple'ın
"assigned user ID" ifadesi RC anonim kimliğini de kapsayacak okunabilir; isterseniz Identifiers
> User ID'yi de işaretleyin (Linked Yes, Tracking No, Analytics + App Functionality). Kart
düzeyinde "Identifiers" zaten görünür.

### 2.5 Diğer işaretleme kararları, yeni olgularla

- Location: işaretlenmez. `subscription_events.country` RC webhook'unun `country_code` alanıdır
  (mağaza ülkesi), cihaz konumu değil; `tz_offset` ve `locale` konum çözünürlüğüne yaklaşmaz.
  İstemci IP adresi hiçbir tabloya yazılmıyor; adres başına sınırlar için yalnız anahtarlı özet
  (`ip_hash`, en çok 2 gün) sayaç tablolarında duruyor. `country_code` IP'den türetilmiş
  çıkarsa Coarse Location eklenir; 2.3.1 §7'deki muhafazakar not geçerli.
- Other Data Types: boş. Sağlık özeti = Health, sohbet = Other User Content, zarf = Product
  Interaction / Other Diagnostic Data.
- Fitness: işaretlenmez (aktif dakika yalnız cihazda okunur, pakete girmez).

### 2.6 Seçenek B (etiketi küçültmek isterseniz, kod değişikliği gerekir)

(a) Analitik satırlarından kalıcı device_id'yi kaldırmak (oturum başına rastgele kimlik) ve RC
`device_id` attribute'unu tamamen atmak (attribute artık yalnız analitik açıkken gidiyor, ama
açıkken kalıcı kimliği taşıyor): 3-8. satırlar Linked No olabilir; `v_funnel_daily`,
`v_trial_cohort`, `v_pre_cancel_events` çalışmaz. (b) Uygulandı: `onboarding_done` alansız kaldı
(`path` ve `screens` çıktı), `.kind` glucose, meal veya other'a indi ve yalnız insülin
kullananların üretebildiği `rotation` ile `open_injection_map` değerleri nötr adlara katlandı
(§2.2, madde 1); Health yalnız Spike özetine dayanır, 1. satır §2.3 koşuluyla kaldırılabilir.
Bu dosyadaki cevaplar A'ya göredir.

## 3. app.json privacy manifest (UYGULANDI)

2.4: Firebase kaldırıldı, manifest formla eşitlendi (12 tür, EmailAddress geri bildirim formu için eklendi, OtherUserContent artık linked; CrashData yok, Health amacı yalnız AppFunctionality). PerformanceData ve OtherDiagnosticData ilk taraf veri olarak kaldı: spike_reply.latency_ms ve zarf alanları, device_id ile.

Blok `app.json` `expo.ios.privacyManifests` içine uygulandı ve aşağıdaki JSON ile birebir
eşleşiyor (`NSPrivacyTracking` ve 12 `NSPrivacyCollectedDataTypes` girdisi karşılaştırıldı,
2026-10-06). `NSPrivacyTracking` false kalır, `NSPrivacyTrackingDomains` bilerek yok (2.3.1 §2).
Aşağıdaki blok referans kopyadır; `app.json` değişirse bu bölüm de güncellenmeli.

```json
      "privacyManifests": {
        "NSPrivacyTracking": false,
        "NSPrivacyCollectedDataTypes": [
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeHealth",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUserContent",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeEmailAddress",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeSearchHistory",
            "NSPrivacyCollectedDataTypeLinked": false,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePurchaseHistory",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
              "NSPrivacyCollectedDataTypePurposeAnalytics"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeUserID",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
              "NSPrivacyCollectedDataTypePurposeAnalytics"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeAdvertisingData",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeDeveloperAdvertising",
              "NSPrivacyCollectedDataTypePurposeAnalytics"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeProductInteraction",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAnalytics",
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUsageData",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAnalytics"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeDeviceID",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAnalytics",
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePerformanceData",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAnalytics",
              "NSPrivacyCollectedDataTypePurposeAppFunctionality"
            ]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherDiagnosticData",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
              "NSPrivacyCollectedDataTypePurposeAnalytics"
            ]
          }
        ]
      }
```

**Birleştirme tuzağı (2.3.1 notunu tamamlar).** Expo `mergePrivacyInfo`
(`node_modules/@expo/config-plugins/build/ios/PrivacyInfo.js`) mevcut türde yalnız amaçları
birleştirir; `NSPrivacyCollectedDataTypeLinked` ve `...Tracking` değerlerini GÜNCELLEMEZ ve
silme yapmaz. Yerel `ios/zerospike/PrivacyInfo.xcprivacy` zaten varsa, 3-6 ve 8. satırların
`Linked: true` değişikliği `expo prebuild --clean` olmadan yazılmaz. EAS bulut build'i etkilenmez
(`/ios` gitignore'da, sıfırdan üretilir). Build ve prebuild kullanıcıdadır. Doğrulama (build
sonrası): `plutil -p ios/zerospike/PrivacyInfo.xcprivacy | grep -B2 -A8 ProductInteraction`
çıktısında `NSPrivacyCollectedDataTypeLinked => true`. `NSPrivacyAccessedAPITypes` bu işle
değişmez (yeni gerekçe kodlu API eklenmediyse).

## 4. Google Play > Data safety

### 4.1 Form düzeyi cevaplar

| Soru | Cevap | Gerekçe (Google) |
|---|---|---|
| Collects or shares any required user data types | Yes | Collect: "Transmitting data from your app off a user's device." |
| All user data encrypted in transit | Yes | Supabase, AWS, RevenueCat, Firebase, Open Food Facts: hepsi HTTPS. Google şifreli aktarımı cihazdan sunucuya akışın korunması olarak sorar. |
| Users can request data deletion | Yes (§0.2) | Mekanizma var: Ayarlar > Veri ve Dışa Aktarım > Gizlilik > "Sunucu kayıtlarımı sil" düğmesi (`delete-device`) ve politikadaki e-posta yolu (support@greeneyeapp.com, Ayarlar'da gösterilen kurulum kimliğiyle). Google: "provide users with a mechanism to request data deletion; or automatically initiate deletion or anonymization of collected data within 90 days of collection". |
| Independent security review | No | Değişmedi. |

### 4.2 Veri türü tablosu

| Kategori > Tür | Collected | Shared | Ephemeral | Required / Optional | Purposes | Mevcut beyana göre |
|---|---|---|---|---|---|---|
| Health and fitness > Health info | Yes | No | No | Optional | App functionality, Analytics, Personalization | DEĞİŞTİ |
| Messages > Other in-app messages | Yes | No | No | Optional | App functionality | YENİ |
| App activity > App interactions | Yes | No | No | Optional | Analytics, App functionality | KONTROL ET |
| Device or other IDs | Yes | No | No | Required | App functionality, Analytics | KONTROL ET |
| Financial info > Purchase history | Yes | No | No | Required | App functionality, Analytics | KONTROL ET |
| App info and performance > Crash logs | Yes | No | No | Required | App functionality | AYNI |
| App info and performance > Diagnostics | Yes | No | No | Optional | Analytics, App functionality | KONTROL ET |

Seçilmeyecekler: Fitness info (Android'de aktif dakika okunmaz), Personal info > User IDs,
Location, Contacts, Photos and videos, Audio, Files and docs, Calendar, Web browsing,
Messages > Emails ve SMS or MMS.

"Mevcut beyana göre" notu: `PLAY-HEALTH-DECLARATION-EN.md` §6 yalnız Health info'nun ayrıntısını
verir ve diğer türlerin "unchanged" beyanlı olduğunu söyler; collected/shared/purpose ayrıntıları
repoda yok. KONTROL ET satırlarında hedef cevap yukarıdadır, konsoldaki mevcut hâli bununla
karşılaştırın.

### 4.3 Gerekçeler (Google tanımları)

- **Health info:** "Information about a user's health, such as medical records or symptoms."
  Collected: 2.3.1'deki "Collected: Yes" Health Connect okuması için ihtiyatlıydı (Google:
  "User data accessed by your app that is only processed locally on the user's device and not
  sent off device does not need to be disclosed"); 2.3.7'de gerçek: Spike özeti cihazdan çıkar
  (kullanıcının girdiği ölçümlerden hesaplanan sayılar ve ortalamalar, diyabet türü, insülin,
  hap veya hiçbiri bilgisi). Analitik sağlık alanı taşımaz: `onboarding_done` alansız, `.kind`
  yalnız glucose, meal veya other, insülin kullanıcısını ele veren iki değer katlanmış (§2.2,
  madde 1). Optional: Spike özeti ayrı rıza ve varsayılan kapalı;
  Health Connect okuması kullanıcı açınca; analitik anahtarı da varsayılan kapalı (opt-in).
  Google: "'Optional' includes the ability to opt into or opt out of data collection."
  Purposes: Analytics yalnız özetin paylaşılıp paylaşılmadığını sayan olaylar için (Apple satırı
  1'deki not); tabloda `app.json` manifestiyle tutarlı kalsın diye duruyor, kaldırmak isteğe
  bağlı.
- **Other in-app messages:** "Any other types of messages. For example, instant messages or
  chat content." Spike sohbeti Google'ın "chat content" örneğine denk gelir. Optional: Spike
  kullanımı rıza kapısının arkasında.
- **App interactions:** "Information about how a user interacts with the app. For example,
  the number of times they visit a page, screenshots taken, or sections they tap on." Optional:
  analitik opt-in (varsayılan kapalı): onboarding anahtarı, panodaki tek seferlik sayfa ve
  Ayarlar > Veri ve Dışa Aktarım > Gizlilik anahtarı. Anahtar hem Supabase sink'ini hem Firebase
  Analytics'i açar ve kapatır (`firebase.json` otomatik toplamayı kapalı tutar,
  `lib/analytics/firebaseSink.ts` `setAnalyticsCollectionEnabled`'ı yalnız onayda açar);
  Crashlytics anahtar kapsamı dışında. Anahtar Firebase'i kapatmasaydı satır Required olurdu.
  Spike kullanım kayıtları (`spike_usage`, `spike_calls`) anahtardan bağımsızdır ama yalnız
  Spike rızası verilip Spike kullanılırsa oluşur; Spike isteğe bağlı olduğu için satır Optional
  kalır.
- **Device or other IDs:** "Identifiers that relate to an individual device, browser or app. For
  example, an IMEI number, MAC address, Widevine Device ID, Firebase installation ID, or
  advertising identifier." Kurulum UUID'si (Spike isteğiyle; analitik açıksa olaylarla ve
  RevenueCat'e `device_id` attribute'u olarak da), RC anonim kimliği ve Crashlytics kurulum
  kimliği. Required: RC ve Crashlytics kimlikleri kapatılamaz; RC kendi rehberinde "This data
  collection is required and cannot be turned off." der. Reklam kimliği toplanmaz (AD_ID
  manifestten çıkarılıyor: `plugins/withAndroidPermissionTrim.js`).
- **Purchase history:** "Information about purchases or transactions a user has made." RC
  rehberi: App functionality ve Analytics seç, şifreli aktarım Yes. Webhook satırları kendi
  veritabanımıza gider (bizim depomuz, üçüncü taraf değil).
- **Crash logs:** "Crash log data from your app. For example, the number of times your app has
  crashed, stack traces, or other information directly related to a crash." Crashlytics,
  anahtar kapsamı dışında: Required.
- **Diagnostics:** "Information about the performance of your app. For example battery life,
  loading time, latency, framerate, or any technical diagnostics." `spike_reply.latency_ms`,
  `spike_calls` (gecikme, token sayıları) ve zarf alanları. Optional: analitik anahtarıyla
  (varsayılan kapalı) ve Spike kullanımıyla gider.
- **User IDs seçilmez:** "Identifiers that relate to an identifiable person. For example, an
  account ID, account number, or account name." Hesap yok; kimliklendirilebilir kişi yok.

### 4.4 Shared = No ve neden

Google: Share = "Transferring user data collected from your app to a third party". İstisna:
"Transferring user data to a 'service provider' that processes it on behalf of the developer."
Tanım: "an entity that processes user data on behalf of the developer and based on the
developer's instructions." Uygulama: Supabase (veritabanımız ve fonksiyonlarımız), AWS Bedrock
(isteğimizle çıkarım yapar; Anthropic'in erişimi yok, §0.1), RevenueCat (abonelik altyapısı),
Google Firebase (analitik ve çökme raporu işleyicisi). İşleyici üzerinden işleme "sharing"
sayılmaz. Bu cevabın dayanakları: (1) RC > Integrations yalnız Apple Search Ads ve bizim webhook
(RC: "If you are using integrations set up between RevenueCat and third parties that are not
considered service providers, you may need to disclose 'Shared' here as well."); (2) Firebase'de
Google signals kapalı, Ads bağlı değil; (3) RC'ye özel app user ID (`logIn`) veya e-posta
gitmiyor; rastgele kurulum kimliği yalnız analitik açıkken `device_id` attribute'u olarak gider.
İkinci savunma hattı: Google "Transferring user data to a third party based on a specific
user-initiated action, where the user reasonably expects the data to be shared, or based on a
prominent in-app disclosure and consent" istisnasını da sayar; Spike rıza ekranları bunu
karşılar, yeter ki alıcı ve veri açıkça yazsın (§0.3).

### 4.5 Spike özeti için "ephemeral" seçilebilir mi

Google: "User data transmitted off device that is processed ephemerally needs to be included in
your form response, but if it meets the standard below, it will not be disclosed in your app's
Data safety section on Google Play." Standart: "accessing and using it while the data is only
stored in memory and retained for no longer than necessary to service the specific request in
real-time." Karşı örnek: "using data to build advertising profiles or other user profiles
cannot be treated as ephemeral."

- **Tanım gereği seçilebilir mi:** Spike özeti ve sohbet metni için evet, dört koşulla: (a) AWS
  `none` kanıtlandı (§0.1); (b) Bedrock model invocation logging kapalı (istem önbelleği
  koşulunu kod zaten sağlıyor); (c) fonksiyonlar gövdeyi günlüğe yazmıyor (§7, komut 1);
  (d) Supabase günlükleri gövde tutmuyor.
- **Öneri: Ephemeral = No** (tabloda böyle). Nedenler: (1) saklamama iddiası repodan tam
  kanıtlanamaz: yukarıdaki (a), (b) ve (d) repo dışında doğrulanır (AWS hesap ayarı ve model
  davranışı §0.1; Supabase platform günlükleri), yani "Yes" bugün kanıtsız bir iddia olur. Health
  info türü 2.3.7'de yalnız Spike özetinden oluşur (analitik şeması sağlık alanı taşımıyor:
  `onboarding_done` alansız, `.kind` glucose, meal veya other, `rotation` ve
  `open_injection_map` katlanmış), bu yüzden eski gerekçe
  (180 gün saklanan analitik alanları) düştü ve hüküm (1)'e dayanır; (2) yanlış "Yes" Google'da
  doğruluk ihlalidir ("Your Data safety form responses must remain accurate and complete at all
  times"), fazla beyan ihlal değildir; (3) Yes seçmek Health info'yu Play listesinden tamamen
  kaldırır, oysa Health Connect izinleri istenen ve 2.3.1'den beri "collected" görünen bir
  türü gizlemek HC beyanıyla tutarsız okunur.
- **Messages için** Yes, (a)-(d) yeşilse meşrudur; varsayılan No (mağazalar arası tutarlılık,
  maliyeti yok).

### 4.6 Health Connect beyanıyla çelişki kontrolü

- **Veri akışı: çelişki yok.** Health Connect kaynaklı hiçbir kayıt Spike paketine girmiyor:
  `lib/ai/spikeContext.ts` okumaları yalnız `source === "manual"` izin listesiyle alır ("A
  Health import is `source = 'health'` and is excluded by this allowlist, so a new source
  value is excluded too"); enjeksiyonlar da izin listesinde; test `scripts/spikeContext.test.ts`.
  Google HC politikası: "Data use should be limited to providing or improving the appropriate
  use case or features visible in the application's user interface" ve üçüncü tarafa aktarım
  yalnız açık rızayla güvenlik, yasa veya birleşme için. HC verisi gitmediği için uyumlu.
- **Metin çelişkileri (düzeltilmeli):** `PLAY-HEALTH-DECLARATION-EN.md` satır 42-50 (§3: "Blood
  glucose values are never sent to any server ..."), 62-70 (§6: "Encrypted in transit: not
  applicable, health data does not leave the device"), 72-74 ("None of these carry health
  values"), 165-168 (§11 READ_BLOOD_GLUCOSE gerekçesi: "never uploaded"). Öneri metinler §6.1'de.
- **Health apps declaration kutuları değişmez** (Disease and condition management, Medication and
  treatment management, Nutrition and weight management). Clinical decision support işaretlenmez:
  Spike doz vermez, yorumlamaz, yalnızca kullanıcının kendi sayılarını betimler
  (`prompt.ts` LOGBOOK SUMMARY kuralları).

## 5. Gizlilik politikası

URL değişmiyor: `https://greeneyeapp.com/legal/zerospike-privacy` (Türkçe kök; `lib/legal.ts`:
de, fr, es için `/<dil>/legal/...`, diğer diller `/en/legal/...`; Play beyanında İngilizce
sürüm). ASC'de dil başına Privacy Policy URL alanları ve Play'deki tek alan aynı kalır.

**Durum (2026-10-06, `greeneyeapp-site` çalışma ağacı):** 9 sayfanın hepsi 6 Ekim 2026 tarihli
ve 2.3.7 içeriğiyle güncel (hepsinde Bedrock, 180 gün ve e-posta ile silme yolu geçiyor, hiçbirinde
OpenAI geçmiyor; en sayfası okundu). 28 Ağustos 2026 sürümündeki yanlış cümleler düzeltilmiş:
özet ve bölüm 2, 3, 6, 11 (sağlık kaydı cihazda, tek istisna isteğe bağlı Spike özeti), bölüm 5
ve 7 (Spike, opt-in analitik, 180 gün, kurulum kimliği), bölüm 8 (abonelik olayları, 24 ay, ham
gövde 90 gün), bölüm 9 (Apple Ads ölçümü), bölüm 10 (işleyiciler), bölüm 13 ve 14 (saklama
süreleri, e-posta ile silme talebi), bölüm 15 (işleyiciler dışında erişim yok). Sayfalar bu
depoda değil site deposundadır ve mağaza formlarından ÖNCE yayında olmalıdır. Açık kalanlar:
- Politika silme için yalnız e-posta yolunu anlatıyor (bölüm 13 ve 14); Ayarlar'daki "Sunucu
  kayıtlarımı sil" düğmesi metinde geçmiyor. Bir cümle eklenmeli (Apple 5.1.1(i): "describe how a
  user can revoke consent and/or request deletion").
- Supabase proje bölgesi metinde yok (konsoldan bakın, bölüm 10'a eklenmeli).

## 6. Önerilen metin değişiklikleri (UYGULANMADI)

### 6.1 `PLAY-HEALTH-DECLARATION-EN.md` (§0.1 yeşilse; İngilizce, yapıştırmaya hazır)

§3, 42-50. satırların yerine:

> Health data stays on the device by default. zerospike has no account and no server-side
> storage of health records; readings are kept in a local database on the phone.
>
> Blood glucose data obtained from Health Connect is never sent to any server, never included in
> analytics or crash reports, and never shared with third parties. It is not used for advertising
> and is not sold.
>
> Separately, and only if the user turns on the optional "Share my 14-day summary" switch for the
> Spike assistant (off by default, with its own consent screen), a small summary computed on the
> device from readings the user typed into zerospike is sent together with the user's question:
> counts and averages, the target range, meal tags, injection regions, logging habits, diabetes
> type, and whether the user uses insulin, tablets or neither. It never contains individual
> readings, insulin amounts, timestamps or any record that came from Health Connect or Apple
> Health. It is processed only to answer that request and is not stored by zerospike or used to
> train models.
>
> The user can revoke zerospike's access at any time from the Health Connect app, and can turn
> writing off, or switch off the summary, from zerospike's own Settings.

§6, 62-70. satırlar: Data type "Health and fitness > Health info (blood glucose from Health
Connect; optional Spike summary of user-entered readings)"; Collected Yes; Shared No (service
providers only); Processed ephemerally No; Optional; Purposes App functionality, Analytics,
Personalization; Encrypted in transit **Yes**; deletion **Yes** (§0.2: the in-app "Delete my
server records" button and the e-mail route). 72-74. satırdaki "None of these carry health
values" cümlesi: "Usage analytics are off unless the user turns them on, and carry no health
values; the only entry-related label is the kind of entry logged: glucose, meal or other."

§11, 165-168. satırlar: "Blood glucose data read from Health Connect stays on the device.
zerospike has no account and no server-side storage of health records. Health Connect data is
never uploaded, never included in analytics or crash reports, and never shared with third
parties or used for advertising. The optional Spike summary uses only readings typed into
zerospike and excludes everything that came from Health Connect."

### 6.2 App Review Information, Notes (İngilizce, 2.3.7 notuna eklenecek paragraf)

> SPIKE (optional assistant). Messages are sent to our server and processed by Anthropic Claude
> models on Amazon Web Services (Amazon Bedrock) in the EU region. A separate, off-by-default
> switch ("Share my 14-day summary") adds a summary computed on the device from readings the user
> typed into the app: counts, averages, target range, meal tags, injection regions, logging
> habits, diabetes type, and whether the user uses insulin, tablets or neither. Records that came
> from Apple Health are never included. Both consents have their own screens, appear before
> anything is sent, and can be withdrawn in Settings. The summary is not stored on our server and
> is not used to train models.
> USAGE ANALYTICS (opt-in). Off until the user agrees: one switch in onboarding (off by default),
> a one-time sheet on the dashboard for existing installs, and a switch in Settings > Data &
> Export > Privacy. When on, a random per-install identifier (not tied to a name or account)
> with event names and counts (no glucose values, notes or free text; entries are labeled only
> glucose, meal or other) goes to our server and is kept 180 days; the same identifier is also
> attached to the RevenueCat customer, and only while analytics is on. The same Privacy section
> has "Delete my server records".
> App Privacy answers and the privacy manifest were updated: Health, Other User Content, linked
> identifiers. No tracking, no ATT prompt.

## 7. Yayından önce doğrulama (hepsi salt okunur)

Depo kökünden:
1. `grep -rn "console\." supabase/functions --include='*.ts'`: yalnız `bedrock.ts` içindeki üç
   satır (`spike config`: yapılandırma sorunu; `logUpstream`: durum kodu ve hata sınıfı) ve
   çevrimdışı `eval.ts` çıkmalı; mesaj veya özet yazan satır olmamalı.
2. `grep -n "USER_SUGAR_SOURCE" lib/ai/spikeContext.ts && ls scripts/spikeContext.test.ts`:
   izin listesi ve testi var.
3. `grep -rn "setUserId\|setUserProperties\|setCustomKey\|logIn(\|collectDeviceIdentifiers" app lib`:
   boş (kurulum UUID'si Firebase kimliği olmuyor; Crash Data bağsız kalır).
4. `grep -rn "setAttributes" lib app`: tek özel attribute `device_id` (`purchases.ts`): değer yalnız
   analitik açıkken yazılır, kapatınca `null` ile silinir.
5. `grep -n "DEFAULT_MODEL\|DEFAULT_REGION" supabase/functions/ai-ask-spike/bedrock.ts` ve
   Supabase secrets listesinde `SPIKE_MODEL` / `AWS_REGION`: model Fable 5/5.1 değil, bölge AB.

AWS: §0.1'deki `allowed_modes` sorgusu (`none` içermeli) ve
`aws bedrock get-model-invocation-logging-configuration --region eu-central-1` (`loggingConfig`
boş olmalı).
Supabase SQL editörü:
6. `select jobname, schedule from cron.job where jobname in ('purge-app-events','purge-spike-logs','purge-subscription-events');`:
   3 satır (`17 3 * * *`, `17 3 * * *`, `27 3 * * *`); `select count(*) from cron.job where jobname = 'spike-logs-retention';`:
   0 (eski ad `20261006143100_cron_enable` göçüyle kalkar; satırlar yoksa göç uygulanmamıştır,
   `supabase db push`). `select count(*) from public.app_events where received_at < now() - interval '181 days';`: 0.
   `select count(*) from public.subscription_events where raw is not null and received_at < now() - interval '91 days';`: 0.
RevenueCat paneli: Integrations yalnız Apple Search Ads ve Webhook. Firebase konsolu: Google
signals kapalı, Google Ads bağlantısı yok.

## 8. Konsol adımları (kısa)

**App Store Connect** (zerospike > App Privacy):
1. 9 dilde politika sayfalarının yayında ve 6 Ekim 2026 tarihli olduğunu doğrulayın (§5).
2. Data Types > Edit: "collect data" Yes; §2.1'deki 9 kutuyu işaretleyin, diğerlerini boş bırakın.
3. Her tür için amaçları, Linked ve Tracking cevaplarını tablodan girin (Tracking hep No).
4. Özet kartını §2.1 önizlemesiyle karşılaştırın; Publish. Etiket sürümden bağımsızdır ve
   anında canlıya geçer: 2.3.7'yi incelemeye gönderdiğiniz gün yayımlayın.
5. App Review Information > Notes: §6.2 paragrafını ekleyin.
6. Build tarafı: §3 bloğu `app.json`'da uygulandı; yeni manifest EAS temiz build ile gider.

**Play Console** (zerospike > Policy and programs > App content):
1. Data safety > Manage: collect Yes, encrypted in transit Yes, deletion Yes (§0.2).
2. 7 veri türünü §4.2 tablosuna göre girin; Shared hepsinde No, Ephemeral hepsinde No.
3. Kaydedin; "Henüz incelemeye gönderilmeyen değişiklikler" altında 2.3.7 sürümüyle birlikte
   gönderin.
4. Health apps declaration: kutular aynı; serbest metinleri §6.1 ile güncelleyin.
5. Advertising ID beyanı "No" kalır. Privacy policy URL alanı aynı kalır.

## 9. Kapsam dışı gözlemler (2.3.7'yi değiştirmez, aynı oturumda bilmeye değer)

- Spike (OpenAI ile) 2.3.x sürümlerinde zaten canlıydı; 2.3.1 notunda hiç geçmiyordu ve politika
  sayfası 6 Ekim 2026'ya kadar anmıyordu (artık anıyor, §5). Canlı ASC/Play formunun bugünkü hâli
  repodan görünmez; 2.3.7 formu bunu da kapatır.
- Open Food Facts: barkod ve ürün adı aramaları `world.openfoodfacts.org`'a gidiyor
  (`lib/services/openFoodFacts.ts:19`, 2.3.1 ve 2.3.3'ten beri), 2.3.1 notunda yok. Apple
  "collect" tanımına göre bizde saklanmıyor; Play'de Google'ın "based on a specific user-initiated
  action, where the user reasonably expects the data to be shared" istisnası uygulanır; politika
  sayfası bunu artık söylüyor (bölüm 3 ve 10).
- Analitik opt-in oldu (kapandı): Apple 5.1.1(ii): "Apps that collect user or usage data must
  secure user consent for the collection, even if such data is considered to be anonymous at the
  time of or immediately following collection." Onay üç yerden alınır (onboarding anahtarı, eski
  kurulumlar için panoda tek seferlik sayfa, Ayarlar anahtarı) ve varsayılan kapalıdır; eski
  "varsayılan açık" anahtarda açıkça kapatmış olanlar kapalı kalır, diğerleri cevapsız sayılıp
  bir kez sorulur (`lib/analytics/consent.ts`). AB'deki ePrivacy 5(3) tartışması bu tasarımla
  kapanır; Crashlytics anahtar kapsamı dışında kalmaya devam eder (politika bölüm 6, meşru
  menfaat).
- Firebase: `firebase.json` `analytics_auto_collection_enabled=false` ve `GoogleService-Info.plist`
  `IS_ANALYTICS_ENABLED=false` taşıyor; `firebaseSink.ts` her açılışta native bayrağı kayıtlı
  cevaba göre yazar (yalnız onayda `true`) ve anahtarı canlı izler. Etiketi değiştirmez (ilk taraf
  sink aynı türleri zaten toplar), ama davranış değişikliğidir: onay yokken Firebase Analytics
  hiç toplamaz.

## 10. Kaynaklar (2026-10-06'da okundu)

- Apple, App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Apple, User Privacy and Data Use: https://developer.apple.com/app-store/user-privacy-and-data-use/
- Apple, App Review Guidelines 5.1.1, 5.1.2, 5.1.3: https://developer.apple.com/app-store/review/guidelines/
- Apple Ads attribution: https://ads.apple.com/app-store/help/attribution/0094-ad-attribution-overview
- Google, Data safety section: https://support.google.com/googleplay/android-developer/answer/10787469
- Google, Health Connect politikası: https://support.google.com/googleplay/android-developer/answer/9888170
- Android, Health Connect yayın rehberi: https://developer.android.com/health-and-fitness/health-connect/publish
- AWS, Bedrock data protection: https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html
- AWS, Bedrock abuse detection: https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html
- AWS, Bedrock data retention: https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html
- RevenueCat, Apple App Privacy: https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy
- RevenueCat, Google Play Data safety: https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety
- Expo mergePrivacyInfo: `node_modules/@expo/config-plugins/build/ios/PrivacyInfo.js`
