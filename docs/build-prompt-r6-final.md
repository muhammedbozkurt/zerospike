# R6 BUILD PROMPT: Guvenlik Duzeltmeleri + Aralik Hedefler + Redesign Bitirme + Spike + Widget

Sen Zerospike'in (React Native / Expo SDK 51, offline-first diyabet gunlugu) gelistiricisisin. Bu prompt R6 turunun tek kaynagi. Asagidaki fazlari SIRAYLA ve TEK OTURUMDA bitir, ara rapor verme, sonda tek teslim raporu yaz. "Zaten uyumlu" gerekcesi her faz icin yasaktir.

## 0. Degismez kurallar (her fazda gecerli)

- REGULASYON DILI: Notr dil zorunlu. Yasak kelimeler: "uyarir/alarm/tani/tavsiye edilen doz". Doz her zaman "hesaplanan/tahmini"dir ve duzenlenebilir. Spike asla doz sayisi vermez ve saglik kaydi gondermez. Hicbir yeni metin tibbi tavsiye tonuna kaymaz.
- I18N: Her yeni string 5 dilde eklenir (tr/en/de/es/fr). Gate: `npm run i18n-check`.
- GATE: Her fazin sonunda `npx tsc --noEmit` temiz olmali.
- Em-dash kullanma (kod yorumlari dahil).
- `app.json` surumune dokunma.
- R5 yapisal islerini bozma: schema v7, liveData.ts, ai-ask-spike edge function, notificationPrefs. ISTISNA: kalem (pen) kalintilari bu turda TAMAMEN sokulecek, bkz. Faz 2 ve Faz 6.
- Mimari: SQLite lokal veritabani tek gercek kaynak, AppContext store, mevcut db/data katmani kaliplarina uy.

---

## FAZ 1: P0 GUVENLIK DUZELTMELERI (en yuksek oncelik)

### 1.1 IOB kopuklugunu kapat (kritik)
Sorun: Calculator, dozu sadece `meal_logs.insulin_dose_units` alanina yaziyor (`app/calculator.tsx:206`), ama `activeInsulin()` yalnizca `injection_logs` icindeki `insulin_type === "bolus"` satirlarini okuyor (`lib/iob.ts:38`). Yani ana akis olan calculator uzerinden yemek loglayan kullanicinin IOB'u 0 gorunuyor, stacking korumasi fiilen calismiyor.

Cozum:
- Calculator'dan yemek kaydedilirken dozla birlikte otomatik bir bolus `injection_logs` satiri olustur (site secimi istenmez, site alani bos/`unspecified` olabilir; gerekiyorsa schema v8 ile site alanini nullable yap).
- Bu otomatik kaydi kullaniciya kayit sonrasi toast/undo ile bildir, Injection sekmesinde duzenlenebilir olsun.
- Cift kayit onlenmeli: kullanici ayni yemegi Injection sekmesinden tekrar girmesin diye otomatik satir `source: "calculator"` benzeri bir isaret tasisin (schema degisikligi gerekirse v8 migration yaz).
- Calculator'a girilen "mevcut glukoz" degeri de kaybolmasin: bir `sugar_logs` kaydi olustur ve `meal_logs.sugar_log_id` ile bagla (su an hep null yaziliyor, `calculator.tsx:208`).

### 1.2 Injection sekmesine doz makulluk kontrolu
`app/(tabs)/injection.tsx:88-92` su an sadece `> 0` kontrolu yapiyor. Calculator'daki `high_dose` esigini (>= 25u, `lib/insulin.ts:40-46`) buraya da uygula: esik ustunde notr bir onay adimi goster ("Girilen doz X u. Kaydetmeden once kontrol et." tonunda), makul ust sinir (orn. 100u) ustunu reddetme yerine ikinci onaya baglayarak kaydet.

### 1.3 Sabit klinik cok-yuksek siniflamasi
`classifyGlucose` (`lib/glucose.ts:95`) kisisel hedefin 1.25 katinda "high" ile bitiyor; sabit klinik esik yok. >= 250 mg/dL icin ayri bir "cok yuksek" sinifi ekle (renk + notr bilgilendirme metni, orn. su icme ve olcum tekrari gibi genel egitim iceriği, tani/tedavi dili YOK). Dusuk tarafta mevcut < 70 akisi korunur.

---

