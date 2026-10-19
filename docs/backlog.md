# Backlog

Sürüm 2.4 sonrası ve beklemedeki işler. Karara bağlanmış konular için scratchpad/hub-kararlar.md.

## Veri: karma yemek karbonhidrat kaynak taraması
Jambalaya 24, Tteokbokki 35, Chilaquiles 24, Shepherd's pie 16 ve Gumbo 14 (100 g) için kaynaklı karşılaştırma; ayrıca lifli tohum tutarsızlığı: Haşhaş 28, Hindistan cevizi 24 ve Badem 22 lif hariç değil, Chia ve Keten ise kullanılabilir karbonhidrata çekildi. Ayrıntı docs/food-sources.md "Doğrulanması gereken".

## Arapça PDF: AGP son saat etiketi
Arapça (RTL) PDF raporunda AGP grafiğinin son saat etiketi "24:00" sağ kenarda "24" olarak kırpılıyor. Eski bir sorun, 2.4 K12 denetiminde görüldü. Kapsam: lib/services/report.ts AGP SVG'si, RTL yönde sağ kenar boşluğu veya etiket hizası. Kabul: ar PDF'te son etiket tam görünür; diğer dillerde değişiklik yok; scripts/reportLayout.test.ts'e ar için kontrol.

## Railway taşıması (2.4 sonrası, ayrı sürüm gerektirir)
Sunucu tarafını (track, rc-webhook, delete-device, ai-ask-spike) Supabase'den Railway'e taşıma. Ön koşul eksik: Railway'de zerospike için proje yok (hesapta yalnızca kip-server), Postgres ve beş değişken (AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, SPIKE_MODEL, SPIKE_MODEL_PREFIX, RC_WEBHOOK_SECRET) kurulmadı. Taşıma uygulamadaki fonksiyon adreslerini değiştirir, bu yüzden yeni bir sürüm ve eski Supabase fonksiyonlarının yönlendirici olarak bir süre kalması gerekir. Eski Supabase projesi, 2.3.7 payı mağaza verisinde yüzde ikinin altına inince kapatılır. Tasarım taslağı (tek Deno servisi, doğrudan Postgres, Deno.cron temizlik işleri, migration koşucu, güvenlik modeli aynı) ve faz planı K13 kartında. Başlamadan önce: kullanıcı Railway projesini ve değişkenleri kurar, `railway link` yapar.

## K4b anahtar kelime önerileri (2.4'te uygulandı)
O1 (de keywords) ve O2 (tr keywords) 2.4 ile uygulandı; aşağıdaki K4b listesinde kalanlar açık. Veri toplama dosyaları: scratchpad/hub-k4b-alanlar.md ve scratchpad/hub-k4b-aramalar.md. Kullanıcı onayı olmadan mağaza dosyaları değiştirilmez.

## Açık tema kullanım oranı haftalık rapora
scripts/metrics-weekly.mjs'e açık, koyu ve sistem tercih dağılımı eklenmesi. Gerekir: tema tercihi için analitik olayı (örneğin theme_pref_set {pref: light | dark | system}, sağlık çıkarımı yok, rıza kapsamında, şema v3, track fonksiyonunun önce yeniden deploy edilmesi), Supabase görünümü (v_theme_pref_daily) ve rapor satırı (rıza oranı ve n ile). Ayarlardaki tercih değişimi ve ilk çözümlenen varsayılan (yeni kurulum açık, mevcut kullanıcı koyu) ayrı sayılmalı.

## Spike 502 (upstream) ret sayacı
`spike_reject_usage` yalnız 429 nedenlerini (ip, device, global) sayar; model hatası 502 `upstream` sayılmaz. Gerekir: `spike_release`'te 'upstream' nedeninin sayıma yazılması, `reason` check kısıtının bu değeri kabul edecek şekilde genişletilmesi (yeni göç), `v_spike_gate_daily` görünümüne upstream sütunu ve scripts/metrics-weekly.mjs'e ret ve upstream oranı satırı. PII yine yok (cihaz kimliği, adres özeti, metin tutulmaz). Kabul: upstream hatası simülasyonunda sayaç bir artar, 429 sayıları değişmez, haftalık raporda satır görünür, 90 gün sonra `purge_spike_logs` siler.

