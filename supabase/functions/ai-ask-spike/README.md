# ai-ask-spike

Spike asistanı: Amazon Bedrock üzerinden Claude (`@anthropic-ai/bedrock-sdk`). İki kimlik yolu var: Bedrock API anahtarı (bearer, `bedrock-runtime` uç noktası, inference profile kimliği; tercih edilen) ve IAM erişim anahtarı çifti (SigV4, Mantle uç noktası, çıplak model adı). İstek gövdesi (`buildParams`) iki yolda aynıdır. Deploy, secret ve eval insan adımıdır.

## Secret'lar

| Ad | Zorunlu | Varsayılan |
|---|---|---|
| `AWS_BEARER_TOKEN_BEDROCK` | evet, ya bu ya aşağıdaki anahtar çifti | Bedrock API anahtarı (`ABSK...`), tercih edilen yol: doluysa anahtar çiftine bakılmaz |
| `AWS_ACCESS_KEY_ID` | bearer yoksa evet | |
| `AWS_SECRET_ACCESS_KEY` | bearer yoksa evet | |
| `AWS_SESSION_TOKEN` | yalnız geçici kimlikte (anahtar çifti yolu) | |
| `AWS_REGION` | hayır | `eu-central-1` |
| `SPIKE_MODEL` | hayır | `anthropic.claude-sonnet-5-5` (mantıksal ad, iki yolda aynı) |
| `SPIKE_MODEL_PREFIX` | hayır | `eu.` (yalnız bearer yolunda; `eu.` veya `global.`) |
| `SPIKE_GLOBAL_DAILY_CAP` | hayır | `3000` (UTC günü başına model çağrısı, tüm çağıranlar) |
| `SPIKE_IP_HOURLY_CAP` | hayır | `60` (çağıran adres başına saatlik istek) |

`SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` platformdan gelir. Bedrock API anahtarının bağlı olduğu IAM kimliğine (anahtar çifti yolunda IAM kullanıcısına) yalnız bu modeli çağırma izni verin; modele erişim Bedrock konsolunda bu bölge için açık olmalı. `OPENAI_API_KEY` artık kullanılmıyor.

Kimlik yolu: `AWS_BEARER_TOKEN_BEDROCK` doluysa `AnthropicBedrock` istemcisi `Authorization: Bearer <anahtar>` ile `https://bedrock-runtime.<bölge>.amazonaws.com/model/<profil kimliği>/invoke` (akışta `/invoke-with-response-stream`) adresini çağırır; SDK `model` ve `stream` alanlarını gövdeden URL'ye taşır ve `anthropic_version` alanını kendisi ekler, imza (SigV4) yoktur. Yoksa `AWS_ACCESS_KEY_ID` ve `AWS_SECRET_ACCESS_KEY` ile `AnthropicBedrockMantle` istemcisi Mantle uç noktasını (`bedrock-mantle.<bölge>.api.aws/anthropic`) SigV4 imzasıyla çağırır. Mantle uç noktası Bedrock API anahtarını 401 ile reddeder, bu yüzden anahtar için ikinci istemci gerekir. İkisi de doluysa bearer kazanır, ikisi de yoksa 500 `not_configured` döner. Soğuk başlangıçta istemci kurulunca günlüğe bir kez `spike bedrock: auth=<bearer|sigv4> region=<bölge> model=<çağrıda kullanılan kimlik>` satırı yazılır (anahtar yazılmaz): canlıda hangi yolun seçildiği buradan görülür.

Model kimliği: `SPIKE_MODEL` mantıksal ad olarak kalır ve iki yolda aynıdır (`spike_calls.model` ve istemciye dönen `usage.model` bunu taşır). Bearer yolunda `bedrock-runtime` çıplak adı 400 ile reddeder (inference profile ister), bu yüzden çağrıda `SPIKE_MODEL_PREFIX` + `SPIKE_MODEL` kullanılır, varsayılan `eu.anthropic.claude-sonnet-5-5`. AB bölgesi (veri yerleşimi) `eu.` önekiyle sağlanır; `global.` profili isteği AB dışına da yönlendirebilir. Mantle yolunda önek kullanılmaz. Canlıda doğrulanan profil `eu.anthropic.claude-sonnet-5-5`; Opus ve Haiku profilleri aynı kalıpla kurulur ama canlıda denenmedi.

