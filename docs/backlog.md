# Backlog

Sürüm 2.4 sonrası ve beklemedeki işler. Karara bağlanmış konular için scratchpad/hub-kararlar.md.

## Arapça PDF: AGP son saat etiketi
Arapça (RTL) PDF raporunda AGP grafiğinin son saat etiketi "24:00" sağ kenarda "24" olarak kırpılıyor. Eski bir sorun, 2.4 K12 denetiminde görüldü. Kapsam: lib/services/report.ts AGP SVG'si, RTL yönde sağ kenar boşluğu veya etiket hizası. Kabul: ar PDF'te son etiket tam görünür; diğer dillerde değişiklik yok; scripts/reportLayout.test.ts'e ar için kontrol.

## Railway taşıması (2.4 sonrası, ayrı sürüm gerektirir)
Sunucu tarafını (track, rc-webhook, delete-device, ai-ask-spike) Supabase'den Railway'e taşıma. Ön koşul eksik: Railway'de zerospike için proje yok (hesapta yalnızca kip-server), Postgres ve beş değişken (AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, SPIKE_MODEL, SPIKE_MODEL_PREFIX, RC_WEBHOOK_SECRET) kurulmadı. Taşıma uygulamadaki fonksiyon adreslerini değiştirir, bu yüzden yeni bir sürüm ve eski Supabase fonksiyonlarının yönlendirici olarak bir süre kalması gerekir. Eski Supabase projesi, 2.3.7 payı mağaza verisinde yüzde ikinin altına inince kapatılır. Tasarım taslağı (tek Deno servisi, doğrudan Postgres, Deno.cron temizlik işleri, migration koşucu, güvenlik modeli aynı) ve faz planı K13 kartında. Başlamadan önce: kullanıcı Railway projesini ve değişkenleri kurar, `railway link` yapar.

## K4b anahtar kelime önerileri (kullanıcı onayı bekliyor)
Mağaza metni veri toplama dosyaları hazır: scratchpad/hub-k4b-alanlar.md (en, tr, de, fr, es App Store ve Play alanları) ve scratchpad/hub-k4b-aramalar.md (Apple Ads 30 günlük arama terimleri, örneklem çok küçük). Anahtar kelime değerlendirmesi ve düzeltilmiş alan önerileri henüz yazılmadı. Kullanıcı onayı olmadan mağaza dosyaları değiştirilmez.

## Açık tema kullanım oranı haftalık rapora
scripts/metrics-weekly.mjs'e açık, koyu ve sistem tercih dağılımı eklenmesi. Gerekir: tema tercihi için analitik olayı (örneğin theme_pref_set {pref: light | dark | system}, sağlık çıkarımı yok, rıza kapsamında, şema v3, track fonksiyonunun önce yeniden deploy edilmesi), Supabase görünümü (v_theme_pref_daily) ve rapor satırı (rıza oranı ve n ile). Ayarlardaki tercih değişimi ve ilk çözümlenen varsayılan (yeni kurulum açık, mevcut kullanıcı koyu) ayrı sayılmalı.

## Spike 502 (upstream) ret sayacı
`spike_reject_usage` yalnız 429 nedenlerini (ip, device, global) sayar; model hatası 502 `upstream` sayılmaz. Gerekir: `spike_release`'te 'upstream' nedeninin sayıma yazılması, `reason` check kısıtının bu değeri kabul edecek şekilde genişletilmesi (yeni göç), `v_spike_gate_daily` görünümüne upstream sütunu ve scripts/metrics-weekly.mjs'e ret ve upstream oranı satırı. PII yine yok (cihaz kimliği, adres özeti, metin tutulmaz). Kabul: upstream hatası simülasyonunda sayaç bir artar, 429 sayıları değişmez, haftalık raporda satır görünür, 90 gün sonra `purge_spike_logs` siler.

## K4b anahtar kelime ve Play başlık önerileri (2.3.7 deneyi 2026-11-03'ten sonra)
Karar: 2.4'te mağaza metni değişmez. K33/K34 4 haftalık sıra karşılaştırması 2026-11-03'te kapanınca aşağıdaki maddeler değerlendirilir; hepsi yeni sürümle gider. Kaynak: scratchpad/hub-k4b-oneri.md. Veri zayıf (yalnız US Apple Ads, 541 gösterim, ilgili terimlerde 0 tık), sıra verisi erişimi ayrıca gerekir.
- O1 de keywords: "typ" yerine "typ 1,typ 2"; "a1c" ve "pen" çıkar (100/100). Risk orta: DE ödeme yapan pazar, a1c ve pen sorgularının bugünkü sırası bilinmiyor. Alternatif: "typ,1,2", yalnız "a1c" çıkar.
- O2 tr keywords sonuna ",ilaç" (94 -> 99); hiçbir terim düşmez, risk düşük.
- K33.3 m1 Play başlık eşitleme (Play başlığını App Store adına eşitle): önce tr, de, es, it, pt Short metinlerinin yeniden yazılması gerekir.
- K33.4 koşullu: ja "妊娠糖尿病" sırası düşerse "予備軍" çıkar, "妊婦" yerine "妊娠糖尿病"; de "werte" yalnız O1 uygulanmazsa ("protokoll" yerine).
- O3 Apple Ads exact negatif "my chart" ve "my chart app" (gösterimlerin %39'u, alakasız marka sorgusu). Metadata değil kampanya işi; `--apply` komutunu kullanıcı koşar.

## expo-doctor: 12 paket SDK 57 önerilen sürümünün gerisinde
expo-doctor "packages match SDK 57 versions" kontrolü 12 paket için uyarıyor: expo, expo-constants, expo-contacts, expo-crypto, expo-linking, expo-location, expo-notifications, expo-router, expo-sharing, expo-splash-screen, expo-sqlite, expo-updates. Hepsinin package.json aralığı 2.3.7 yayın commit'iyle (5740b58) aynı olduğu için 2.4'te dokunulmadı (yayındaki sürümle aynı kod). Hizalama ayrı bir iş: `npx expo install <paket>` ile, tam test ve cihaz QA ile.
