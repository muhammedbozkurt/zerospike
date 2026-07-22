# zerospike

An offline-first diabetes logbook for iOS and Android. Glucose readings, meals
and injections go in; descriptive summaries, a doctor-ready report and a set of
glanceable surfaces come out.

zerospike is **not a medical device**. It records what the user enters and
describes it back. It never diagnoses, never recommends a treatment, and never
tells anyone how much insulin to take: the calculator is arithmetic over the
user's own ratios, and every figure it produces stays editable.

- **Bundle ID:** `com.greeneyeapp.zerospike`
- **Stack:** Expo SDK 57 · Expo Router · TypeScript · NativeWind v4 ·
  expo-sqlite · expo-camera · expo-notifications · react-native-svg ·
  react-native-purchases

## What it does

**Four tabs:** Dashboard (today as a live journal, with the last reading as the
hero ring), Meals, Injection, Settings. A profile that takes no insulin drops
the Injection tab and the whole dose apparatus.

- **Glucose logging.** A bottom sheet with one large numeral that takes its
  colour from the same classification the rest of the app uses, a period tag,
  optional context tags (sport, illness, stress, travel, alcohol) and a
  backdatable timestamp.
- **Meals.** A 562-item multilingual food catalogue with FTS5 search across five
  languages plus synonyms, barcode scanning (Open Food Facts, cached locally so
  the second scan of a product works offline), custom foods, and one-tap re-log
  of recent meals.
- **Dose calculator.** carbs ÷ carb ratio, plus an optional correction toward
  the middle of the user's post-meal range, minus active insulin. Logging a meal
  also stores the glucose reading that was typed and, for a mealtime-insulin
  user, the matching bolus row, so active-insulin tracking actually sees it.
- **Injections.** A usage map at rotation-POINT resolution: eight body regions,
  each split into four points, coloured by how often and how recently the user
  used them. A picture of their own history, never a placement instruction.
- **Insights.** Time in range against the user's own target band, an AGP daily
  profile, daily averages, a percentile summary, time-of-day means, descriptive
  patterns, and a GMI estimate that is withheld until the sample can carry it.
- **Doctor report.** A one-tap PDF: summary tiles, the AGP chart drawn from the
  same geometry the app renders, and the full log tables. CSV export follows the
  profile's display unit and names it in its own column.
- **Spike.** An in-app assistant for app help and general diabetes education,
  behind an explicit consent gate, metered per day. It never returns a dose
  number, and no health record leaves the device: only the typed question and
  the chat window are sent.
- **SOS.** A calm screen that opens the dialer on the region's emergency number
  or hands a prefilled message (optionally with a location link) to a contact.
  Nothing is ever sent or dialled automatically.
- **Reminders.** Post-meal check with a live countdown, night insulin, glucose
  check, weekly summary, and an optional follow-up after a low reading.
- **Glanceable surfaces.** An iOS home-screen widget and post-meal Live Activity
  (lock screen + Dynamic Island), and an Android home-screen widget. All three
  render the same snapshot the app writes.
- **Family mode.** Multiple profiles, each with its own targets, ratios, unit
  and logs.

## Regulatory posture

- Neutral language throughout. No "alarm", no "warns you", no "recommended
  dose"; a dose is always "calculated" and always editable.
- The rotation map and every insight are descriptive summaries of the user's own
  entries.
- Spike declines dose questions in one sentence and points to the care team.
- Estimates carry a disclaimer at the point of decision, not only in Settings.
- A default ratio is never presented as if the user had chosen it: until they
  confirm their own ICR/ISF, the calculator says so on the result.

## Architecture

**SQLite is the single source of truth.** The app works fully offline and
nothing is uploaded.

```
app/                 expo-router screens (tabs + modal routes)
components/          shared UI
  rich/              the Midnight Monitor visual vocabulary
  charts/            AGP, trend and hourly charts
lib/
  db/                schema + migrations, typed data access
  services/          notifications, health, export/report, purchases, live data
  i18n/locales/      tr, en, de, es, fr
  theme/             design tokens (mirrored in tailwind.config.js)
  glucose.ts         units + classification (the one glucose language)
  insulin.ts         the dose estimator + plausibility guardrails
  iob.ts             active insulin from logged bolus doses
modules/             local native modules (the Live Activity bridge)
targets/widget/      iOS WidgetKit + ActivityKit target (Swift)
supabase/functions/  the Spike edge function (Deno, deployed separately)
scripts/             gate scripts and the math test suites
```

### Data model (schema v8)

`user_profiles` carries the personal numbers: target RANGES (fasting and
post-meal, each a min and a max), the user's own low threshold, a carb ratio per
meal slot, insulin sensitivity, a daily carb range, display unit, diabetes type
(wording only, never a calculation input), insulin mode, and whether the ratios
were confirmed by the user or are still defaults.

`sugar_logs`, `meal_logs` and `injection_logs` hold the entries. Injections
carry a region, an optional rotation point (1-4), and where the row came from.
The insulin-pen stock feature was removed in R5; its last dormant column was
dropped in the v8 table rebuild.

## Development

Use `npx expo install` for Expo-managed packages so SDK-compatible versions are
picked.

```bash
npm install
npm start          # Expo dev server
npm run ios        # or: npm run android
```

Gates, all of which must pass:

```bash
npx tsc --noEmit                     # types
npm run i18n-check                   # every static t() key exists in the schema
npx tsx scripts/calc.test.ts         # units, classification, dose math, IOB
npx tsx scripts/feedback.test.ts
npx tsx scripts/offParse.test.ts
```

Every new string is added in all five languages. The translation schema is
`lib/i18n/locales/tr.ts`; TypeScript enforces parity across the other four.

### Native steps

The widget, the Live Activity and Spike need work outside this repo:

- `npx expo prebuild` and a device build, with the App Group
  `group.com.greeneyeapp.zerospike` and the Live Activity capability enabled in
  the Apple Developer portal and in EAS credentials.
- `supabase secrets set OPENAI_API_KEY=...` and
  `supabase functions deploy ai-ask-spike`, then the resulting URL in
  `expo.extra.spikeFnUrl`. Until it is set, every Spike entry point stays hidden
  rather than opening a dead end.