`SPIKE_MODEL` yalnız `anthropic.claude-sonnet-5-5`, `anthropic.claude-opus-5-5`, `anthropic.claude-haiku-4-5` olabilir; `AWS_REGION` yalnız `eu-central-1`, `eu-west-1`, `eu-west-3`, `eu-north-1`; `SPIKE_MODEL_PREFIX` (bearer yolunda) yalnız `eu.` ve `global.`. Listede olmayan değer 500 `not_configured` döner ve günlüğe nedeni yazılır (listeler `bedrock.ts` içinde). Opus her zaman düşünür ve düşünme token'ları `max_tokens` sınırına sayılır, bu yüzden Opus için sınır 1200, diğerleri için 600.

## Deploy

Sıra önemli: yeni fonksiyon `spike_reserve` çağırır; migration yoksa her istek 503 alır.

```sh
supabase db push   # 20260727051605_spike_usage, 20261006095331_spike_calls, 20261006141500_spike_hardening, 20261006143100_cron_enable (günlük saklama işi)
supabase secrets set AWS_BEARER_TOKEN_BEDROCK=...   # tercih edilen; yedek: AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
supabase functions deploy ai-ask-spike --no-verify-jwt
supabase secrets unset OPENAI_API_KEY   # yeni sürüm canlıda doğrulandıktan sonra
```

Bearer yolundan geri dönüş: `supabase secrets unset AWS_BEARER_TOKEN_BEDROCK` (anahtar çifti duruyorsa fonksiyon Mantle yoluna döner).

Saklama sınıfları: `spike_usage` (cihaz başına günlük sayaç), `spike_global_usage` (günün toplam çağrısı) ve `spike_calls` (çağrı günlüğü: model, token, süre, süzgeç kuralı; mesaj metni yok) 90 gün; `spike_ip_usage` (adres özeti sayacı) 2 gün tutulur. `purge_spike_logs()` süresi dolan satırların hepsini siler. Günlük iş (`purge-spike-logs`, 03:17 UTC) `20261006143100_cron_enable.sql` ile kurulur: migration pg_cron'u kendisi açar ve işi yeniden yaratır, pg_cron açılamazsa `db push` durur; elle `cron.schedule` çalıştırmak gerekmez (eski `spike-logs-retention` işi aynı migration'da `purge-spike-logs` ile değişir).

Silme kapsamı: kullanıcı "verilerimi sil" dediğinde `delete-device` fonksiyonu (`delete_device_data_v2`) o cihazın `spike_usage` ve `spike_calls` satırlarını hemen siler. `spike_global_usage` ve `spike_ip_usage` cihaz kimliği taşımaz (toplam sayı ve anahtarlı adres özeti), bu silmeye girmez ve yalnız saklama süresiyle temizlenir. Silinen `spike_usage` satırı o günün cihaz sayacını da kaldırır, yani günlük hak yeniden başlar; bunu sınırlayan şey `delete-device`'in saatlik tavanları ile bu fonksiyonun adres ve genel tavanlarıdır.

## Maliyet tavanları

Model çağrısı paralı tek adımdır ve fonksiyon adresi herkese açık (JWT yok), bu yüzden tavanlar çağrıdan önce, Postgres'te tek atomik adımda (`spike_reserve`) uygulanır:

1. Çağıran adres: saat başına `SPIKE_IP_HOURLY_CAP` istek. Adres `cf-connecting-ip` başlığından, yoksa `X-Forwarded-For` listesinin SON girdisinden alınır (ilk girdileri istemci yazar); IPv6 için /64 öneki sayılır. Adres tabloya yazılmaz, yalnız anahtarlı özeti (HMAC) saklanır.
2. Cihaz: UTC günü başına 3 (free) veya 50 (pro) mesaj. `tier` istemciden gelir ve doğrulanamaz; gerçek sınırlar pro sayısındaki cihaz tavanı, adres tavanı ve genel tavandır, üçü birlikte.
3. Genel: UTC günü başına `SPIKE_GLOBAL_DAILY_CAP` çağrı.

