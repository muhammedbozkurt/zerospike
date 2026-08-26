# zerospike App Store + Google Play ASO - Index (2026-08, 2.3.0 round)

This is the overview and rule set. The actual per-store, per-language copy lives in
one file per language under `zerospike-store/aso/`:

- English: [../zerospike-store/aso/en.md](../zerospike-store/aso/en.md)
- Turkish: [../zerospike-store/aso/tr.md](../zerospike-store/aso/tr.md)
- German: [../zerospike-store/aso/de.md](../zerospike-store/aso/de.md)
- Spanish: [../zerospike-store/aso/es.md](../zerospike-store/aso/es.md)
- French: [../zerospike-store/aso/fr.md](../zerospike-store/aso/fr.md)
- Italian: [../zerospike-store/aso/it.md](../zerospike-store/aso/it.md)
- Portuguese (BR): [../zerospike-store/aso/pt.md](../zerospike-store/aso/pt.md)
- Arabic: [../zerospike-store/aso/ar.md](../zerospike-store/aso/ar.md)
- Japanese: [../zerospike-store/aso/ja.md](../zerospike-store/aso/ja.md)

2.3.0 ASO round (2026-08-24): research, per-market rationale, A/B alternatives and
sources live in [../zerospike-store/aso/aso-2.3.0-research.md](../zerospike-store/aso/aso-2.3.0-research.md).
Previous field values are kept inline as "(onceki: ...)" lines in each language file.

Each language file has an **App Store** block (App name, Subtitle, Promotional Text,
Keywords, Description, What's New) and a **Google Play** block (Title, Short
description, Full description). Character counts are noted in parentheses after every
length-limited field.

## Character limits

- App name / Play title: 30
- Subtitle: 30
- Promotional Text: 170
- Keywords (App Store): 100 BYTES (UTF-8), comma-separated, no space after commas.
  Apple's metadata spec defines this limit in bytes (Japanese chars = 3 bytes,
  Arabic = 2, Turkish diacritics = 2); App Store Connect may accept 100 characters,
  but we target 100 bytes so nothing risks being cut from the index. Never repeat
  words already in the name or subtitle. Verify with zerospike-store/aso research
  script counts, never by hand.
- Description / Play full description: 4000
- Play short description: 80

## Regulation rules (mandatory - Apple 1.4.1 / 2.3, medical-app scrutiny)

1. No health-claim or outcome language anywhere. Forbidden ideas: control, lower,
   reduce, prevent, "manage your diabetes", treat, diagnose, "improve control",
   "keep glucose in range" as a promise. Use instead: track, log, record, see,
   review, monitor (as in observe), organize, keep a history. ("Time in range" is
   used only as the name of a descriptive metric over past data, never as a promise.)
2. The phrase "insulin calculator" must never appear, in any language. Insulin doses
   are only logged / recorded / kept, never "calculated" or "dosed" by the app.
3. Neutral, factual, non-promissory tone. No "your health companion" hype.
4. Each long description carries a neutral disclaimer: the app is for personal
   tracking, is not medical advice and is not a medical device.
5. No em-dashes anywhere. Use hyphens or semicolons.
6. Never mention Apple Watch / watchOS or any feature not in the confirmed list.
7. The app never links insulin type to injection region; copy must not imply it
   recommends a site for a given insulin. Injection copy is rotation- and
   usage-based only ("longest-unused point"), plus neutral absorption-speed notes.

## Play vs App Store difference (Health Connect)

Health Connect was removed from Android (2026-07-08 Play policy). The Apple Health
"read your own glucose" line and the iOS Live Activity / lock-screen wording appear
in **App Store blocks only**. The Google Play full descriptions omit both (Android
home-screen widget only) so no health-data permission declaration is triggered on
Play. This is already applied in each language file.

## Confirmed feature set (the only features copy may reference)

- Glucose logging in mg/dL and mmol/L with period tags: fasting, pre-meal,
  post-meal (2h), bedtime.
- Post-meal reminder / countdown timer, shown live on the dashboard.
- iOS Live Activity + home-screen & lock-screen widget (last reading + next
  reminder). No Apple Watch app.
- Injection site rotation tracker: body map, point-level rotation
  ("longest-unused point"), neutral absorption-speed education per region.
- Food logging: 1152-food database, barcode scanning, carb tracking, quick add,
  favorites. (Copy says "1000+" to stay conservative.)
- Insights (Pro): Time in Range (TIR), Ambulatory Glucose Profile (AGP),
  GMI / estimated A1C, 30 and 90 day trends, weekly digest.
- Doctor-ready PDF report for any date range.
- Multiple profiles.
- Apple Health sync (Pro): read of glucose; optional user-enabled write-back of
  manually logged readings (off by default, toggled in Settings).
- Tracking without a diagnosis (1.7.0): an optional "No diagnosis" setup choice
  hides all insulin surfaces and keeps a plain glucose and meal journal. Copy may
  mention the in-app reference links (CDC prediabetes page, ADA risk test) but must
  never imply screening, risk scoring or symptom assessment by the app.
- 9 languages: Turkish, English, German, Spanish, French, Italian, Portuguese,
  Arabic, Japanese (last four added in 2.0.0).
- Pro subscription tier (monthly, yearly with 7-day trial, one-time lifetime).

Note: the app also has an SOS/emergency-contact screen and a "Spike" help chat, but
these are intentionally left out of the store copy above because they are outside the
confirmed feature list for this ASO package.

## App Review Information notes (English only, single reviewer field)

zerospike is a personal diabetes logbook (wellness/tracking). It does not diagnose,
treat or provide medical advice; any insulin figure shown is plain arithmetic from
the user's own saved ratios, and every such screen carries a "not medical advice"
disclaimer. All health data stays on the device: there is no account, no server and
no upload. HealthKit reads (blood glucose, insulin delivery, workouts) display the
user's own data in the journal; manually logged glucose can optionally be written
back to Health, only when the user turns this on in Settings, and nothing is shared.
Setup includes an optional "No diagnosis" choice that simply hides insulin screens;
the app never screens, scores risk or assesses symptoms. The
SOS screen only opens the system dialer or a prefilled message composer containing
the user's location; it never places calls or sends messages automatically. To review
quickly: on a fresh install, complete the step-by-step setup (defaults are fine), then
use the sample data offer on the empty dashboard to populate the journal, Insights and
the PDF report. Subscriptions (monthly; yearly with a 7-day free trial; one-time
lifetime) run through StoreKit via RevenueCat and can be tested with a sandbox account.