## K4b anahtar kelime ve Play başlık önerileri (2.3.7 deneyi 2026-11-03'ten sonra)
Not: O1 ve O2 2.4'te uygulandı (tamamlandı). 2.4 anahtar kelime değişikliği nedeniyle K33/K34 4 haftalık sıra karşılaştırması (2026-11-03) geçersiz; karşılaştırma yeniden tasarlanmalı veya düşürülmeli. Kalan maddeler yeni sürümle gider. Kaynak: scratchpad/hub-k4b-oneri.md. Veri zayıf (yalnız US Apple Ads, 541 gösterim, ilgili terimlerde 0 tık), sıra verisi erişimi ayrıca gerekir.
- O1 (tamamlandı, 2.4): de keywords "typ 1,typ 2"; "a1c" ve "pen" çıkarıldı.
- O2 (tamamlandı, 2.4): tr keywords sonuna ",ilaç" eklendi.
- K33.3 m1 Play başlık eşitleme (Play başlığını App Store adına eşitle): önce tr, de, es, it, pt Short metinlerinin yeniden yazılması gerekir.
- K33.4 koşullu: ja "妊娠糖尿病" sırası düşerse "予備軍" çıkar, "妊婦" yerine "妊娠糖尿病"; de "werte" yalnız O1 uygulanmazsa ("protokoll" yerine).
- O3 Apple Ads exact negatif "my chart" ve "my chart app" (gösterimlerin %39'u, alakasız marka sorgusu). Metadata değil kampanya işi; `--apply` komutunu kullanıcı koşar.

## expo-doctor: 12 paket SDK 57 önerilen sürümünün gerisinde
expo-doctor "packages match SDK 57 versions" kontrolü 12 paket için uyarıyor: expo, expo-constants, expo-contacts, expo-crypto, expo-linking, expo-location, expo-notifications, expo-router, expo-sharing, expo-splash-screen, expo-sqlite, expo-updates. Hepsinin package.json aralığı 2.3.7 yayın commit'iyle (5740b58) aynı olduğu için 2.4'te dokunulmadı (yayındaki sürümle aynı kod). Hizalama ayrı bir iş: `npx expo install <paket>` ile, tam test ve cihaz QA ile.

## Site görselleri: it, pt, ar, ja (açık tema)
Web sitesinde it, pt, ar ve ja için açık tema görselleri yok. Üretim: yalnız pipeline/v2 produce-v2.mjs.

## Yeni ikon vektörü: favicon.svg ve brand/mark.svg
favicon.svg ve brand/mark.svg 2.4 uygulama ikonuyla yeniden çizilip güncellenmeli.

## Gizlilik sayfaları: diğer 7 dilin çevirisi
Gizlilik sayfasının en ve tr dışındaki 7 dile çevirisi (de, fr, es, it, pt, ar, ja); her dilde tek resmi hitap.

## Uyarı cümleleri: terapia / tratamento
it "terapia" ve pt "tratamento" geçen uyarı cümleleri regülasyon diliyle yeniden gözden geçirilmeli (tedavi/tanı çerçevesi yasak; günlük, takip, hatırlatıcı çerçevesi).

## Eski Firebase projesini kapatma
2.3.x payı mağaza verisinde yüzde ikinin altına inince Firebase projesi kapatılır (uygulamada Firebase 2.4'te kaldırıldı).

## Apple Watch komplikasyon karesi (elle)
Mağazada Apple Watch için tek kare (watch-01) var. Komplikasyon karesi simülatörde otomatikleştirilemedi (bu makinedeki Xcode 27'de Simulator.app yok; yüz yapılandırması enjeksiyonu Apple'ın kendi komplikasyonlarında bile render olmadı). Gerçek Simulator GUI olan makinede:
1. ASO_Watch_S12 (watchOS 27, Series 12 46mm) simülatörünü aç, ZerospikeWatch'ı kur.
2. Demo LiveData'yı App Group'a yaz (group.com.greeneyeapp.zerospike, 112 mg/dL; yöntem ve dil etiketleri scratchpad/k28b-shoot.py).
3. Kadrana uzun bas, Düzenle'de Utility ya da Infograph Modular seç; köşe slotuna zerospike'ı ata (kind ZerospikeComplications).
4. `xcrun simctl io <UDID> screenshot out.png` (416x496).
5. Dil başına sim dilini değiştirip tekrarla; fastlane/screenshots/<yerel>/watch-02.png (en-GB=en, es-MX=es, fr-CA=fr).
6. Yükleme: geçici Fastfile ile deliver, skip_metadata, overwrite_screenshots; öncesi ve sonrası iPhone/iPad 8/8 sayımı doğrulanır.
Durum çubuğu saati: simctl status_bar watchOS'ta desteklenmiyor, sim saati host saatinden gelir; 9:41 için host saati geçici ayarlanır.

## Wear OS: kayıt akışı karesi
Play'de Wear OS için 3 kare (glance, tile, komplikasyon). Saat uygulamasında kayıt akışı yok (yalnız glance, tile, komplikasyon); 4. kare ancak gerçek bir kayıt akışı eklenirse çekilir.

## Gizlilik politikası: 7 dil çevirisi (geri bildirim dahil)
de, fr, es, it, pt, ar, ja: 19 Ekim 2026 tr/en metnindeki yenilikler dahil. (a) bölüm 7 altındaki "Geri bildirim ve iptal anketi" başlığı, (b) bölüm 5'teki Spike karbonhidrat tahmini cümlesi, (c) Sağlık maddesindeki karbonhidrat/insülin yazma anahtarları ve arka plan okuma cümlesi, (d) kurulum kimliğinin takma adlı olduğu ve e-postanın yalnız kullanıcı yazarsa geri bildirim kaydında saklandığı düzeltmeleri (bölüm 5, 7, 11, 13), (e) saklama ve silme listelerine geri bildirim. Her dilde tek resmi hitap korunur. Çeviri yayınlanana kadar uygulama bu dillerde /en/ sayfasını açar. Kaynak: greeneyeapp-site-2.4 dalı site-2.4 (0acc7c9); main (6396f1e) bu iki gizlilik dosyasının güncel hâlini taşımıyor.

## Yayın: zerospike politika ve destek sayfaları (FTP)
11 dosya greeneyeapp-site-2.4'ten FTP/SFTP ile aynı yola yüklenir (greeneyeapp-site/README.md Deployment); klasörün tamamı senkronlanmaz (bekleyen pazarlama sayfaları var). Sonrasında .env yüklenmediği, /zerospike/support formu, 301'ler ve sitemap kontrol edilir.