Yuva model çağrısından ÖNCE ayrılır, eşzamanlı istekler aynı sayıyı birlikte geçemez. Yalnız model hatasında (hiç cevap alınamadı: 502 `upstream`) cihaz ve genel yuva iade edilir. Model cevap ürettiyse yuva harcanmış kalır ve çağrı `spike_calls`'a yazılır: istemci akışı yarıda keserse (üretilen token ödendi), cevap süzgeçte takılırsa (`filter_rule` = kural kimliği) ve cevabın görünür metni boşsa da (yalnız meta satırı, yalnız kod çiti ya da görünür metinden önce token sınırı). Boş cevap iade edilmez ve hata da dönmez: `finalizeReply` onu `rule: "empty"` ile engellenmiş cevap sayar, istemciye 200 ve `filtered: true` ile tarafsız metin (`safeText(locale, "refusal")`) gider. Eskiden bu cevap iade edilip 502 dönerdi: uygulama aynı mesajı ikinci kez ücretli çağırırdı ve çağrı yuva harcamadığı için tek cihaz ile tek adresten 40 istek 40 model çağrısı yapabilirdi. Artık aynı senaryo en çok cihaz tavanı kadar (free 3) model çağrısı yapar. Veritabanına ulaşılamazsa istek geçirilmez: 503 `unavailable`. Cevaplar: 429 `daily_limit` (cihaz), 429 `rate_limit` (adres, `Retry-After` ile), 429 `capacity` (genel). Uygulama bu üçünü ayrı hata kodu olarak ele alır; `capacity` için ayrı metin gösterir (`spike.errorCapacity`: günlük kapasite doldu, UTC gece yarısından sonra tekrar deneyin) ve hiçbirinde ikinci istek yapmaz. Reddedilen istekler yalnız sayılır (yalnız 429): `spike_reject_usage` saat, neden (`ip`, `device`, `global`), tavan ve sayı tutar; cihaz kimliği, adres özeti ve metin yoktur. Sayaç `spike_reserve` içinde atomik artar, 90 gün sonra `purge_spike_logs` ile silinir; `v_spike_gate_daily` haftalık rapora ret oranını verir.

Bir akış kopunca uygulama aynı mesajı `stream=false` ile bir kez daha dener; aynı cihazın aynı sohbet penceresi 60 sn içinde bir kez cihaz yuvası harcamaz (adres ve genel sayıya yine girer, çünkü yeni bir model çağrısıdır).

İstek gövdesi: Content-Length varsa en çok 256 KB, yoksa akıştan en çok 64 KB okunur. CORS başlığı yoktur (uygulama tarayıcı değil); OPTIONS 204 boş döner.

## carb_estimate modu

Aynı fonksiyon, `mode:"carb_estimate"` ile bir öğünün serbest metin tarifini yaklaşık karbonhidrat gramına çevirir. Tek tur, akış yok, `x-consent-context` gerekmez, `x-device-id` zorunlu. Kod `carbEstimate.ts` (G/Ç `CarbDeps` ile enjekte edilir, `carbEstimate.test.ts` ağsız koşar), sabitler `_shared/carb-estimate.ts`, sistem istemi `prompt.ts` içinde `CARB_SYSTEM_PROMPT`.

