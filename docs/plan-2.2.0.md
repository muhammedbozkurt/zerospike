# 2.2.0 Master Plan (onay: 2026-08-20, "hepsi 2.2.0'da, 2.3.0'a bir sey kalmasin")

Kaynak kararlar: 2.1.0 yayin sonrasi kullanici bulgulari (10 madde) + AlarmKit
(docs/alarmkit-2.2.0.md, o dosya bu planin parcasidir) + gorsel borcu.

## Kapsam

### A. Hatirlatici sistemi
1. AlarmKit (docs/alarmkit-2.2.0.md): gercek alarm opt-in (iOS 26+), tokluk
   sayaci icin AlarmKit timer degerlendirmesi dahil. reminders.alarm_enabled
   kolonu v19'a girer.
2. Hatirlatici ekleme/duzenleme MODAL'a cevrilir (SavedMedEditSheet gorsel
   dili): tur + saat + Ilac turunde MedNamePicker / Ozel turde serbest metin +
   Kaydet/Vazgec. Inline kart formu kalkar.
3. Ilac turu hatirlaticida serbest isim kalkar: MedNamePicker (bos birakilirsa
   genel "Ilac" etiketi).
4. COKLU PROFIL: reminders tablosuna profile_id (v19, mevcut satirlar aktif
   profile atanir, kopru bir kez); gate'ler profil-yerel olur, profil degisimi
   o profilin setini uygular. (Kullanici vetosu gelirse bu madde cikar,
   cihaz-geneli semantik kalir.)
5. Profildeki "Ilac hatirlaticisi kur" kisayolu kaldirilir (bildirimlerdeki
   Hatirlaticilarim girisi tek yol).

### B. Profil / tip akislari
6. "Agizdan ilac takibi" switch'ine aciklama satiri (ne acar: kayit girisi,
   Ilaclarim, ilac hatirlaticilari). 9 dil.
7. Tip degisiminde tedavi sorusu ZORUNLU adim olur: iki asamali onaya ucuncu
   modal (tip1/tip2/gestational 4'lu; prediyabet/tanisiz otomatik kapanis
   mevcut davranis). Onboarding'deki soruyla ayni metinler.

### C. Onboarding
8. TUM yollara istege bagli "olcum hatirlaticisi kur" adimi (hap yolundaki
   ilac-hatirlatici deseninin aynisi; prediyabet/tanisiz basligi olcum
   rutinine gore). 9 dil.
9. Prediyabet/tanisiz yolunda kaynaklara (CDC/ADA) tek satir isaret. 9 dil.

### D. Icgoruler (premium paket, TAM menu)
10. (a) Haftalik karsilastirma karti (bu hafta vs gecen: TIR/ortalama/CV, ok
    isaretleri) (b) saat-dilimi isi seridi (c) AGP p5-p95 yuzdelik golgesi
    (d) en iyi gun + seri kartlari (e) ogun yaniti ozeti (ortalama tokluk
    deltasi, en iyi/en kotu ogunler) (f) CV trendi (g) hepsinin PDF rapora
    islenmesi. Pro kapsami: mevcut insights Pro siniriyla ayni (serbest
    kullanici kilitli onizleme gorur, mevcut desen).
11. Not: "haftalik ozet bildirimi Pro olsun" karari IPTAL edilmisti
    (2026-08-19), bu pakette yeniden acilmaz.

### E. Gorsel + store
12. 02-bodymap kompozitleri 9 dilde gozlemci duzeniyle yeniden (borc).
13. Yeni icgoru ekrani 05-insights panelini degistirirse 9 dilde yeniden
    cekim/uretim karari uygulama gorunumune gore verilir.
14. Surum notlari 9 dil + review notu guncellemesi (AlarmKit beyani dahil).

## Teknik notlar
- v19 migration TEK adimda: reminders.profile_id + reminders.alarm_enabled.
  Create-only + damga + M-deseni testler.
- Metro canliyken JS duzenleyen ajan calistirmama kurali (2.1.0 dersi).
- Kapilar: typecheck + i18n + tum scripts/*.test.ts; yeni ozelliklere test.
- Regulasyon cizgileri aynen: deger-tetiklemeli alarm yok; icgoru metinleri
  betimleyici, yorum/oneri dili yok.

## Dalga taslagi (dosya cakismasiz)
- D1: v19 + hatirlatici modal/picker/profil-kapsam (A2-A4) | icgoru veri
  katmani (D10 hesaplar, lib/insights*) | onboarding adimlari (C8-C9)
- D2: AlarmKit native modul + entegrasyon (A1) | icgoru UI + PDF (D10g) |
  profil/tip akislari (B6-B7, A5)
- D3: adversarial denetim + dil QA + RTL/iPad kontrol | gorseller (E12-E13)
- D4: notlar/review/store metinleri (E14) + kapilar + surum bump + commit
