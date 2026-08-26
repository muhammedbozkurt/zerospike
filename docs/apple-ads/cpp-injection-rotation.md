# CPP 2: Enjeksiyon rotasyonu (Injection Rotation)

**ASC referans adi:** `zerospike-injection-rotation`
**Bagli ad group'lar:** ZS-DE-Generic/Injection-Rotation, ZS-FR-Generic/Injection-Rotation,
ZS-TR-Generic/Injection-Rotation

Dar ama ayirt edici bir CPP: rakiplerin cogunda nokta seviyesinde rotasyon takibi yok, bu yuzden
bu ad group'larin donusum oraninin diger gruplardan yuksek cikmasi beklenir. Test fazinda en cok
izlenecek ikinci metrik budur (bkz. plan.md, olcum bolumu).

## Ekran goruntusu sirasi

| Sira | Dosya | Neden bu sirada |
|---|---|---|
| 1 | `02-bodymap.png` | Aranan seyin tam karsiligi; vucut haritasi ilk ekranda gorunmeli |
| 2 | `01-ring.png` | Uygulamanin geri kalani, gunluk baglami |
| 3 | `09-reminders.png` | Rutin kurma, rotasyonun surekliligi |
| 4 | `05-insights.png` | Gecmis veri gorunumu |
| 5 | `06-report.png` | Doktora hazir PDF |

## Promotional Text (170 karakter siniri)

**de (Sie/Ihr):**
Ihre protokollierten Injektionen auf einer Körperkarte. Sie sehen den Punkt, den Sie am längsten nicht genutzt haben, plus neutrale Hinweise zur Aufnahme je Region.

**fr (vous/votre):**
Vos injections notées sur une carte du corps. Vous voyez le point que vous n'avez pas utilisé depuis le plus longtemps, avec des notes neutres sur l'absorption.

**tr (cogul-nazik):**
Kaydettiğiniz enjeksiyonlar vücut haritasında. En uzun süredir kullanmadığınız noktayı görürsünüz; her bölge için nötr emilim notları yer alır.

**en:**
Your logged injections on a body map. See the point you have not used for the longest time, plus neutral notes on typical absorption by region.

## Uyum kontrolu

- `docs/aso-appstore.md` kural 7: metin insulin tipini bolgeye baglamiyor, bolge onermiyor.
  Yalniz "en uzun suredir kullanilmayan nokta" ve notr emilim notu geciyor.
- Doz, hesaplama, tedavi dili yok.
- Sonuc vaadi yok.
- Em-dash yok. Her dil kendi tek hitabini koruyor.
