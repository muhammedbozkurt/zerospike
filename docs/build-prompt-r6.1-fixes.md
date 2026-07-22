# R6.1 FIX PROMPT: R6 Denetiminde Bulunan Acikliklarin Kapatilmasi

R6 teslimi denetlendi. Redesign, Spike, widget ve Faz 6 kalite isleri DOGRULANDI ve kabul edildi; onlara DOKUNMA. Asagidaki liste denetimde bulunan gercek acikliklardir. Sirayla, tek oturumda kapat, sonda tek teslim raporu yaz.

Kurallar R6 ile ayni: notr regulasyon dili, her yeni string 5 dilde (tr/en/de/es/fr), em-dash yok, app.json surumune dokunma. Gateler: `npx tsc --noEmit`, `npm run i18n-check`, `npx tsx scripts/calc.test.ts` temiz.

## P0-1: Calculator otomatik enjeksiyon kaydi checkDose'u atliyor
`app/calculator.tsx:409` dogrudan `logInjection` cagiriyor; `confirmDose` akisi yok. Injection formu ve InjectionEditSheet >=25u tek onay, >=100u ikinci onay istiyor ama calculator'dan gelen doz SIFIR onayla gercek enjeksiyon satiri yaziyor. checkDose tam da bunun icin eklendi.
Fix: Kaydet aksiyonunda doz >=25 ise ayni iki asamali confirmDose akisini calistir; onaylanmazsa HICBIR sey kaydedilmez (yemek + glukoz + enjeksiyon birlikte iptal). Mevcut high_dose NoticeCard bilgilendirme olarak kalabilir.

