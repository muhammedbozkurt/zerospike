# zerospike R5: gorsel yogunluk + isi haritasi + Spike AI + home widget (2026-07-20)

Sen zerospike reposunda calisan bir BUILD session'isin. Kurallar:
- Em-dash ("—") HICBIR YERDE. Gereksiz yorum yok. Her yeni string 5 dilde
  (en/tr/de/fr/es; tr.ts sema kaynagi, `npm run i18n-check` ile parite).
- REGULASYON DILI SERT SINIR: "uyarir / alarm / tani / tedavi / onerilen doz /
  bayilabilirsin" sinifi ifadeler YASAK. zerospike bir gunluk defteridir; hicbir
  yuzey tibbi tavsiye vermez. Bu tur boyunca her yeni metni bu suzgecten gecir.
- Kapilar: `npx tsc --noEmit` + `npm run i18n-check` yesil. app.json version/build'e
  DOKUNMA (bump hub'da). Fazlar arasi onay bekleme; faz sirasi asagidaki gibi.
- Cihaz QA tur sonunda kullanicida; raporda HUMAN kalemlerini ayrica listele.

## Faz 1: Metin yogunlugunu dusur, gorsellestir (uygulama geneli)

Kullanici geri bildirimi: "cok fazla text var". Once denetim yap: (tabs)/index,
insights, injection, food ve add-food/calculator ekranlarindaki metin bloklarini
say, en yogun 5 yuzeyi rapora yaz. Sonra donustur:
- Buyuk sayi + kucuk etiket deseni (deger on planda, aciklama caption'a),
- paragraflar yerine ikon + tek satirlik etiketli kartlar,
- mevcut SVG altyapisiyla (react-native-svg + agpChart matematigi) mini grafik/
  sparkline'lar; insights'taki mevcut grafikler korunur, dashboard'a ozet gorsel gelir.
- Navigasyonu ve bilgi mimarisini DEGISTIRME; bu bir yeniden-tasarim degil,
  yogunluk azaltma turu. Tema token'larina sadik kal.

## Faz 2: Enjeksiyon bolge isi haritasi

- ONCE DOGRULA: enjeksiyon kayitlarinda bolge (site) alani var mi? (lib/db semasi +
  (tabs)/injection.tsx akisi). Yoksa: nullable `site` alani ekle (migration; eski
  kayitlar site'siz kalir, kirilma yok) ve kayit akisina bolge secici koy
  (govde silueti uzerinden dokunarak secim: karin 4 ceyrek, sol/sag uyluk,
  sol/sag kol, sol/sag kalca).
- Isi haritasi: injection sekmesine govde silueti (SVG, tema uyumlu): son 30 gunun
  kullanim yogunlugu bolge basina renk siddetiyle; en az kullanilan bolge gorsel
  olarak ayrisir. Metin dili notr: "son 30 gun kullanim" / "en az kullanilan bolge".
  "Onerilir/tavsiye edilir" KULLANMA; gorsel kendisi anlatir.
- Bos durum: hic site kaydi yoksa harita soluk + tek satir aciklama.

## Faz 3: Spike AI (statura Ask desenini uyarlaMA, sifirdan kucuk kopya)

Isim: **Spike**. Kaynak desen statura reposunda mevcut (../statura):
lib/ai/askClient.ts + supabase/functions/ai-ask + AiDataExplainer/onay kapisi.
Oradan UYARLA (kopyala-yapistir degil; zerospike'in temasi ve i18n'i):
- Edge function: statura'nin Supabase projesinde YENI function `ai-ask-spike`
  (ayri system prompt + ayri gunluk cap). Function deploy'u HUMAN kalemi;
  function kodunu repoya `supabase/functions/ai-ask-spike/` olarak yaz.
- SYSTEM PROMPT SERT KURALLARI (function icinde): Spike bir gunluk-defteri
  asistanidir; genel diyabet egitimi ve uygulama kullanimi anlatir. DOZ SORULARINA
  ASLA sayi vermez ("ne kadar insulin" sinifi -> kibar ret + saglik profesyoneline
  yonlendirme). Tani/tedavi/ilac degisikligi onerisi vermez. Acil belirti
  anlatilirsa tek cumleyle profesyonel yardima yonlendirir (panik dili yok).
- VERI SINIRI (v1, pazarliksiz): kullanicinin yazdigi soru + o sohbetin son
  mesaj penceresi disinda HICBIR SEY gonderilmez. Saglik kayitlari (seker/ogun/
  insulin loglari) AI'ya GONDERILMEZ; system prompt kullanici verisi icermez.
- Onay kapisi (Apple 5.1.1 dersi, statura'da yasandi): ilk mesajdan once acik
  onay ekrani: ne gonderilir (soru + sohbet penceresi), kime (sunucumuz uzerinden
  OpenAI), neyin GONDERILMEDIGI (saglik kayitlarin, kimligin), gizlilik politikasi
  linki. Onay MMKV'ye persist; fail-closed (client giriste bayrak kontrolu);
  Settings'ten geri cekilebilir. Buton kelimeleri notr ("Kabul et ve devam et").
- Erisim: sekme DEGIL; insights veya settings'ten giris + dashboard'da kucuk
  giris karti. Free/Pro siniri statura desenindeki gibi gunluk soru cap'i
  (RC config'e uygun; serbest karar, rapora yaz).
- Her yanitin altinda kalici tek satir: "Spike tibbi tavsiye vermez."

## Faz 4: Home widget (hatirlatici geri sayimi)

Amac: kullanici uygulamayi acmadan bir sonraki hatirlaticiya (tokluk olcumu vb.)
ne kadar kaldigini gorsun.
- ONCE DOGRULA: hatirlatici kaynagi tek yerde mi? (lib/postMealTimer.ts formatlama;
  kurulum notifications tarafinda). Widget'a veri akisi icin "siradaki hatirlatici
  zamani" tek bir kaynak fonksiyona baglanmali.
- iOS: WidgetKit small widget. Yol: `@bacons/apple-targets` (expo config plugin,
  Swift widget target). App Group + paylasimli storage: RN tarafi hatirlatici
  kurulunca hedef zamani App Group UserDefaults'a yazar; widget Swift tarafinda
  `Text(timerInterval:)` ile CANLI geri sayim gosterir (timeline yenileme derdi
  yok, sistem sayar). Hatirlatici yoksa "hatirlatici yok" durumu. Tik = uygulama.
- Android: `react-native-android-widget` (Expo config plugin destekli). Canli
  sayim yerine hedef saat gosterimi yeterli ("18:30") + son guncelleme davranisini
  rapora yaz. Ayni tek-kaynak fonksiyondan beslenir.
- Ikisi de yeni native yapi = prebuild sart; App Group id (group.com.greeneyeapp.
  zerospike) entitlement'i EAS credentials'a yansimali: gerekli HUMAN adimlarini
  (Apple Developer portal / EAS uyarilari) raporda acikca listele.
- Widget metinleri 5 dilde (widget tarafinda sistem lokalizasyonu: iOS tarafi
  Localizable.strings, Android string resources; nasil cozduklerini rapora yaz).

## Teslim raporu

Faz 1 denetim tablosu (once/sonra), Faz 2 sema karari (site alani var miydi),
Faz 3 function dosya yolu + cap degerleri + onay metinleri, Faz 4 secilen paketler,
App Group/HUMAN adimlari, calisma kanitlari (tsc + i18n-check ciktilari), onerilen
commit listesi. docs/ altina kisa bir widget-mimarisi notu birak (App Group anahtar
adlari; ileriki Live Activity dusunulurse temel bu olacak).
