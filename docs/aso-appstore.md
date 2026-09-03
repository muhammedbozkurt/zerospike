# zerospike App Store + Google Play ASO - Index (2026-09, 2.3.2 round)

This is the overview and rule set. The actual per-store, per-language copy lives in
one file per language, in two folders:

- **App Store** copy: `zerospike-store/aso/<lang>.md`. Each file has the App Store
  block (App name, Subtitle, Promotional Text, Keywords, Description, What's New)
  plus a mirrored Google Play block kept for side-by-side comparison only.
- **Google Play** copy: `zerospike-store/aso-android/<lang>.md` (Title, Short
  description, Full description). This folder is the Play source of truth; when the
  mirrored Play block in `aso/` and `aso-android/` disagree, `aso-android/` wins.

Languages: en, tr, de, es, fr, it, pt (BR), ar, ja. Play What's New texts live in
`zerospike-store/google-play-extras/whats-new-<version>.md`, Play review notes in
`zerospike-store/aso-android/review-notes-en.md`.

2.3.2 ASO round (2026-09-02) builds on the 2.3.0 round (2026-08-24): research,
per-market rationale, A/B alternatives and sources live in
[../zerospike-store/aso/aso-2.3.0-research.md](../zerospike-store/aso/aso-2.3.0-research.md).
Previous field values are kept inline as "(onceki: ...)" lines in each language file.
Character counts are noted in parentheses after every length-limited field.

## Character limits

- App name / Play title: 30
- Subtitle: 30
- Promotional Text: 170
- Keywords (App Store): 100 CHARACTERS, comma-separated, no space after commas.
  App Store Connect accepts 100 characters and live ranking confirmed the tail of
  the field is indexed (research §5: old ar field, 171 bytes, ranked on words past
  byte 100). Fill to 100 characters with the most valuable terms first. Byte counts
  are reported for information only. Never repeat words already in the name or
  subtitle. Verify with the research script counts, never by hand.
- Description / Play full description: 4000
- Play short description: 80
- Play What's New: 500 per language

## Regulation rules (mandatory - Apple 1.4.1 / 2.3, Play health policy, medical-app scrutiny)

1. No health-claim or outcome language anywhere. Forbidden ideas: control, lower,
   reduce, prevent, "manage your diabetes", treat, diagnose, "improve control",
   "keep glucose in range" as a promise. Use instead: track, log, record, see,
   review, monitor (as in observe), organize, keep a history. ("Time in range" is
   used only as the name of a descriptive metric over past data, never as a promise.)
2. The phrase "insulin calculator" must never appear, in any language. Insulin doses
   are only logged / recorded / kept, never "calculated" or "dosed" by the app.
   The same applies to "warns", "hypoglycemia alarm", "diagnosis", "treatment",
   "recommended dose" and their equivalents (see CLAUDE.md). Alarms and reminders
   are described as reminders the user set, never as medical alerts.
3. Neutral, factual, non-promissory tone. No "your health companion" hype.
4. Each long description carries a neutral disclaimer: the app is for personal
   tracking, is not medical advice and is not a medical device.
5. No em-dashes anywhere. Use hyphens, commas or semicolons.
6. The Apple Watch and Wear OS companions are live in the store listings as of the
   2.3.2 round (2026-09-02) and may be described, but only with the confirmed watch
   features below: both are read-only mirrors (nothing is logged or started from the
   wrist). Apple Watch appears in App Store copy only, Wear OS in Play copy only;
   both brand names stay untranslated. No feature outside the confirmed list below
   may be mentioned.
7. The app never links insulin type to injection region; copy must not imply it
   recommends a site for a given insulin. Injection copy is rotation- and
   usage-based only ("longest-unused point"), plus neutral absorption-speed notes.

## Play vs App Store difference (Apple Health vs Health Connect)

Health Connect is ACTIVE on Google Play: the company Play account is in place and the
Play health data declaration is filed (production release waits for its approval, see
CLAUDE.md). Scope on Android: glucose read (last 30 days) and optional user-enabled
write-back only. There is no insulin record type in Health Connect and active minutes
are not read, so the Insights health summary card stays iOS-only.

Wording split: the Apple Health line, Live Activity and lock screen / Control Center
wording appear in **App Store blocks only**; the Health Connect line appears in
**Play copy only** (brand name "Health Connect" is never translated). Neither store's
copy mentions the other platform's bridge.

## Confirmed feature set (the only features copy may reference)

- Glucose logging in mg/dL and mmol/L with period tags: fasting, pre-meal,
  post-meal (2h), bedtime.
- Post-meal reminder / countdown timer, shown live on the dashboard. On Android it
  also runs as a persistent countdown notification.
- iOS: Live Activity, home screen widget, lock screen widgets and Control Center
  controls (iOS 18), real alarms on iOS 26 for reminders and the post-meal timer.
- Android: six home screen widgets; "play as alarm" option that shows a full-screen
  alarm for a reminder.
- Reminder hub: up to 10 reminders per profile, a ready-made set offered at setup.
- Medication log and "My Medications" list (user-entered, logged only).
- Insulin setup step: records the user's own basal/bolus products and daily basal
  amount as entered by the user; never a recommendation or a calculation.
- Injection site rotation tracker: body map, point-level rotation
  ("longest-unused point"), neutral absorption-speed education per region.
- Food logging: 1152-food database, barcode scanning, carb tracking, quick add,
  favorites. (Copy says "1000+" to stay conservative.)
- Insights (Pro): Time in Range (TIR), Ambulatory Glucose Profile (AGP),
  GMI / estimated A1C, 30 and 90 day trends, weekly digest.
- Doctor-ready PDF report for any date range.
- Multiple profiles.
- Apple Health sync (Pro, iOS): read of glucose (90 days); optional user-enabled
  write-back of manually logged readings (off by default, toggled in Settings).
- Health Connect (Pro, Android): glucose read (30 days) and optional write-back only.
- Apple Watch (App Store only): read-only companion. Watch app shows the last logged
  reading in the user's unit, coloured by the user's own target band ("--" with no
  entries), "X h Y min ago", and a live countdown to the next pending reminder (a
  running post-meal timer takes that slot, labelled as a generic reminder). Two watch
  face complications (circular: reading + unit; rectangular: reading + unit + the same
  countdown). No buttons, no logging, no timer start, no readings list, no average.
- Wear OS (Play only): read-only companion, standalone app fed by the paired phone.
  Watch app shows the last reading coloured by the target band, unit, "ago" line, and
  either a live post-meal countdown or the next reminder's clock time. A tile shows
  the same reading plus the clock time of that event (no countdown). One short-text
  complication shows the reading with the unit, uncoloured. No buttons, no logging,
  no timer start, no tap actions, no readings list, no average.
- Tracking without a diagnosis (1.7.0): an optional "No diagnosis" setup choice
  hides all insulin surfaces and keeps a plain glucose and meal journal. Copy may
  mention the in-app reference links (CDC prediabetes page, ADA risk test) but must
  never imply screening, risk scoring or symptom assessment by the app.
- 9 languages: Turkish, English, German, Spanish, French, Italian, Portuguese,
  Arabic, Japanese (last four added in 2.0.0).
- Pro subscription tier (monthly, yearly with 7-day trial, one-time lifetime).

Note: the app also has an SOS/emergency-contact screen and a "Spike" help chat, but
these are intentionally left out of the store copy because they are outside the
confirmed feature list for this ASO package.

## App Review Information notes (English only, single reviewer field)

zerospike is a personal diabetes logbook (wellness/tracking). It does not diagnose,
treat or provide medical advice; any insulin figure shown is plain arithmetic from
the user's own saved ratios, and every such screen carries a "not medical advice"
disclaimer. All health data stays on the device: there is no account, no server and
no upload. HealthKit reads (blood glucose, insulin delivery, workouts) display the
user's own data in the journal; manually logged glucose can optionally be written
back to Health, only when the user turns this on in Settings, and nothing is shared.
Reminders and the post-meal timer are user-set notifications and alarms, not medical
alerts. Setup includes an optional "No diagnosis" choice that simply hides insulin
screens; the app never screens, scores risk or assesses symptoms. The SOS screen only
opens the system dialer or a prefilled message composer containing the user's
location; it never places calls or sends messages automatically. To review quickly:
on a fresh install, complete the step-by-step setup (defaults are fine), then use the
sample data offer on the empty dashboard to populate the journal, Insights and the
PDF report. Subscriptions (monthly; yearly with a 7-day free trial; one-time
lifetime) run through StoreKit via RevenueCat and can be tested with a sandbox account.