## P0-2: Yemek silinince/duzenlenince bagli enjeksiyon satiri sahipsiz kaliyor
- Silme: `deleteMealLog` duz DELETE (`lib/db/logs.ts:198`), FK ON DELETE SET NULL (`lib/db/index.ts:200`). Dashboard'dan yemek silinince calculator kaynakli bolus satiri `meal_log_id=NULL` ile yasamaya devam ediyor ve IOB'u sisirmeyi surduruyor.
- Duzenleme: edit dali sadece `updateMealLog` cagiriyor (`app/calculator.tsx:353-361`); bagli enjeksiyonun `dose_units` degeri guncellenmiyor. Yemek 6u'dan 10u'ya duzenlenince IOB hala 6u sayiyor.
Fix:
- `deleteMealLog` icinde (veya cagiran katmanda) `source='calculator'` VE `meal_log_id = silinen yemek` olan enjeksiyon satirini da sil. Elle girilmis (source='manual') satirlara dokunulmaz.
- Calculator edit dalinda: bagli calculator enjeksiyonu varsa dozunu guncelle; yeni doz 0/yok ise satiri sil; satir yoksa ve yeni doz varsa olustur (P0-1'deki onay akisina tabi). Duzenlenen yemege bagli sugar_log varsa glukoz degisikligini de ona yansit.

## P0-3: Undo butun kaydi geri almiyor
`app/calculator.tsx:429-451`: doz varken undo SADECE enjeksiyonu siliyor; yemek satiri, `insulin_dose_units` ve olusturulan sugar_logs satiri kaliyor. Doz yokken olusturulan glukoz kaydinin hic undo yolu yok.
Fix: Tek undo aksiyonu tum kaydi geri alsin: meal_logs + bagli calculator injection_logs + bu kayitta olusturulan sugar_logs satiri birlikte silinir. Toast metni tek ve genel olur ("Kayit geri alindi" tonunda, 5 dil).

## P0-4: Calculator ayni glukozu cift kaydediyor
`app/calculator.tsx:374-383` kosulsuz sugar_logs INSERT ediyor. Kullanici dashboard'dan glukoz girip calculator'a ayni degeri yazinca iki pre_meal satiri olusuyor; ortalamalara, journale ve exporta cift giriyor. Dedup helper'i zaten var (`sugarLogExistsAt`, `lib/db/logs.ts:124-136`) ama sadece Health import kullaniyor.
Fix: INSERT oncesi ayni degerli ve yakin zamanli (+-15 dk) kayit var mi kontrol et; varsa yeni satir ACMA, mevcut satirin id'sini `meal_logs.sugar_log_id`'ye bagla.

## P0-5: v8 migration veri dusurebilir ve atomik degil
`lib/db/index.ts:182-218`:
- `INSERT OR IGNORE` (satir 204): yeni CHECK'lere uymayan eski satirlar (beklenmedik site veya insulin_type degeri) sessizce dusuyor, sonra eski tablo DROP ediliyor. Veri kaybi yolu.
- Transaction yok: DROP ile RENAME arasinda cokme olursa injection_logs tablosuz kalinir ve migration her aciliste yeniden patlar (version ilerlemez, acilis dongusu).
Fix:
- Kopyalama SELECT'inde degerleri normalize et: site enum disindaysa NULL yerine en yakin gecerli degere veya 'abdomen_left_upper' fallback'ine map'le (CASE WHEN), insulin_type bolus/basal disindaysa 'bolus' say; satir asla dusurulmez. OR IGNORE kaldirilir.
- migrateToV8 govdesini `db.withTransactionAsync` icine al (PRAGMA foreign_keys transaction disinda kalmali; SQLite'ta PRAGMA'yi transaction oncesi kapat, commit sonrasi ac).
- Test: scripts altine kucuk bir migration testi ekle (v7 fixture'da gecersiz site degeri olan satir → v8 sonrasi satir sayisi korunur).

## P1-6: Bazal kullaniciya "insulin kullanmiyorsun" metni
`carbFocusBody` (en.ts:249) "You told us you do not use insulin" diyor; bu kart insulin_mode='basal' kullaniciya da gosteriliyor ve ifade onlar icin yanlis.
Fix: Iki ayri govde: none icin mevcut metin, basal icin "Bazal insulin kullandigini belirttin; ogun dozu bolumu bu yuzden gizli" tonunda yeni metin (5 dil). Mod'a gore secilir.

## P1-7: Onboarding aralik kaydinda clamp yok
`app/onboarding.tsx:220-224` min<max kontrolu yapiyor ama `clampTarget` (60-300) uygulamiyor; settings uyguluyor. Onboarding'den 400 gibi bir hedef girilebilir. Karb araligi da hicbir yerde clamplenmiyor.
Fix: Onboarding kaydinda da `clampTarget`/`clampHypoThreshold` uygula. Karb araligi icin makul clamp ekle (orn. 30-600 g) ve settings + onboarding'de kullan.

## P1-8: Eski zinc hex paleti token dosyasinda yasiyor
`lib/theme/tokens.ts:53-61` legacy `COLORS` blogu zinc hexleri iceriyor (#18181b, #27272a, #3f3f46, #71717a, #52525b) ve hala su tuketiciler var: `components/StatCard.tsx` (glass olmayan yol + ikon rengi), `components/ui.tsx` (IconRow, SegmentedStat), `app/(tabs)/index.tsx:752` (Switch trackColor "#3f3f46"), `components/Skeleton.tsx`, `components/EmptyState.tsx`.
Fix: Bu tuketicileri THEME/GLUCOSE_RICH tokenlarina tasi, sonra legacy COLORS blogundan artik kullanilmayan girdileri sil. Görsel regresyon istemiyoruz; birebir ayni koyu ton icin THEME karsiligi yoksa tokens.ts'e semantik isimle ekle (zinc adi gecmesin).

## Teslim raporu
Madde madde: hangi fix nasil kapatildi, dosya listesi, migration testinin ciktisi, gate ciktilari. "Zaten boyleydi" gerekcesi yok; her maddenin davranis degisikligini bir cumleyle kanitla (orn. "yemek silinince bagli enjeksiyon da siliniyor, elle girilen korunuyor").