- İstek: `{mode:"carb_estimate", locale, tier, text}`; `text` 1-300 karakter (`<`/`>` boşluğa çevrilir, sınırlayıcı etiket kapatılamaz).
- Yanıt 200: `{items:[{name, quantity, unit, grams_carb}], total_grams_carb, filtered, charged, usage}`. `charged`: true = model çağrısı yapıldı, cihaz yuvası harcandı (normal, boş, filtered); false = model çağrısı OLMADAN reddedildi (tıbbi ön süzgeç), yuva harcanmadı. En çok 12 kalem, `name` en çok 60, `unit` en çok 20 karakter, `quantity` 0-10000, `grams_carb` 0-500. Şema dışı anahtarlar atılır, toplam kalemlerden sunucuda yeniden hesaplanır. Not metni sunucuda YOK: "besin bilgisi tahminidir, doz değildir" istemcide i18n anahtarıdır. Tanınan yemek yoksa `items:[]` (200, yuva harcanmış kalır).
- Kota: `spike_reserve` aynı adres ve genel tavanlarla, cihaz anahtarı `ce:<deviceId>` ile çağrılır (ayrı günlük sayaç, `spike_usage` tablosunda; free 1, pro 50, `tier` istemciden gelir ve sohbet gibi doğrulanamaz). Aşımda 429 `daily_limit_carb`; adres 429 `rate_limit`, genel 429 `capacity`, veritabanı 503 `unavailable`. Not: `spike_reject_usage` cihaz reddi tavan değeriyle sayılır, yani carb free (1) ayrı satırdır ama carb pro (50) sohbet pro (50) satırıyla aynıdır.
- Hata: 400 `bad_request` (gövde bozuk, metin boş ya da 300'den uzun, bilinmeyen `mode`), 502 `estimate_failed` (model yanıtı şemaya uymadı, boş ya da token sınırı; model çalıştığı için yuva İADE EDİLMEZ, global tavan faturayı sınırlar; çağrı `filter_rule='schema'` ile yazılır, `estimate_failed` yanıt gövdesi `{error, charged:true}` taşır: istemci kota sayacını artırır; diğer hata gövdelerinde `charged` yok), 502 `upstream` (modele ulaşılamadı: Bedrock 5xx/zaman aşımı; yuva iade). Cihaz kimliği `[A-Za-z0-9_-]{8,80}` (`:` yok, sohbet cihazı `ce:X` sayaç satırıyla çakışmasın).
- Süzgeç: istek metni doz/insülin/ilaç markası/tedavi sözcüğü taşıyorsa (`hasMedicalTerm`) yuva ve model çağrısı OLMADAN 200 `{items:[], filtered:true, charged:false}` döner. Metin önce `normalizeWithMap` ile temizlenir (sıfır genişlikli/bidi karakterler silinir, Kiril/Yunan benzer harfler Latin'e katlanır). Yemek sayım sözcükleri (unidad, unidade, unité, unità) tek başına tıbbi sayılmaz; insülin/ilaç sözcüğü, 'kaç/how many + unit', sayı+IU/IE/UI/U ya da ünite/Einheit olursa sayılır. 'doz/dose/dosis/dosi' yalnız porsiyon sayısı değilse ('1 doz eggs', 'dosi per 2 persone' geçer) tıbbidir. Model yanıtında `name`/`unit` alanları aynı `checkReply` kurallarından ve aynı sözcük listesinden geçer; `name`, `unit` ve birleşik `name quantity unit` ayrı ayrı taranır; `unit` alanı IU/IE/UI/U/E/mg/units/Einheiten ise reddedilir, sayım sözcükleri (unidad, unité...) `''` olarak normalize edilir. İhlalde tüm yanıt `{items:[], filtered:true, charged:true}` ile değişir, yuva harcanmış kalır, çağrı kural kimliğiyle yazılır.
- Saklama: metin ve yanıt ne tabloya yazılır ne loglanır. `spike_calls` yalnız `mode`, token sayıları ve `latency_ms` alır (`mode` kolonu `20261019100000_spike_calls_mode.sql`, varsayılan `chat`, eski satırlar `chat`). Çağrı satırı düz `deviceId` ile yazılır (silme isteği bulsun); `ce:` sayaç satırını `delete_device_data_v2` aynı migration'dan itibaren siler.
- Sıra: `supabase db push` ÖNCE (fonksiyon `mode` kolonuna yazar, kolon yoksa çağrı günlüğü sessizce düşer), sonra deploy.

Test: `deno test --allow-env --allow-net supabase/functions` (şema, süzgeç, kota anahtarı, mod yolu, hata kodları). Veritabanı testi: `supabase/tests/spike_calls_mode.sql` (BEGIN/ROLLBACK, migration SQL'i içinde).

## Tip kontrolü ve eval

Kök dizindeki Expo `package.json` Deno'yu node_modules çözümüne zorlar; bu klasördeki `deno.json` bunu kapatır:

```sh
deno check --frozen --config supabase/functions/ai-ask-spike/deno.json supabase/functions/ai-ask-spike/index.ts supabase/functions/ai-ask-spike/eval.ts
```

Bağımlılıklar sabittir. `bedrock-sdk@0.34.2` kendi içinde `@anthropic-ai/sdk` için açık aralık ister (`>=0.115.1 <1`), yani sabitlenmezse her deploy o günün en yeni sürümünü alırdı. `bedrock.ts` SDK'yı tam sürümle (`0.131.0`) içe aktarır; Deno bedrock-sdk'nın kopyasını da buna eşler (yalnız `deno.json` import map'ine yazmak bunu yapmaz). Ağacın geri kalanını `deno.lock` sabitler (`deno check --frozen` ile doğrulanır). Kilit sürüm 4 biçimindedir ve öyle kalmalıdır: Supabase edge runtime'ın gömülü Deno'su 2.1.4'tür ve sürüm 5 kilidi okuyamaz ("Unsupported lockfile version '5'"); güncel Deno ile üretilen kilit sürüm 5 olur. Bir sürümü değiştirmek için `bedrock.ts`'teki sürümü ve `deno.json`'u güncelleyin, `deno.lock`'u silin ve Deno 2.1.4 ile yeniden üretin (`deno cache --lock=supabase/functions/ai-ask-spike/deno.lock --config supabase/functions/ai-ask-spike/deno.json supabase/functions/ai-ask-spike/index.ts supabase/functions/ai-ask-spike/eval.ts`), sonra d.ts'in `thinking: {type: "between_tools"}`, `output_config.effort` ve `stop_reason` değerlerini hâlâ taşıdığını kontrol edin. Kilit, `filter.test.ts` dahil hiçbir testle değişmez (testler `node:assert` kullanmaz, çünkü Deno 2.1.4 onun için kilide `@types/node` ekler).

Filtre ve cevap ayrıştırma testi (ağ ve model gerektirmez, ücretsiz):

```sh
deno test --config supabase/functions/ai-ask-spike/deno.json supabase/functions/ai-ask-spike/filter.test.ts
```

Kurallara dokunan her değişiklikte `BLOCKED` (yakalanması gereken), `ALLOWED` (geçmesi gereken) ve gizleme denemeleri için `ESCAPES` listelerine satır ekleyin. Aynı dosya boş cevabın (`rule: "empty"`) ve akıştaki payın davranışını da sınar; yuvanın iade edilip edilmediği ise `index.ts` işleyicisindedir ve bu testin kapsamı dışındadır.

Eval (22 vaka x 2 model = 44 ücretli çağrı; ikinci model varsayılan `anthropic.claude-opus-5-5`; `a07`-`a10` izin kipli saldırgan vakalardır). Eval fonksiyonla aynı istemci fabrikasını (`bedrockClient()`) ve `buildParams` çıktısını kullanır: kimlik yolu aynı kuralla seçilir ve ikinci model de mantıksal adla verilir (bearer yolunda önek kendiliğinden eklenir). Anahtar çifti için `AWS_BEARER_TOKEN_BEDROCK` yerine `AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...` verin:

```sh
AWS_BEARER_TOKEN_BEDROCK=... deno run --config supabase/functions/ai-ask-spike/deno.json --allow-env --allow-net --allow-read --allow-write supabase/functions/ai-ask-spike/eval.ts anthropic.claude-opus-5-5 --out .tmp/spike-eval.md
```

## Çıktı filtresi

`filter.ts` her cevabı, cevabın dili ne olursa olsun, tüm dillerin kurallarıyla tarar: doz sayısı (rakam ve sözcük, "10 U", "4-unit", "ユニット", "4 Einh.", "twenty units before dinner", "Inject 4 of your NovoRapid"), emir kipi ve izin kipi ("Evet, bırakabilirsiniz", "you can stop", "Sie können ... absetzen", "puede dejar de"), kipsiz izin ("It's okay if you skip", "Consider lowering", "I would reduce", "No need to take", "Es ist in Ordnung, ... abzusetzen", "Está bien suspender", "Va bene sospendere", "Tudo bem parar de", "bırakmanızda sakınca yok", "中止して構いません"), ilaç mg miktarı ("1000 mg metformin", "two 500 mg tablets"), karbonhidrat/düzeltme oranı (birimli "ICR 1:10", "bir ünite 15 g" ve birimsiz "correction factor is 50", "ISF 50", "ratio is 1 to 10"), tanı (söylenen, virgülden sonra söylenen "With these readings, you have ...", ters sıralı "Mit diesen Werten haben Sie Diabetes", ölçümden çıkarılan, "meet the criteria for diabetes", "readings suggest prediabetes", her dilde aralık tanısı: "fall in the diabetes range", "Ihre Werte liegen im Diabetesbereich", "valores en rango diabético", "prediyabet aralığındasınız"). Eğitim cümleleri ("Metformin genellikle ... için kullanılır"), koşullu ve soru cümleleri ("If you have diabetes, ...", "Haben Sie Diabetes?"), "nur gemeinsam mit Ihrem Arzt" gibi hekime bağlayan ifadeler ve zaten kaydedilmiş dozu düzenleme yardımı ("Sie können Ihre Insulindosis im Tagebuch nachträglich ändern", "dose registrada", "kaydettiğiniz dozu", "登録済みの用量") geçer: her dilin ikinci grubu, İngilizcedeki `EN_NOT_ITEM`'ın karşılığıdır (`*_NOT_LOGGED`).

Bilinen sınır: cümleler arası sayısal çıkarım yakalanmaz ("Your fasting average is 119 mg/dL. According to the ADA, a fasting reading of 100 to 125 mg/dL is called prediabetes."). Kullanıcının değeri ile tanı aralığını ayrı cümlelerde yan yana koyan cevap, kural tek cümleyle sınırlı olduğu için geçer; bunu yalnız sistem istemi tutar.

Metin eşleşmeden önce normalleştirilir: NFKC, görünmez ve birleştirici karakterler (ZWSP, yumuşak tire, word joiner, BOM, kontrol karakterleri) silinir, Kiril ve Yunan benzeşikleri Latin'e çevrilir; varsayılan görmezden gelinen karakterler (Hangul dolgu karakteri, Moğol varyasyon seçicisi) ve U+2800 braille boşluğu da silinir. Görünmez karakter varsa metin ayrıca onların yerine boşluk konarak da taranır ("4\u200Bunits" ve "un\u200Bits" ikisi de yakalanır). Metin ASCII dışı karakter içeriyorsa üçüncü bir okuma daha taranır: birleştirici aksanlar soyulur ve ı, ᴜ, ս, ꓴ, օ gibi ayrıştırması olmayan benzeşikler Latin harfe çevrilir ("únits", "uníts", "Einhéiten", "unıts" hepsi "units" ya da "Einheiten" okunur). Bu okuma düz okumanın yerine geçmez, yanına eklenir, çünkü aksan soyma Türkçe ve Fransızca sözcüklerin anlamını değiştirir; Arapça hemze ve Japonca dakuten işaretleri korunur, böylece kuralların kendi istisnaları metni yazıldığı gibi okumaya devam eder. Saf ASCII metinde bu geçiş atlanır.

## Akışta filtre kararı

Deltalar akar; ilk 40 karakter tutulur, akış modelin 32 karakter gerisinden gelir ve filtre her gönderimden önce tam metne uygulanır (istenen her 200 karakter yerine; kontrol bir milisaniyenin çok altında). Eşleşmenin sonu 32 karakterlik payın dışında kaldıysa kesin sayılır ve akış `done{filtered:true, reply:<güvenli metin>}` ile kapanır, istemci gösterdiğini bununla değiştirir. Payın içinde biten (yerleşmemiş) eşleşme henüz engel değildir (sonraki kelime "nicht", "reminder", "olarak" gibi bir istisna getirip eşleşmeyi silebilir) ama eşleşmenin İLK karakterinden itibaren hiçbir şey gönderilmez; böylece payın içine sığan bir yasaklı ifade ("4 units", "metformininizi bırakabilirsiniz") istemciye hiç parça olarak da ulaşmaz.

Sınır: 32 karakterden uzun eşleşmelerde ("you can stop taking your metformin" 34 karakter, "Your fasting readings of 119 fall in the prediabetes range" 58) ilk kelimeler, eşleşme tamamlanmadan önce gidebilir (ilki için bir iki harf, ikincisi için "Your fasting readings of"). İfadenin işlem yapan kuyruğu (fiil ve nesne) hiçbir durumda gitmez, istemci `done.filtered` gelince akıtılanların hepsini atar. Payı büyütmek akışı yavaşlatır, bu yüzden 32'de bırakıldı. Bir dışlama kuralı eşleşmenin sonrasında en çok payın uzunluğu kadar okuyabilir (en uzun ileri bakış, Almanca soru işareti denetimi, 26 karakter); yeni bir dışlama bu payı aşarsa payın içinde bitmiş görünen eşleşme, dışlayan kelime gelmeden kesinleşir. Uzun özneli cümleler de aynı sınırın içindedir: "Your average fasting value across these last fourteen days in the morning hours falls squarely within the prediabetes territory" (özne boşluğu 130 karaktere kadar) her parça boyunda engellenir; en çok "... falls squarely" gider, aralığı adlandıran "within the prediabetes territory" hiç gitmez.

Kod çiti (` ```json `) ve meta satırı akıştan çıkarılır; `done` olayı nihai metni `reply` alanında da taşır ve uygulama akıtılan kelimeler yerine onu gösterir. Model token sınırına çarparsa (`stop_reason: max_tokens`) `done.truncated: true` gelir, meta boş kabul edilir (buton ve kaynak yok) ve uygulama cevabı üç nokta ile bitirir. Görünür metin hiç yoksa (yalnız meta satırı, yalnız ` ``` ` ya da ` ```json ` satırı, görünür metinden önce token sınırı) hata olayı gitmez: akış `done{filtered:true}` ile tarafsız metinle kapanır (`rule: "empty"`), çünkü hata olayını gören uygulama aynı mesajı akışsız ikinci kez ücretli çağırır.
