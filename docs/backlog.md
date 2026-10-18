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