## FAZ 2: TEK DEGER YERINE ARALIK HEDEFLER

Su an hedefler tek skalar: `target_fasting_max` (100) ve `target_postmeal_max` (140) (`app/profile-setup.tsx:39-44`), hipo esigi sabit 70 (`lib/glucose.ts:104`), AGP bandi sabit 70-180 (`lib/agpChart.ts:21-22`). ADA standardi hedefleri ARALIK olarak tanimlar. Yapilacaklar:

- Schema v8 migration (TEK migration, bu fazdaki alanlar + Faz 2B'deki `diabetes_type`/`insulin_mode`/`ratios_confirmed` + Faz 3'teki `site_point` + Faz 6'daki pen temizligi birlikte): `UserProfile` icine `target_fasting_min`, `target_postmeal_min`, `hypo_threshold_mgdl` ekle. Mevcut kullanicilar icin default: fasting 80-130 araligi mantigiyla min=80, postmeal min=80, hypo=70. Mevcut `*_max` degerleri korunur.
- `classifyGlucose` aralik tabanli olsun: kullanici hipo esiginin alti "dusuk", min-max arasi "hedefte", max ustu kademeli "yuksek", Faz 1.3'teki sabit >= 250 en ustte.
- AGP hedef bandini sabit 70-180 yerine profil araligina bagla (gosterim bandi).
- `app/profile-setup.tsx`, `app/(tabs)/settings.tsx` VE `app/onboarding.tsx` "targets" adimi girisleri min-max cift girisli aralik bilesenine donustur (redesign diline uygun, Faz 3 ile ayni gorsel dil). Onboarding'de ayni aralik bileseni kullanilir, ADA defaultlari onceden doldurulmus gelir; hipo esigi onboarding'de SORULMAZ (default 70, settings'te duzenlenir). Validasyon: min < max, makul siniralar (hypo 54-90, hedefler 60-300 araliginda clamp).
- Gunluk karbonhidrat hedefi `daily_carb_target_g` de tek deger; onu da opsiyonel min-max araligina cevir (varsayilan tek degerden turet: min = deger*0.8, max = deger).
- Tum tureyen hesaplar (insights TIR, StatCard renkleri, JournalItem renk kodu, dashboard ring rengi) yeni aralik mantigini kullansin. `estimateInsulin` duzeltme hedefi olarak `target_postmeal_max` yerine aralik ORTA noktasini kullansin ve bu secimi disclaimer metninde "hedef araliginin ortasi" olarak seffaflastir.

---

## FAZ 2B: ONBOARDING KISISELLESTIRME (quiz cevaplari olu veri olmaktan ciksin)

Tespit: Onboarding quiz'inin diyabet tipi ve insulin kullanimi cevaplari AsyncStorage'a yaziliyor (`app/onboarding.tsx:227-228`, `zerospike.diabetesContext` / `zerospike.insulinContext`) ama repo genelinde HICBIR yerde okunmuyor. Kullaniciya sorulan sorular urunu hic sekillendirmiyor; insulin kullanmayan kullanici bile tam insulin arayuzunu (Injection sekmesi, calculator, dashboard IOB satiri) goruyor.

Yapilacaklar:
- Schema v8'e `diabetes_type` ve `insulin_mode` ("basal" | "bolus" | "both" | "none") profil kolonlarini ekle. Onboarding bunlari profile yazsin; mevcut kullanicilar icin migration sirasinda AsyncStorage'daki eski anahtarlardan tek seferlik tasi, yoksa "both" varsay (mevcut davranisi bozmamak icin).
- `insulin_mode === "none"` icin arayuz uyarlansin: Injection sekmesi gizlenir (tab sayisi 3'e iner), dashboard IOB satiri gizlenir, calculator karbonhidrat-odakli moda gecer (doz tahmini bolumu gizli), bazal hatirlatici ayarlari settings'te gizli. Kullanici settings'ten insulin modunu degistirebilir (profil duzenleme icinde), degisince arayuz aninda uyum saglar.
- `insulin_mode === "basal"` icin calculator ve tokluk akisi kalir ama bolus'a ozgu metinler notrlesir.
- Diyabet tipi SADECE metin tonu icin kalabilir (hesaplara asla girmez, regulasyon kurali); ama artik profile'dan okunur.
- GUVENLIK: "Emin degilim" yolu ICR=10 ve ISF=40 varsayilanlarini gercek deger gibi profile yaziyor (`onboarding.tsx:49-51,563-576`) ve calculator bunlarla doz hesapliyor; kullanicinin onayladigi degerlerden ayirt edilemiyor. Schema v8'e `ratios_confirmed` (boolean) ekle: "Emin degilim" ile geçilirse false. False iken calculator sonucunun yaninda notr bir bilgi karti goster: "Hesap varsayilan oranlarla yapildi. Kendi oranlarini saglik ekibinle birlikte Settings'ten girebilirsin." Kullanici settings'te ICR/ISF'yi kaydederse true olur ve kart kaybolur.
- Onboarding'e yeni adim EKLEME (akis uzamasin); tokluk suresi ve hipo esigi settings'te kalir.

---

## FAZ 3: REDESIGN'I BITIR (Midnight Monitor, layout yeniden insa)

Tek kaynak: `docs/design/redesign-mockup.html` (yon B). Kurallar `docs/build-prompt-redesign-binding.md` ile ayni: TASARIM > MEVCUT KOD. Recolor yasak, layout mockup ile eslesmiyorsa view kodunu SIL ve sifirdan yaz. Phase-1 imza bilesenleri (`components/rich/`: GlucoseRing, TIRDonut, GradientAreaChart, GlassCard, IconTile, GradientCTA, ConicAvatar, AppBackground) yapi tasin.

Onceki turun denetim sonucu, ekran ekran durum:

TAMAM (dokunma, sadece regresyon kontrolu): `app/(tabs)/index.tsx` (dashboard), `app/spike.tsx`, `app/(tabs)/settings.tsx`, `components/JournalItem.tsx`.

KISMEN (imza gorsel var, govde eski; govdesini mockup layoutuna gore yeniden yaz ve tum `zinc-*` siniflarini token/rich diline cevir):
- `app/insights.tsx` (38 zinc kalinti, en kotu ekran): TIR donut var ama alti eski. Mockup: TIR donut + gradyan AGP alan grafigi + StatCard seridi.
- `app/(tabs)/food.tsx` (10+ zinc): satirlar hero-food emoji karo + karbonhidrat grami kompozisyonuna donusmeli.
- `app/calculator.tsx` (31 zinc): eski form recolor edilmis, mockup B04 log akisi diline yeniden insa.
- `app/(tabs)/injection.tsx` alt formu (24 zinc): heat-map hero tamam, altindaki doz/tur/not formu yeniden.

ISI HARITASI YENIDEN TASARIMI (bu turun ana UI isi, mockup injection cercevesinin ustune insa et):
- Model degisiyor: vucut BOLGELERE bolunur, her bolgede 4 ENJEKSIYON NOKTASI olur (FITTER kilavuzunun ceyrek/rotasyon modeli). Kullanici enjeksiyonu bolge degil, bolgenin 4 noktasindan biri olarak isaretler.
- `components/InjectionBodyMap.tsx` yeniden yazilacak: mevcut 8 bolge silueti kalir, ama her bolgenin icinde 4 ayri nokta (2x2 dizilim) render edilir. Her nokta ayri secilebilir dokunma hedefi olmali (min 44pt dokunma alani; gerekirse bolgeye dokununca 4 noktali zoom/sheet acilir, kucuk siluet ustunde 32 minik hedef sikistirma).
- Isi gorsellestirme NOKTA seviyesine iner: her nokta son kullanim tarihine ve 30 gunluk kullanim sayisina gore renklenir (sik ve yakin zamanda kullanilan sicak, uzun suredir kullanilmayan sonuk/soguk). En uzun suredir kullanilmayan nokta kesikli isaretle one cikar (mevcut least-used mantiginin nokta seviyesi hali). Dil notr kalir: bu bir kullanim gorsellestirmesidir, "buraya yap" tavsiyesi degildir (PRO rotasyon karti mevcut kalibinda kalir).
- Schema v8: `injection_logs`'a `site_point` (1-4, nullable) kolonu ekle. Eski kayitlar nokta bilgisisiz kalir ve bolge toplaminda sayilir; yeni kayitlar bolge + nokta tutar.
- `getSiteUsageHistory` ve rotasyon/istatistik hesaplari nokta kirilimini destekleyecek sekilde guncellenir; heat map legend'i (en cok / en uzun suredir kullanilmayan) nokta bazina gecer.
- Injection sekmesi akisi: once bolge, sonra nokta secimi tek dokunus zincirinde; secili nokta formda "Karin sol ust, nokta 3" gibi ozetlenir (5 dilde).
- `app/onboarding.tsx` kalan adimlar (reveal/basal kartlari) + `components/onboarding/Reveal.tsx` (17 zinc), `LanguageChip.tsx`.
- `components/GlucoseInputSheet.tsx` (mockup B04 radyal parilti sheet).

HIC DONUSMEMIS / sadece arka plan sarilmis (her biri mockup bolumune gore SIFIRDAN):
- `app/paywall.tsx` (mockup 08: faturalanan tutar baskin kompozisyon), `app/downsell.tsx`, `app/winback.tsx`.
- `app/sos.tsx` (mockup 07: radyal kirmizi parilti, hazir mesaj + arama, notr dil).
- `app/emergency-contacts.tsx`, `app/sources.tsx`, `app/injection-guide.tsx`, `app/profile-setup.tsx` (Faz 2 aralik girisleriyle birlikte), `app/add-food.tsx` (mockup 04).
- `app/scan.tsx`: hicbir rich import yok, `bg-black` duruyor; kamera ekranini tema diline tasi (kamera onizleme haric cerceve/overlay/butonlar).

ORTAK BILESEN TEMIZLIGI (bunlar her ekrana siziyor, hepsinde `zinc-*` sifirlanacak): `components/ui.tsx` (18), `components/form.tsx` (12), `components/Feedback.tsx` (13), `components/InjectionEditSheet.tsx` (12, hic dokunulmamis), `components/StatCard.tsx`, `components/LanguagePicker.tsx`, `components/ProfileSwitcher.tsx`, `components/FoodRow.tsx`, `components/charts/ChartCard.tsx`, `components/InjectionBodyMap.tsx` (4).

Bitis kriteri: `grep -rn "zinc-" app components` SIFIR sonuc dondurmeli (tek istisna: bilincli gri gerekiyorsa token uzerinden). Her ekran icin mockup cercevesiyle layout karsilastirmasi yapilmis olmali.

STORE TEMIZLIGI (bu fazda zorunlu):
- `app/design-gallery.tsx` dosyasini SIL.
- `app/_layout.tsx` icindeki `DEV_SCREENSHOT_ROUTE` kancasini ve `design-gallery` Stack.Screen kaydini SIL.
- HUMAN-TODO.md'deki iki maddeyi isaretle.

---

## FAZ 4: SPIKE AI'YI BITIR (PRO limit + yapilandirma)

Mevcut: chat UI + consent gate + `supabase/functions/ai-ask-spike` hazir ama `extra.spikeFnUrl` yapilandirilmamis (`lib/ai/spikeClient.ts:47`), PRO gunluk limiti yok (spec: `docs/spike-ai.md:44-48`).

- Gunluk limit uygula: free 3 mesaj/gun, Pro 50 mesaj/gun. Gun bazli sayac AsyncStorage'da (`zerospike.spikeDailyCount` + tarih anahtari), gun degisince sifirlanir. Limit dolunca notr bir kart: kalan hak 0, Pro tanitimi + paywall'a yonlendirme (free icin), Pro icin "yarin devam" metni.
- RevenueCat `isProUser` kontrolunu mevcut guardrails kalibiyla kullan.
- `spikeFnUrl` yapilandirilmamissa dashboard'daki sparkles butonu ve settings satiri Spike girisini GIZLE (su an olu uca acilan gorunur buton var, `app/(tabs)/index.tsx:552`).
- Edge function tarafinda da basit rate limit ekle (IP/istek basi makul saatlik tavan) ki URL sizarsa maliyet patlamasin.
- HUMAN (kodlama disinda, rapora "HUMAN bekliyor" olarak yaz, taklit etme): `supabase secrets set OPENAI_API_KEY`, `supabase functions deploy ai-ask-spike`, cikan URL'yi app config `extra.spikeFnUrl`'e koymak.

---## FAZ 5: HOME WIDGET + LIVE ACTIVITY (tokluk sayaci)

Amac: kullanici hatirlaticiya kalan sureyi uygulamayi acmadan gorsun. Mevcut altyapi: `lib/services/liveData.ts` (nextReminderAt/nextReminderKind/son glukoz snapshot'i AsyncStorage'a yaziyor) + spec `docs/native-live-surfaces.md`. Widget extension'lari AsyncStorage OKUYAMAZ; App Group / SharedPreferences semi sart.

- Paketler: `@bacons/apple-targets` (iOS WidgetKit + ActivityKit) ve `react-native-android-widget` (Android home widget). Expo config plugin kurulumlarini yap.
- `syncLiveData`'ya native yazma semi ekle: iOS'ta App Group (`group.com.greeneyeapp.zerospike`) UserDefaults, Android'de SharedPreferences; her snapshot guncellemesinde yaz.
- iOS kucuk widget: son glukoz (renk kodlu) + bir sonraki hatirlaticiya kalan sure (WidgetKit timeline, dakika hassasiyeti yeterli).
- iOS Live Activity: "yemege basladim" / tokluk sayaci basladiginda ActivityKit ile kilit ekrani + Dynamic Island geri sayimi (timer-style, push gerekmez); sayac bitince veya olcum girilince sonlandir.
- Android widget: son glukoz + kalan sure, 15 dk periyodik guncelleme + snapshot degisiminde tetikleme.
- Widget metinleri de 5 dilde.
- HUMAN (rapora yaz, deneme yapma): Apple Developer portal App Group + Live Activity capability, EAS credentials, `npx expo prebuild` + gercek cihaz buildi. Kodun tsc gate'ini native target'lar bozmamali (Swift/Kotlin dosyalari ayri derlenir).

---

## FAZ 6: KALITE VE PARITE DUZELTMELERI

- KALEM (PEN) TAM TEMIZLIGI: Kalemler urunden tamamen cikti. R5 sonrasi kalan her kalinti sokulecek: `injection_logs.pen_id` kolonu schema v8'de kaldirilir (SQLite'ta tablo yeniden olusturma gerekiyorsa migration icinde yap), `pen` gecen tip/alan/yorum/olu kod temizlenir, 5 dildeki kalem i18n anahtarlari silinir, docs/README'de kalem referansi kalmaz. `grep -rni "pen" app components lib supabase` sonucu yalnizca alakasiz eslesmeler (orn. "open", "expo") dondurmeli.
- CSV export birim tutarliligi: mmol/L kullanicisinin CSV'sinde glukoz su an ham mg/dL (`lib/data/export.ts`). Kullanici birimine cevir ve basliga birim kolonu ekle. PDF ile tutarli olsun.
- GMI/eA1c tabani: 5 olcum cok dusuk (`lib/insights.ts:181`). Minimum 14 gun icinde en az 14 olcum sartina cikar; altindaysa GMI'yi gosterme, "daha fazla veri gerekli" notu goster.
- Android bildirim guvenilirligi: `canScheduleExactAlarms` kontrolu ekle; kapaliysa settings ve dashboard'da notr bir "hatirlaticilar kisitlanmis olabilir" karti + sistem ayarina yonlendirme. Bildirim izni sonradan kapatildiysa ayni kart.
- Apple Health import'unda `pickTagForHour` tahmini etiketleri (`lib/services/health.ts:53`) fasting/postmeal ORTALAMALARINI kirletmesin: import edilen kayitlara `source: "health"` isareti koy ve avgFasting/avgPostMeal hesaplarinda yalnizca kullanicinin elle etiketledigi kayitlari kullan (veya import etiketini "manual" yap).
- README.md'yi gercege gore yeniden yaz: 4 sekme, 562 yemek, injection/insights/spike/sos ekranlari, pen kaldirildi, guncel mimari.
- `getRecentMeals` custom-name-only yemekleri atliyor (`lib/data/logs.ts`); tek-tik tekrar loglama icin dahil et.

---

## TESLIM RAPORU FORMATI

Tek rapor, su basliklarla: (1) Faz bazinda yapilanlar, dosya listesi; (2) hangi ekranlarin view kodu sifirdan yazildi; (3) schema v8 migration ozeti; (4) `grep zinc` sonucu, `tsc` ve `i18n-check` ciktilari; (5) HUMAN bekleyen adimlar listesi (Spike deploy, App Group/EAS). "Zaten uyumluydu" cumlesi kurma; her mockup ekrani icin layout karsilastirmasi yapildigini tek tek belirt.
